# OData Query Builder

`ODataBuilder` constructs BC-safe OData v4 query strings, handling the datetime
millisecond bug automatically.

## All parameters

```ts
import { ODataBuilder } from '@ilmora/bc-client';

const qs = new ODataBuilder()
  .top(100)                                    // $top
  .skip(0)                                     // $skip
  .select('id', 'number', 'displayName')       // $select
  .filter('blocked eq false')                  // $filter — raw string
  .filter([                                    // $filter — structured (AND joined)
    { field: 'lastModifiedDateTime', op: 'gt', value: '2024-01-01T00:00:00.003Z' },
    // ↑ milliseconds stripped automatically → ...00:00:00Z
  ])
  .orderby('displayName', 'asc')              // $orderby
  .expand('customerPaymentTerms')             // $expand
  .count()                                    // $count=true
  .search('Acme')                             // $search
  .raw('$apply=aggregate(amount with sum as total)')  // passthrough
  .build();
```

## Supported filter operators

| Operator | OData | Example |
|---|---|---|
| `eq` | `eq` | `blocked eq false` |
| `ne` | `ne` | `currencyCode ne 'USD'` |
| `gt` | `gt` | `lastModifiedDateTime gt 2024-01-01T00:00:00Z` |
| `ge` | `ge` | `unitPrice ge 100` |
| `lt` | `lt` | `unitPrice lt 1000` |
| `le` | `le` | `unitPrice le 1000` |
| `contains` | `contains()` | `contains(displayName,'Acme')` |
| `startswith` | `startswith()` | `startswith(number,'C')` |
| `endswith` | `endswith()` | `endswith(email,'.com')` |

## BC datetime gotcha — milliseconds

BC OData silently returns ALL records (or none) when the datetime value contains milliseconds:

```ts
// ❌ Wrong — BC silently ignores this
'$filter=lastModifiedDateTime gt 2024-01-15T10:30:45.003Z'

// ✅ Correct — ODataBuilder handles this automatically
new ODataBuilder()
  .filter([{ field: 'lastModifiedDateTime', op: 'gt', value: '2024-01-15T10:30:45.003Z' }])
// → $filter=lastModifiedDateTime gt 2024-01-15T10:30:45Z
```

Or strip manually:
```ts
BCClient.normalizeFilterDate('2024-01-15T10:30:45.003Z')
// → '2024-01-15T10:30:45Z'
```

Next: [CRUD & ETag](./crud-etag.md) →
