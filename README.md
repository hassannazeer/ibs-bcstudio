# IBS BCStudio

> **Business Central SDK by [Ilmora](https://ilmora.tech)** — The TypeScript/Python/PHP SDK for Microsoft Dynamics 365 Business Central that documents what Microsoft doesn't.

Extracted from production code running daily syncs of thousands of records. Battle-tested on
real BC environments across multiple tenants, companies, and custom extensions.

---

## Packages

| Package | npm | Description |
|---|---|---|
| [`@ilmora/bc-types`](./packages/types) | `npm i @ilmora/bc-types` | All shared TypeScript interfaces |
| [`@ilmora/bc-client`](./packages/client) | `npm i @ilmora/bc-client` | OAuth2 HTTP client — handles everything |
| [`@ilmora/bc-metadata`](./packages/metadata) | `npm i @ilmora/bc-metadata` | Discover endpoints, parse `$metadata` schemas |
| [`@ilmora/bc-sync`](./packages/sync) | `npm i @ilmora/bc-sync` | Full BC→destination sync engine |

Install individually — you only need what you use.

---

## Quick start

```ts
import { BCClient } from '@ilmora/bc-client';

const client = new BCClient({
  tenantId:     'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  clientId:     'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  clientSecret: 'your-secret',
  environment:  'production',       // or 'sandbox', 'MySandbox', etc.
  companyId:    'xxxxxxxx-...',     // optional — injected into {companyId} paths
});

// List companies (discover companyId)
const companies = await client.listCompanies();
console.log(companies.data?.value?.map(c => ({ id: c.id, name: c.name })));

// Use first company
const client2 = client.withCompany(companies.data!.value[0].id);

// Fetch customers — OData builder
const result = await client2.get<{ value: Customer[] }>(
  'api/v2.0/companies({companyId})/customers',
  {
    odataOptions: {
      top:     50,
      select:  ['id', 'number', 'displayName', 'lastModifiedDateTime'],
      filter:  [{ field: 'blocked', op: 'eq', value: false }],
      orderby: 'displayName asc',
    }
  }
);
```

---

## OData Query Builder

```ts
import { ODataBuilder } from '@ilmora/bc-client';

const qs = new ODataBuilder()
  .top(100)
  .select('id', 'number', 'displayName', 'currencyCode', 'lastModifiedDateTime')
  .filter([{ field: 'lastModifiedDateTime', op: 'gt', value: '2024-01-15T10:30:45.003Z' }])
  // ↑ datetimes are auto-normalised (milliseconds stripped) inside filter()
  .orderby('lastModifiedDateTime', 'desc')
  .count()
  .build();
// → $top=100&$select=id,...&$filter=lastModifiedDateTime gt 2024-01-15T10:30:45Z&$orderby=...&$count=true
```

---

## Full CRUD with ETag

```ts
// CREATE
const created = await client.post<Customer>(
  'api/v2.0/companies({companyId})/customers',
  { displayName: 'Acme Corp', currencyCode: 'USD' }
);
const etag = created.etag!; // ← ALWAYS capture this

// READ single record (also returns etag)
const record = await client.getOne<Customer>(
  'api/v2.0/companies({companyId})/customers', 'GUID'
);
const freshEtag = record.etag!;

// UPDATE — etag REQUIRED (412 if missing)
await client.patch(
  'api/v2.0/companies({companyId})/customers', 'GUID',
  { displayName: 'Acme Corp Ltd.' },
  freshEtag
);

// DELETE — etag REQUIRED (412 if missing)
await client.delete(
  'api/v2.0/companies({companyId})/customers', 'GUID',
  freshEtag
);
```

---

## Bound Actions

```ts
// Make a sales invoice from a sales order
const invoice = await client.callAction(
  'api/v2.0/companies({companyId})/salesOrders',
  'ORDER-GUID',
  'Microsoft.NAV.makeInvoice'
);

// Post an invoice
await client.callAction(
  'api/v2.0/companies({companyId})/salesInvoices',
  'INVOICE-GUID',
  'Microsoft.NAV.post'
);

// Send an invoice by email
await client.callAction(
  'api/v2.0/companies({companyId})/salesInvoices',
  'INVOICE-GUID',
  'Microsoft.NAV.send'
);

// Cancel and create a credit memo
const creditMemo = await client.callAction(
  'api/v2.0/companies({companyId})/salesInvoices',
  'INVOICE-GUID',
  'Microsoft.NAV.cancelAndCreateCreditMemo'
);
```

**All built-in BC actions:**

| Entity | Action |
|---|---|
| `salesOrders` | `makeInvoice`, `makeQuote`, `post`, `reopen`, `releaseOrder`, `copyDocument` |
| `salesInvoices` | `post`, `send`, `cancel`, `cancelAndCreateCreditMemo`, `getRecurringLines` |
| `purchaseOrders` | `post`, `reopen`, `copyDocument` |

Custom AL `[ServiceEnabled]` actions work the same way — just pass the action name.

---

## Sync Engine

```ts
import { BCClient }             from '@ilmora/bc-client';
import { BCSyncEngine }         from '@ilmora/bc-sync';
import { createSupabaseAdapter } from '@ilmora/bc-sync/adapters/supabase';
import { createClient }          from '@supabase/supabase-js';

const bcClient = new BCClient({ tenantId, clientId, clientSecret, environment, companyId });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const engine   = new BCSyncEngine(bcClient, createSupabaseAdapter(supabase, 'id'));

const result = await engine.run({
  sourceEndpoint:      'api/v2.0/companies({companyId})/customers',
  destinationTable:    'bc_customers',
  primaryKeyField:     'id',
  syncMode:            'incremental',
  incrementalField:    'lastModifiedDateTime',
  lastIncrementalValue: savedValueFromPreviousRun,  // undefined for first run

  fieldMappings: [
    { sourceField: 'id',                   destinationField: 'id',          dataType: 'guid'     },
    { sourceField: 'number',               destinationField: 'number',      dataType: 'string'   },
    { sourceField: 'displayName',          destinationField: 'name',        dataType: 'string'   },
    { sourceField: 'email',                destinationField: 'email',       dataType: 'string'   },
    { sourceField: 'currencyCode',         destinationField: 'currency',    dataType: 'string'   },
    { sourceField: 'lastModifiedDateTime', destinationField: 'modified_at', dataType: 'datetime' },
  ],
});

console.log(result);
// {
//   status: 'success',
//   recordsRead: 1500, recordsInserted: 42, recordsUpdated: 8,
//   recordsSkipped: 1450, recordsFailed: 0,
//   nextIncrementalValue: '2024-11-14T09:12:33Z',  ← PERSIST THIS
//   meta: { filterApplied: true, filterHonoured: false, pagesFetched: 2 }
// }

// ✅ Always persist nextIncrementalValue for the next run
await db.set('bc_customers_last_sync', result.nextIncrementalValue);
```

### SQL Server adapter

```ts
import sql from 'mssql';
import { createSqlServerAdapter } from '@ilmora/bc-sync/adapters/sqlserver';

const pool    = await sql.connect({ server, database, user, password, options: { encrypt: true } });
const adapter = createSqlServerAdapter(pool, 'id');
const engine  = new BCSyncEngine(bcClient, adapter);
```

### Custom adapter

```ts
import type { SyncAdapter } from '@ilmora/bc-sync';

const myAdapter: SyncAdapter = {
  async verifyDestination(table) {
    // optional: check table exists, throw if not
  },
  async loadExisting(table, pkField) {
    // Return Map<pkValue, record> for all current rows
    return new Map();
  },
  async bulkInsert(table, records) {
    // Batch-write new records
  },
  async update(table, pkValue, data) {
    // Update one existing record
  },
};
```

---

## Schema & Endpoint Discovery

```ts
import { BCMetadata } from '@ilmora/bc-metadata';

const meta = new BCMetadata({ tenantId, clientId, clientSecret, environment, companyId });

// Discover all endpoints
const endpoints = await meta.discoverEndpoints('api/v2.0');
// Also works for custom publisher paths:
const custom = await meta.discoverEndpoints('api/myPublisher/myGroup/1.0');

// Inspect schema for any endpoint
const schema = await meta.getEntitySchema('api/v2.0/companies({companyId})/customers');
schema.forEach(f => console.log(f.name, f.mappedType, f.isPrimaryKey));

// List all accessible companies
const companies = await meta.discoverCompanies();
```

---

## ⚠️ BC-Specific Gotchas — The Undocumented Traps

### 1. `$filter` is silently ignored on custom API pages

Custom AL pages extending `API` page type silently return ALL records when `$filter` is applied.
No error. No warning. All your data. Every time.

The sync engine detects this automatically and falls back to full in-memory comparison.
The raw client exposes the detection tool:

```ts
const records = await client.getAll(path, { odataQuery: '$filter=lastModifiedDateTime gt 2024-01-01T00:00:00Z' });
const honoured = BCClient.detectFilterHonoured(records, 'lastModifiedDateTime', '2024-01-01T00:00:00Z');
// false → BC returned old records too — sync engine compensates automatically
```

**Root cause:** Custom BC API pages don't apply `$filter` server-side.
**Impact:** Without detection, incremental sync re-processes every record on every run.
**Fix:** The engine detects this via timestamp comparison and applies the filter in memory.

---

### 2. Milliseconds in `$filter` cause silent total failure

BC OData V4 `$filter` silently returns ALL records (or empty) when the datetime value
contains milliseconds, e.g. `2024-01-15T10:30:45.003Z`.

```ts
// ❌ WRONG — BC silently ignores this filter
'$filter=lastModifiedDateTime gt 2024-01-15T10:30:45.003Z'

// ✅ CORRECT — strip milliseconds first
BCClient.normalizeFilterDate('2024-01-15T10:30:45.003Z')
// → '2024-01-15T10:30:45Z'

BCClient.buildIncrementalFilter('lastModifiedDateTime', '2024-01-15T10:30:45.003Z')
// → '$filter=lastModifiedDateTime gt 2024-01-15T10:30:45Z'
```

The sync engine and ODataBuilder.filter() both strip milliseconds automatically.

---

### 3. PATCH and DELETE require `If-Match` with ETag

BC returns `412 Precondition Failed` if you omit `If-Match` on PATCH or DELETE.

```ts
// Step 1: GET to obtain ETag
const r = await client.getOne<Customer>('api/v2.0/companies({companyId})/customers', 'GUID');
const etag = r.etag!;

// Step 2: Use ETag — required, never optional
await client.patch(path, 'GUID', { displayName: 'New' }, etag);
await client.delete(path, 'GUID', etag);

// Use '*' only when you deliberately want to skip the concurrency check:
await client.patch(path, 'GUID', data, '*'); // ⚠️ may overwrite concurrent edits
```

---

### 4. BC rate limits — `Retry-After` must be respected

BC sends `Retry-After: N` (seconds) on `429 Too Many Requests`.
The client reads and waits exactly that long before retrying.
Never sleep a fixed delay — the actual limit resets at unpredictable times.

---

### 5. `@odata.nextLink` pagination — BC returns max 100–1000 records per page

BC never guarantees how many records per page. Use `client.getAll()` which
follows `@odata.nextLink` automatically. Never assume one request gets everything.

---

### 6. Company ID injection — `{companyId}` placeholder

Pass `companyId` in the config and use `{companyId}` in paths:

```ts
// Config once
const client = new BCClient({ ..., companyId: 'xxxxxxxx-...' });

// All paths — companyId injected automatically
await client.get('api/v2.0/companies({companyId})/customers');
await client.get('api/v2.0/companies({companyId})/items');

// Multi-company — clone the client with a different companyId
const client2 = client.withCompany('yyyyyyyy-...');

// Discover companyId by name
const id = await client.resolveCompanyId('CRONUS International Ltd.');
```

---

### 7. Bound actions return 204 by default

BC bound actions (makeInvoice, post, send, etc.) return `204 No Content` by default.
To return a document body, your AL action codeunit must call
`SetResultCode(WebServiceActionResultCode::Created)` and populate `WebServiceActionContext`.

```ts
const result = await client.callAction(path, entityId, 'Microsoft.NAV.makeInvoice');
// result.status === 204 → succeeded with no body (default BC behaviour)
// result.data  !== undefined → AL action was configured to return the document
```

---

## Examples

- [`examples/basic-get`](./examples/basic-get) — list companies, fetch customers with OData options
- [`examples/discover-endpoints`](./examples/discover-endpoints) — discover and inspect all endpoints and schemas
- [`examples/sync-to-supabase`](./examples/sync-to-supabase) — incremental BC → Supabase sync with persistence

---

## Why this SDK exists

There is no other TypeScript BC SDK on npm that documents:

- The silent `$filter` ignore bug on custom pages
- The millisecond timestamp filter failure
- The mandatory ETag requirement for mutations
- Proper Retry-After handling on 429
- `@odata.nextLink` pagination patterns

This was extracted from `ilmora-beats`, a production system running live BC integrations.
Every pattern here was found by hitting BC in production, breaking things, and fixing them.

---

## License

MIT
