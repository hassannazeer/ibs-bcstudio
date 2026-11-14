# Sync Engine

`BCSyncEngine` handles full and incremental sync from any BC endpoint to any
destination database, including:

- Detecting when BC silently ignores `$filter` (custom API pages)
- Stripping milliseconds from incremental cutoff timestamps
- Deduplication by primary key
- Change detection (skip records that haven't changed)
- Bulk insert in configurable batches
- Concurrency-safe (one job per endpoint:table pair)

## Quick start

```ts
import { BCClient }              from '@ilmora/bc-client';
import { BCSyncEngine }          from '@ilmora/bc-sync';
import { createSupabaseAdapter }  from '@ilmora/bc-sync/adapters/supabase';
import { createClient }           from '@supabase/supabase-js';

const client  = new BCClient({ ...config, companyId });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const engine  = new BCSyncEngine(client, createSupabaseAdapter(supabase, 'id'));

const result = await engine.run({
  sourceEndpoint:       'api/v2.0/companies({companyId})/customers',
  destinationTable:     'bc_customers',
  primaryKeyField:      'id',
  syncMode:             'incremental',
  incrementalField:     'lastModifiedDateTime',
  lastIncrementalValue: await db.get('bc_customers_last_sync'),
  fieldMappings: [
    { sourceField: 'id',                   destinationField: 'id',          dataType: 'guid'     },
    { sourceField: 'number',               destinationField: 'number',      dataType: 'string'   },
    { sourceField: 'displayName',          destinationField: 'name',        dataType: 'string'   },
    { sourceField: 'email',                destinationField: 'email',       dataType: 'string'   },
    { sourceField: 'lastModifiedDateTime', destinationField: 'modified_at', dataType: 'datetime' },
  ],
});

// Always persist for next run
await db.set('bc_customers_last_sync', result.nextIncrementalValue);
```

## SyncResult fields

```ts
{
  status:                'success' | 'warning' | 'error' | 'skipped',
  recordsRead:           1500,
  recordsInserted:       42,
  recordsUpdated:        8,
  recordsSkipped:        1450,
  recordsFailed:         0,
  durationSeconds:       4.2,
  nextIncrementalValue:  '2024-11-14T09:12:33Z',  // ← ALWAYS persist this
  warnings:              [],
  meta: {
    pagesFetched:    2,
    filterApplied:   true,
    filterHonoured:  false,  // ← BC silently ignored $filter, engine compensated
    filterCutoff:    '2024-01-01T00:00:00Z',
  }
}
```

## Adapters

### Supabase

```ts
import { createSupabaseAdapter } from '@ilmora/bc-sync/adapters/supabase';
const adapter = createSupabaseAdapter(supabase, 'id');
```

### SQL Server

```ts
import { createSqlServerAdapter } from '@ilmora/bc-sync/adapters/sqlserver';
const adapter = createSqlServerAdapter(pool, 'id');
```

### Custom adapter

```ts
import type { SyncAdapter } from '@ilmora/bc-sync';

const adapter: SyncAdapter = {
  async verifyDestination(table) { /* optional */ },
  async loadExisting(table, pkField) { return new Map(); },
  async bulkInsert(table, records) { /* batch write */ },
  async update(table, pkValue, data) { /* single update */ },
};
```

Next: [BC Gotchas](./bc-gotchas.md) →
