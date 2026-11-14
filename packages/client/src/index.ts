// ─────────────────────────────────────────────────────────────────────────────
// @bcstudio/client
//
// The definitive Business Central OData v4 HTTP client.
// Handles everything that BC's documentation doesn't warn you about:
//
//  OAuth2 — client_credentials flow, token cache with 60s expiry buffer
//  ETag   — automatic capture; enforced on PATCH/DELETE (412 guard)
//  Rate   — 429 Retry-After respected; exponential backoff on 5xx
//  Pages  — follows @odata.nextLink until every record is fetched
//  Filter — normalizeFilterDate() strips milliseconds (BC silent-ignore bug)
//  Detect — detectFilterHonoured() exposes the custom-page $filter-ignore bug
//  OData  — full query builder (ODataBuilder) for $filter/$select/$orderby/etc.
//  Actions— callAction() for bound BC actions (makeInvoice, post, cancel…)
//  Company— {companyId} template injection in all paths
// ─────────────────────────────────────────────────────────────────────────────

import type {
  BCConnectionConfig,
  BCTokenCache,
  BCResponse,
  BCListResponse,
  BCRequestOptions,
  BCActionResponse,
  ODataOptions,
  ODataFilter,
} from '@ilmora/bc-types';

// ── OData Query Builder ───────────────────────────────────────────────────────

export class ODataBuilder {
  private parts: string[] = [];

  /** $top=N — maximum records per request */
  top(n: number): this { this.parts.push(`$top=${n}`); return this; }

  /** $skip=N */
  skip(n: number): this { this.parts.push(`$skip=${n}`); return this; }

  /** $select=field1,field2,… */
  select(...fields: string[]): this {
    if (fields.length) this.parts.push(`$select=${fields.flat().join(',')}`);
    return this;
  }

  /**
   * $filter= with raw string or structured filter array.
   *
   * String: passed verbatim (you are responsible for datetime normalisation).
   * Array: each entry is joined with 'and'; datetime values are auto-normalised.
   *
   * @example
   *   .filter('lastModifiedDateTime gt 2024-01-01T00:00:00Z')
   *   .filter([{ field: 'lastModifiedDateTime', op: 'gt', value: '2024-01-15T10:00:00.003Z' }])
   */
  filter(filter: string | ODataFilter[]): this {
    if (typeof filter === 'string') {
      this.parts.push(`$filter=${filter}`);
    } else {
      const expr = filter
        .map(f => {
          let v = f.value;
          if (typeof v === 'string' && /\d{4}-\d{2}-\d{2}T/.test(v)) {
            v = BCClient.normalizeFilterDate(v);
          }
          const fmtV = v === null ? 'null'
            : typeof v === 'boolean' ? String(v)
            : typeof v === 'number'  ? String(v)
            : `${v}`;
          return `${f.field} ${f.op} ${fmtV}`;
        })
        .join(' and ');
      if (expr) this.parts.push(`$filter=${expr}`);
    }
    return this;
  }

  /** $orderby=field asc|desc */
  orderby(field: string, dir: 'asc' | 'desc' = 'asc'): this {
    this.parts.push(`$orderby=${field} ${dir}`);
    return this;
  }

  /** $expand=navProp1,navProp2 */
  expand(...props: string[]): this {
    if (props.length) this.parts.push(`$expand=${props.flat().join(',')}`);
    return this;
  }

  /** $count=true */
  count(): this { this.parts.push(`$count=true`); return this; }

  /** $search="term" */
  search(term: string): this { this.parts.push(`$search="${term}"`); return this; }

  /** Append raw OData string as-is */
  raw(qs: string): this { if (qs) this.parts.push(qs); return this; }

  /** Compile to query string (no leading '?') */
  build(): string { return this.parts.join('&'); }

  /** Build from ODataOptions object */
  static fromOptions(opts: ODataOptions): string {
    const b = new ODataBuilder();
    if (opts.top     != null)  b.top(opts.top);
    if (opts.skip    != null)  b.skip(opts.skip);
    if (opts.select)           b.select(...(Array.isArray(opts.select) ? opts.select : [opts.select]));
    if (opts.filter)           b.filter(opts.filter);
    if (opts.orderby)          b.parts.push(`$orderby=${opts.orderby}`);
    if (opts.expand) {
      const exp = Array.isArray(opts.expand) ? opts.expand.join(',') : opts.expand;
      b.parts.push(`$expand=${exp}`);
    }
    if (opts.count)            b.count();
    if (opts.search)           b.search(opts.search);
    if (opts.raw)              b.raw(opts.raw);
    return b.build();
  }
}

// ── BCClient ──────────────────────────────────────────────────────────────────

export class BCClient {
  private config: Required<BCConnectionConfig>;
  private tokenCache = new Map<string, BCTokenCache>();

  constructor(config: BCConnectionConfig) {
    this.config = {
      tenantId:     config.tenantId,
      environment:  config.environment,
      clientId:     config.clientId,
      clientSecret: config.clientSecret,
      companyId:    config.companyId    ?? '',
      baseUrl:      config.baseUrl      ?? '',
      apiVersion:   config.apiVersion   ?? 'v2.0',
    };
  }

  // ── Token Management ────────────────────────────────────────────────────────

  /**
   * Returns a valid OAuth2 access token.
   * Tokens are cached per tenantId+clientId. Refreshed 60s before expiry.
   */
  async getAccessToken(): Promise<string> {
    const key = `${this.config.tenantId}:${this.config.clientId}`;
    const cached = this.tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const url = `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     this.config.clientId,
      client_secret: this.config.clientSecret,
      scope:         'https://api.businesscentral.dynamics.com/.default',
    });

    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`BC OAuth2 failed (${resp.status}): ${err}`);
    }

    const data = await resp.json() as { access_token: string; expires_in: number };
    this.tokenCache.set(key, {
      token:     data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    });
    return data.access_token;
  }

  // ── URL Building ─────────────────────────────────────────────────────────────

  /**
   * Build a full BC API URL.
   *
   * - Injects companyId into `{companyId}` placeholders
   * - Appends `(entityId)` when provided
   * - Appends OData query string
   *
   * @example
   *   buildUrl('api/v2.0/companies({companyId})/customers', 'GUID-HERE', '$top=10')
   *   → https://api.businesscentral.dynamics.com/v2.0/{tenant}/{env}/api/v2.0/companies(GUID)/customers?$top=10
   */
  buildUrl(path: string, entityId?: string, odataQuery?: string): string {
    const companyId = this.config.companyId;
    const resolvedPath = companyId
      ? path.replace(/\{companyId\}/g, companyId)
      : path;

    const base = this.config.baseUrl
      || `https://api.businesscentral.dynamics.com/v2.0/${this.config.tenantId}/${this.config.environment}`;

    let url = `${base.replace(/\/$/, '')}/${resolvedPath.replace(/^\//, '')}`;

    if (entityId) {
      // Strip any existing query params before appending entity ID
      const qIdx = url.indexOf('?');
      const basePart = qIdx >= 0 ? url.slice(0, qIdx) : url;
      // If the path already ends with ')', insert before closing — else append (GUID)
      url = basePart.endsWith(')') ? `${basePart.slice(0, -1)}${entityId})` : `${basePart}(${entityId})`;
    }

    if (odataQuery) {
      url += (url.includes('?') ? '&' : '?') + odataQuery;
    }

    return url;
  }

  /**
   * Build URL from structured ODataOptions.
   */
  buildUrlWithOptions(path: string, entityId?: string, options?: ODataOptions): string {
    const qs = options ? ODataBuilder.fromOptions(options) : undefined;
    return this.buildUrl(path, entityId, qs);
  }

  // ── Core Execute ─────────────────────────────────────────────────────────────

  private async executeWithRetry<T>(
    url: string,
    method: string,
    body?: unknown,
    etag?: string | null,
    maxRetries = 3,
    extraHeaders?: Record<string, string>,
  ): Promise<BCResponse<T>> {
    let lastError = '';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
        await new Promise(r => setTimeout(r, delay));
      }

      let token: string;
      try {
        token = await this.getAccessToken();
      } catch (e) {
        return { success: false, status: 0, durationMs: 0, error: `Auth error: ${(e as Error).message}` };
      }

      const headers: Record<string, string> = {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept:         'application/json',
        ...extraHeaders,
      };

      // BC requires If-Match for PATCH and DELETE — omitting causes 412
      if ((method === 'PATCH' || method === 'DELETE') && etag) {
        headers['If-Match'] = etag;
      }

      const fetchOpts: RequestInit = { method, headers };
      if (body && (method === 'POST' || method === 'PATCH')) {
        fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
      }

      const t0 = Date.now();
      const resp = await fetch(url, fetchOpts);
      const durationMs = Date.now() - t0;

      // 429 — read Retry-After header and wait exactly that long
      if (resp.status === 429) {
        const retryAfter = parseInt(resp.headers.get('Retry-After') ?? '5', 10);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        lastError = 'BC rate limit (429)';
        continue;
      }

      // 5xx — retry with backoff
      if (resp.status >= 500) {
        lastError = `BC server error ${resp.status}`;
        continue;
      }

      const text = await resp.text();
      let data: T | undefined;
      try { data = text ? JSON.parse(text) as T : undefined; } catch { data = text as unknown as T; }

      const responseEtag =
        resp.headers.get('ETag') ||
        (data as Record<string, unknown>)?.['@odata.etag'] as string | undefined ||
        null;

      if (!resp.ok) {
        const errMsg =
          (data as Record<string, unknown>)?.error
            ? JSON.stringify((data as Record<string, unknown>).error)
            : (text || `HTTP ${resp.status}`);
        return { success: false, status: resp.status, durationMs, error: errMsg, errorData: data } as BCResponse<T>;
      }

      return { success: true, status: resp.status, data, durationMs, etag: responseEtag };
    }

    return { success: false, status: 0, durationMs: 0, error: `All ${maxRetries + 1} attempts failed. Last: ${lastError}` };
  }

  // ── CRUD Methods ─────────────────────────────────────────────────────────────

  /**
   * GET a single entity or a list.
   *
   * @example
   *   await client.get<{ value: Customer[] }>('api/v2.0/companies({companyId})/customers', {
   *     odataOptions: { top: 20, filter: 'blocked eq false', orderby: 'displayName asc' }
   *   });
   */
  async get<T = unknown>(path: string, opts?: BCRequestOptions): Promise<BCResponse<T>> {
    const qs = opts?.odataOptions
      ? ODataBuilder.fromOptions(opts.odataOptions)
      : opts?.odataQuery;
    const url = this.buildUrl(path, undefined, qs);
    return this.executeWithRetry<T>(url, 'GET', undefined, undefined, opts?.maxRetries, opts?.headers);
  }

  /**
   * GET a single record by entity GUID.
   * The returned response includes the ETag — store it for PATCH/DELETE.
   *
   * @example
   *   const r = await client.getOne<Customer>('api/v2.0/companies({companyId})/customers', 'GUID');
   *   const etag = r.etag!;
   */
  async getOne<T = unknown>(path: string, entityId: string, opts?: BCRequestOptions): Promise<BCResponse<T>> {
    const qs = opts?.odataOptions
      ? ODataBuilder.fromOptions(opts.odataOptions)
      : opts?.odataQuery;
    const url = this.buildUrl(path, entityId, qs);
    return this.executeWithRetry<T>(url, 'GET', undefined, undefined, opts?.maxRetries, opts?.headers);
  }

  /**
   * GET all pages, following @odata.nextLink automatically.
   * Returns the full flattened array of records.
   *
   * ⚠️ BC never returns more than 100–1000 records per page.
   *    Always use this for syncing — never assume one request is enough.
   *
   * @example
   *   const customers = await client.getAll<Customer>('api/v2.0/companies({companyId})/customers');
   */
  async getAll<T = unknown>(path: string, opts?: BCRequestOptions): Promise<T[]> {
    const qs = opts?.odataOptions
      ? ODataBuilder.fromOptions(opts.odataOptions)
      : opts?.odataQuery;

    const all: T[] = [];
    let currentUrl: string | null = this.buildUrl(path, undefined, qs);
    const delay = opts?.rateLimitDelay ?? 100;
    let page = 0;

    while (currentUrl) {
      if (page > 0) await new Promise(r => setTimeout(r, delay));
      const resp: BCResponse<BCListResponse<T>> = await this.executeWithRetry<BCListResponse<T>>(
        currentUrl, 'GET', undefined, undefined, opts?.maxRetries, opts?.headers,
      );
      if (!resp.success || !resp.data) break;
      all.push(...(resp.data.value ?? []));
      currentUrl = resp.data['@odata.nextLink'] ?? null;
      page++;
    }
    return all;
  }

  /**
   * POST — create a new BC entity.
   *
   * @example
   *   const r = await client.post<Customer>('api/v2.0/companies({companyId})/customers', {
   *     displayName: 'Acme Corp', currencyCode: 'USD'
   *   });
   *   const etag = r.etag!; // ← capture for future PATCH/DELETE
   */
  async post<T = unknown>(path: string, body: unknown, opts?: BCRequestOptions): Promise<BCResponse<T>> {
    const url = this.buildUrl(path);
    return this.executeWithRetry<T>(url, 'POST', body, undefined, opts?.maxRetries, opts?.headers);
  }

  /**
   * PATCH — update an existing BC entity.
   *
   * ⚠️ etag is REQUIRED. BC returns 412 Precondition Failed if omitted.
   *    Get the etag from a prior GET / POST / PATCH response.
   *    Pass '*' to skip the check (dangerous — may overwrite concurrent changes).
   *
   * @example
   *   await client.patch(
   *     'api/v2.0/companies({companyId})/customers', 'GUID', { displayName: 'New Name' }, etag
   *   );
   */
  async patch<T = unknown>(
    path: string,
    entityId: string,
    body: unknown,
    etag: string,
    opts?: BCRequestOptions,
  ): Promise<BCResponse<T>> {
    const url = this.buildUrl(path, entityId);
    return this.executeWithRetry<T>(url, 'PATCH', body, etag, opts?.maxRetries, opts?.headers);
  }

  /**
   * DELETE — remove a BC entity.
   *
   * ⚠️ etag is REQUIRED. BC returns 412 if omitted.
   *
   * @example
   *   await client.delete('api/v2.0/companies({companyId})/customers', 'GUID', etag);
   */
  async delete(
    path: string,
    entityId: string,
    etag: string,
    opts?: BCRequestOptions,
  ): Promise<BCResponse<void>> {
    const url = this.buildUrl(path, entityId);
    return this.executeWithRetry<void>(url, 'DELETE', undefined, etag, opts?.maxRetries, opts?.headers);
  }

  // ── Bound Actions ─────────────────────────────────────────────────────────────

  /**
   * Call a BC bound action (POST to entity with action name in URL).
   *
   * BC bound actions follow the pattern:
   *   POST /salesOrders(GUID)/Microsoft.NAV.shipAndInvoice
   *
   * Standard API v2.0 actions (examples):
   *   Sales Orders    → Microsoft.NAV.shipAndInvoice
   *   Purchase Orders → Microsoft.NAV.receiveAndInvoice
   *   Sales Invoices  → Microsoft.NAV.post | send | cancel | cancelAndCreateCreditMemo
   *
   * Standard actions such as shipAndInvoice / makeInvoice typically return 204 No Content.
   * An AL action that calls SetResultCode(WebServiceActionResultCode::Created) returns
   * 201 Created with a Location header and no JSON body.
   *
   * @see https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-creating-and-interacting-with-odatav4-bound-action
   *
   * @example
   *   await client.callAction(
   *     'api/v2.0/companies({companyId})/salesOrders',
   *     'ORDER-GUID',
   *     'Microsoft.NAV.shipAndInvoice'
   *   );
   */
  async callAction<T = unknown>(
    path: string,
    entityId: string,
    action: string,
    body?: unknown,
    opts?: BCRequestOptions,
  ): Promise<BCActionResponse<T>> {
    const baseUrl = this.buildUrl(path, entityId);
    const actionUrl = `${baseUrl}/${action}`;
    const t0 = Date.now();

    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (e) {
      return { success: false, status: 0, durationMs: 0, error: `Auth error: ${(e as Error).message}` };
    }

    const headers: Record<string, string> = {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept:         'application/json',
      ...opts?.headers,
    };

    const resp = await fetch(actionUrl, {
      method:  'POST',
      headers,
      body:    body ? JSON.stringify(body) : '{}',
    });
    const durationMs = Date.now() - t0;

    if (resp.status === 204) {
      // No Content — action succeeded with no return body (common for 'post', 'send')
      return { success: true, status: 204, durationMs };
    }

    const text = await resp.text();
    let data: T | undefined;
    try { data = text ? JSON.parse(text) as T : undefined; } catch { /* non-JSON */ }

    if (!resp.ok) {
      const errMsg = (data as Record<string, unknown>)?.error
        ? JSON.stringify((data as Record<string, unknown>).error)
        : text;
      return { success: false, status: resp.status, durationMs, error: errMsg };
    }

    return { success: true, status: resp.status, data, durationMs };
  }

  // ── Company Helpers ───────────────────────────────────────────────────────────

  /**
   * List all companies the credentials can access.
   * Useful to discover available companyIds.
   */
  async listCompanies(): Promise<BCResponse<BCListResponse<{ id: string; name: string; displayName: string; systemVersion: string }>>> {
    return this.get('api/v2.0/companies');
  }

  /**
   * Resolve a company name to its GUID.
   * Returns undefined if not found.
   *
   * @example
   *   const id = await client.resolveCompanyId('CRONUS International Ltd.');
   *   // → 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
   */
  async resolveCompanyId(companyName: string): Promise<string | undefined> {
    const resp = await this.listCompanies();
    if (!resp.success || !resp.data) return undefined;
    const match = resp.data.value.find(
      c => c.name === companyName || c.displayName === companyName
    );
    return match?.id;
  }

  /**
   * Clone this client with a different companyId.
   * Useful for multi-company operations.
   */
  withCompany(companyId: string): BCClient {
    return new BCClient({ ...this.config, companyId });
  }

  // ── Static Utilities ──────────────────────────────────────────────────────────

  /**
   * Strip milliseconds from an ISO 8601 datetime string.
   *
   * ⚠️ CRITICAL: BC OData V4 silently ignores $filter when the datetime value
   *    includes milliseconds (e.g. `.003Z`). This causes ALL records to be
   *    returned, breaking incremental sync completely. Always run lastIncrementalValue
   *    through this function before building a $filter.
   *
   * @example
   *   BCClient.normalizeFilterDate('2024-01-15T10:30:45.003Z')
   *   // → '2024-01-15T10:30:45Z'
   *
   *   BCClient.normalizeFilterDate('2024-01-15T10:30:45Z')
   *   // → '2024-01-15T10:30:45Z' (unchanged)
   */
  static normalizeFilterDate(isoString: string): string {
    return isoString.replace(/\.\d{1,3}Z$/, 'Z');
  }

  /**
   * Detect whether BC actually honoured a $filter on a custom API page.
   *
   * ⚠️ CRITICAL: Custom BC API pages built on AL `API` pages silently ignore
   *    $filter and return ALL records. No error, no warning — just all your data.
   *    This causes incremental syncs to re-process every record on every run.
   *
   * Detection strategy: if any returned record has the incrementalField value
   * ≤ the cutoff, the filter was silently ignored.
   *
   * @example
   *   const records = await client.getAll(path, { odataQuery: '$filter=...' });
   *   const honoured = BCClient.detectFilterHonoured(records, 'lastModifiedDateTime', lastValue);
   *   if (!honoured) {
   *     // fall back to full comparison — engine does this automatically
   *   }
   */
  static detectFilterHonoured<T extends Record<string, unknown>>(
    records: T[],
    incrementalField: string,
    lastValue: string,
  ): boolean {
    if (!records.length) return true; // empty = can't tell, assume honoured
    const cutoff = BCClient.normalizeFilterDate(lastValue);
    return !records.some(r => {
      const v = r[incrementalField] as string | undefined;
      return v !== undefined && v <= cutoff;
    });
  }

  /**
   * Build a standard incremental $filter string with milliseconds stripped.
   *
   * @example
   *   const qs = BCClient.buildIncrementalFilter('lastModifiedDateTime', lastValue);
   *   // → '$filter=lastModifiedDateTime gt 2024-01-15T10:30:45Z'
   */
  static buildIncrementalFilter(field: string, lastValue: string): string {
    return `$filter=${field} gt ${BCClient.normalizeFilterDate(lastValue)}`;
  }

  /**
   * Parse a full OData URL's query string into an object.
   * Useful for inspecting nextLink parameters.
   */
  static parseNextLink(nextLink: string): Record<string, string> {
    try {
      const qs = new URL(nextLink).search.slice(1);
      return Object.fromEntries(new URLSearchParams(qs));
    } catch {
      return {};
    }
  }

  /**
   * Check whether a BC error response indicates a concurrency conflict (412).
   * Useful to implement optimistic concurrency retry loops.
   */
  static isConcurrencyConflict(response: BCResponse<unknown>): boolean {
    return response.status === 412;
  }

  /**
   * Check whether a BC error response indicates the record was not found (404).
   */
  static isNotFound(response: BCResponse<unknown>): boolean {
    return response.status === 404;
  }
}

export type { BCConnectionConfig, BCResponse, BCListResponse, BCRequestOptions } from '@ilmora/bc-types';
