<?php
declare(strict_types=1);
namespace BCStudio;

class BCConnectionConfig
{
    public function __construct(
        public string $tenantId,
        public string $clientId,
        public string $clientSecret,
        public string $environment,
        public string $companyId  = '',
        public string $baseUrl    = 'https://api.businesscentral.dynamics.com',
        public string $apiVersion = 'v2.0',
    ) {}
}
