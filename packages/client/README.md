# @ilmora/bc-client

HTTP client for Business Central OData v4 APIs — OAuth2, ETag, rate-limiting, pagination, and bound actions.

```ts
import { BCClient } from '@ilmora/bc-client';

const client = new BCClient({
  tenantId: '...',
  environment: 'production',
  clientId: '...',
  clientSecret: '...',
  companyId: '...',
});

const customers = await client.getAll('api/v2.0/companies({companyId})/customers');
```

## Bound actions

Call BC bound actions with `callAction()`:

```ts
// Standard API v2.0 — salesOrders
await client.callAction(
  'api/v2.0/companies({companyId})/salesOrders',
  orderId,
  'Microsoft.NAV.shipAndInvoice'
);

// Standard API v2.0 — purchaseOrders
await client.callAction(
  'api/v2.0/companies({companyId})/purchaseOrders',
  poId,
  'Microsoft.NAV.receiveAndInvoice'
);
```

For the standard Business Central API v2.0, the common order actions are
`salesOrders` → `Microsoft.NAV.shipAndInvoice` and
`purchaseOrders` → `Microsoft.NAV.receiveAndInvoice`
(not `makeInvoice` on those entities).

### Response status codes

- Standard actions such as `shipAndInvoice` / `makeInvoice` typically return **204 No Content** (no JSON body).
- An AL bound action that calls `SetResultCode(WebServiceActionResultCode::Created)` returns **201 Created** with a `Location` header and **no JSON body**.

See Microsoft’s docs:
[Creating and Interacting with an OData V4 Bound Action](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-creating-and-interacting-with-odatav4-bound-action).

## License

MIT © Ilmora
