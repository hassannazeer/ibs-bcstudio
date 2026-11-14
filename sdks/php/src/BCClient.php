<?php

declare(strict_types=1);

namespace BCStudio;

use RuntimeException;

/**
 * BCClient — production-grade Business Central OData v4 HTTP client for PHP.
 *
 * Requires: composer require guzzlehttp/guzzle
 *
 * Handles:
 * - OAuth2 client_credentials token acquisition + per-process caching
 * - {companyId} injection in all API paths
 * - Full CRUD with ETag enforcement (If-Match)
 * - Automatic @odata.nextLink pagination (getAll)
 * - 429 Retry-After + 5xx exponential backoff
 * - Bound actions (Microsoft.NAV.*)
 * - Multi-company support via withCompany()
 */
class BCClient
{
    private static array $tokenCache = [];  // ["tenantId:clientId" => [token, expiresAt]]

    public function __construct(private readonly BCConnectionConfig $config) {}

    // ── Token ─────────────────────────────────────────────────────────────────

    public function getAccessToken(): string
    {
        $key = "{$this->config->tenantId}:{$this->config->clientId}";
        $now = time();

        if (isset(self::$tokenCache[$key]) && self::$tokenCache[$key][1] > $now + 60) {
            return self::$tokenCache[$key][0];
        }

        $url  = "https://login.microsoftonline.com/{$this->config->tenantId}/oauth2/v2.0/token";
        $resp = $this->http('POST', $url, [
            'form_params' => [
                'grant_type'    => 'client_credentials',
                'client_id'     => $this->config->clientId,
                'client_secret' => $this->config->clientSecret,
                'scope'         => 'https://api.businesscentral.dynamics.com/.default',
            ],
        ], skipAuth: true);

        $body  = json_decode((string)$resp->getBody(), true);
        $token = $body['access_token'];
        self::$tokenCache[$key] = [$token, $now + (int)($body['expires_in'] ?? 3600)];
        return $token;
    }

    // ── URL building ──────────────────────────────────────────────────────────

    public function buildUrl(string $path, string $entityId = '', string $odataQuery = ''): string
    {
        $path = str_replace('{companyId}', $this->config->companyId, $path);
        $base = "{$this->config->baseUrl}/v2.0/{$this->config->tenantId}/{$this->config->environment}";
        $url  = rtrim($base, '/') . '/' . ltrim($path, '/');
        if ($entityId !== '') $url .= "($entityId)";
        if ($odataQuery !== '') $url .= (str_contains($url, '?') ? '&' : '?') . $odataQuery;
        return $url;
    }

    public function buildUrlWithOptions(string $path, string $entityId = '', array $options = []): string
    {
        return $this->buildUrl($path, $entityId, ODataBuilder::fromArray($options)->build());
    }

    // ── CRUD ──────────────────────────────────────────────────────────────────

    public function get(string $path, array $options = []): BCResponse
    {
        $t0  = microtime(true);
        $url = $this->buildUrlWithOptions($path, '', $options);
        $r   = $this->request('GET', $url);
        return new BCResponse(
            success: $r['ok'],
            status:  $r['status'],
            durationMs: (microtime(true) - $t0) * 1000,
            data:    $r['ok'] ? $r['body'] : null,
            error:   $r['ok'] ? null : $r['raw'],
        );
    }

    /** GET a single record — returns ETag in BCResponse::$etag */
    public function getOne(string $path, string $entityId, array $options = []): BCResponse
    {
        $t0  = microtime(true);
        $url = $this->buildUrlWithOptions($path, $entityId, $options);
        $r   = $this->request('GET', $url);
        return new BCResponse(
            success: $r['ok'],
            status:  $r['status'],
            durationMs: (microtime(true) - $t0) * 1000,
            data:    $r['ok'] ? $r['body'] : null,
            etag:    $r['headers']['etag'][0] ?? null,
            error:   $r['ok'] ? null : $r['raw'],
        );
    }

    /** GET all records, following @odata.nextLink automatically. */
    public function getAll(string $path, array $options = []): array
    {
        $results = [];
        $url     = $this->buildUrlWithOptions($path, '', $options);

        while ($url !== null) {
            $r = $this->request('GET', $url);
            if (!$r['ok']) throw new RuntimeException("BC GET failed {$r['status']}: {$r['raw']}");
            $body     = $r['body'];
            $results  = array_merge($results, $body['value'] ?? []);
            $url      = $body['@odata.nextLink'] ?? null;
        }

        return $results;
    }

    public function post(string $path, array $body): BCResponse
    {
        $t0  = microtime(true);
        $url = $this->buildUrl($path);
        $r   = $this->request('POST', $url, $body);
        return new BCResponse(
            success: $r['ok'],
            status:  $r['status'],
            durationMs: (microtime(true) - $t0) * 1000,
            data:    $r['ok'] ? ($r['body'] ?? null) : null,
            etag:    $r['headers']['etag'][0] ?? null,
            error:   $r['ok'] ? null : $r['raw'],
        );
    }

    /**
     * PATCH — $etag is REQUIRED. BC returns 412 without it.
     * Pass '*' to bypass the concurrency check.
     */
    public function patch(string $path, string $entityId, array $body, string $etag): BCResponse
    {
        $t0  = microtime(true);
        $url = $this->buildUrl($path, $entityId);
        $r   = $this->request('PATCH', $url, $body, ['If-Match' => $etag]);
        return new BCResponse(
            success: $r['ok'],
            status:  $r['status'],
            durationMs: (microtime(true) - $t0) * 1000,
            data:    $r['ok'] ? ($r['body'] ?? null) : null,
            error:   $r['ok'] ? null : $r['raw'],
        );
    }

    /** DELETE — $etag is REQUIRED. BC returns 412 without it. */
    public function delete(string $path, string $entityId, string $etag): BCResponse
    {
        $t0  = microtime(true);
        $url = $this->buildUrl($path, $entityId);
        $r   = $this->request('DELETE', $url, [], ['If-Match' => $etag]);
        return new BCResponse(
            success: $r['ok'],
            status:  $r['status'],
            durationMs: (microtime(true) - $t0) * 1000,
        );
    }

    /**
     * Call a BC bound action (Microsoft.NAV.*).
     * POSTs to entity(GUID)/Microsoft.NAV.actionName
     */
    public function callAction(string $path, string $entityId, string $action, array $body = []): BCActionResponse
    {
        $t0  = microtime(true);
        $url = $this->buildUrl($path, $entityId) . "/$action";
        $r   = $this->request('POST', $url, $body);
        return new BCActionResponse(
            success: $r['ok'],
            status:  $r['status'],
            durationMs: (microtime(true) - $t0) * 1000,
            data:    $r['ok'] ? ($r['body'] ?? null) : null,
            error:   $r['ok'] ? null : $r['raw'],
        );
    }

    // ── Company helpers ───────────────────────────────────────────────────────

    public function listCompanies(): BCResponse
    {
        $t0  = microtime(true);
        $url = "{$this->config->baseUrl}/v2.0/{$this->config->tenantId}/{$this->config->environment}/api/v2.0/companies";
        $r   = $this->request('GET', $url);
        return new BCResponse(
            success: $r['ok'],
            status:  $r['status'],
            durationMs: (microtime(true) - $t0) * 1000,
            data:    $r['ok'] ? $r['body'] : null,
        );
    }

    public function resolveCompanyId(string $name): ?string
    {
        $resp = $this->listCompanies();
        if (!$resp->success || !$resp->data) return null;
        foreach ($resp->data['value'] ?? [] as $c) {
            if (strtolower($c['name'] ?? '') === strtolower($name)) return $c['id'];
        }
        return null;
    }

    public function withCompany(string $companyId): static
    {
        $cfg = clone $this->config;
        $cfg->companyId = $companyId;
        return new static($cfg);
    }

    // ── Static helpers ────────────────────────────────────────────────────────

    public static function normalizeFilterDate(string $iso): string
    {
        return preg_replace('/\.\d{1,3}Z$/', 'Z', $iso);
    }

    public static function buildIncrementalFilter(string $field, string $lastValue): string
    {
        return "\$filter=$field gt " . self::normalizeFilterDate($lastValue);
    }

    public static function detectFilterHonoured(array $records, string $field, string $cutoff): bool
    {
        $cutoffClean = self::normalizeFilterDate($cutoff);
        foreach ($records as $r) {
            $val = $r[$field] ?? '';
            if ($val && self::normalizeFilterDate($val) <= $cutoffClean) return false;
        }
        return true;
    }

    // ── Core HTTP with retry ──────────────────────────────────────────────────

    private function request(string $method, string $url, array $body = [],
                             array $extraHeaders = [], bool $skipAuth = false): array
    {
        $client = $this->guzzle();
        $opts   = ['http_errors' => false];

        if (!$skipAuth) {
            $extraHeaders['Authorization'] = 'Bearer ' . $this->getAccessToken();
        }
        if ($body) {
            $opts['json'] = $body;
        }
        $opts['headers'] = array_merge(
            ['Accept' => 'application/json', 'Content-Type' => 'application/json'],
            $extraHeaders
        );

        $maxRetries = 5;
        for ($attempt = 0; $attempt < $maxRetries; $attempt++) {
            $resp   = $client->request($method, $url, $opts);
            $status = $resp->getStatusCode();

            if ($status === 429) {
                $after = (int)($resp->getHeaderLine('Retry-After') ?: 2);
                sleep($after);
                continue;
            }
            if ($status >= 500 && $attempt < $maxRetries - 1) {
                sleep(2 ** $attempt);
                continue;
            }

            $raw  = (string)$resp->getBody();
            $body = json_decode($raw, true);
            return [
                'ok'      => $status >= 200 && $status < 300,
                'status'  => $status,
                'body'    => $body,
                'raw'     => $raw,
                'headers' => $resp->getHeaders(),
            ];
        }

        return ['ok' => false, 'status' => 0, 'body' => null, 'raw' => 'Max retries exceeded', 'headers' => []];
    }

    private function http(string $method, string $url, array $opts = [], bool $skipAuth = false)
    {
        return $this->guzzle()->request($method, $url, array_merge(['http_errors' => false], $opts));
    }

    private function guzzle(): \GuzzleHttp\Client
    {
        static $client = null;
        return $client ??= new \GuzzleHttp\Client();
    }
}
