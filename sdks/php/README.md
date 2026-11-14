# BCStudio PHP SDK for Business Central

```bash
composer require bcstudio/bc-sdk
```

## Quick start

```php
use BCStudio\BCClient;
use BCStudio\BCConnectionConfig;
use BCStudio\ODataBuilder;
use BCStudio\ODataFilter;

$config = new BCConnectionConfig(
    tenantId:     'xxxxxxxx-...',
    clientId:     'xxxxxxxx-...',
    clientSecret: 'your-secret',
    environment:  'production',
    companyId:    'xxxxxxxx-...',
);
$client = new BCClient($config);

// OData query builder — all params
$qs = (new ODataBuilder())
    ->top(50)
    ->select('id', 'number', 'displayName', 'lastModifiedDateTime')
    ->filter([new ODataFilter('lastModifiedDateTime', 'gt', '2024-01-15T10:30:45.003Z')])
    // ↑ milliseconds auto-stripped
    ->orderby('displayName', 'asc')
    ->expand('customerPaymentTerms')
    ->count()
    ->build();

// GET with options array
$result = $client->get(
    'api/v2.0/companies({companyId})/customers',
    ['top' => 50, 'select' => ['id', 'displayName'], 'orderby' => 'displayName asc']
);

// GET all pages (auto follows @odata.nextLink)
$all = $client->getAll('api/v2.0/companies({companyId})/customers');

// CRUD with ETag
$record = $client->getOne('api/v2.0/companies({companyId})/customers', 'GUID');
$etag   = $record->etag; // REQUIRED for patch/delete

$client->patch('api/v2.0/companies({companyId})/customers', 'GUID',
               ['displayName' => 'New Name'], $etag);

$client->delete('api/v2.0/companies({companyId})/customers', 'GUID', $etag);

// Bound actions
$client->callAction(
    'api/v2.0/companies({companyId})/salesOrders',
    'ORDER-GUID',
    'Microsoft.NAV.makeInvoice'
);

// Multi-company
$client2 = $client->withCompany('other-company-guid');

// Discover company ID by name
$companyId = $client->resolveCompanyId('CRONUS International Ltd.');
```

## OData parameters supported

| Builder method | OData param | Notes |
|---|---|---|
| `->top(100)` | `$top` | |
| `->skip(50)` | `$skip` | |
| `->select('id','name')` | `$select` | Variadic args |
| `->filter(new ODataFilter(...))` | `$filter` | Auto-strips datetime ms |
| `->orderby('name', 'desc')` | `$orderby` | |
| `->expand('lines')` | `$expand` | |
| `->count()` | `$count=true` | |
| `->search('Acme')` | `$search` | |
| `->raw('$apply=...')` | passthrough | |

## BC gotchas — documented

1. **`$filter` silently ignored on custom pages** — use `BCClient::detectFilterHonoured()`
2. **Milliseconds kill `$filter`** — use `BCClient::normalizeFilterDate()`
3. **ETag required** for PATCH/DELETE — both methods enforce it via signature
4. **429 Retry-After** — respected automatically in every request
5. **`@odata.nextLink`** — `getAll()` follows it automatically
