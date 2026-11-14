# Bound Actions

Bound actions trigger BC workflow operations from outside BC.
They POST to `entity(GUID)/Microsoft.NAV.actionName`.

## All built-in actions

### Sales Orders

```ts
const path = 'api/v2.0/companies({companyId})/salesOrders';

await client.callAction(path, orderGuid, 'Microsoft.NAV.makeInvoice');
await client.callAction(path, orderGuid, 'Microsoft.NAV.makeQuote');
await client.callAction(path, orderGuid, 'Microsoft.NAV.post');
await client.callAction(path, orderGuid, 'Microsoft.NAV.reopen');
await client.callAction(path, orderGuid, 'Microsoft.NAV.releaseOrder');
await client.callAction(path, orderGuid, 'Microsoft.NAV.copyDocument', {
  documentType: 'Order',
  documentNo:   'SO-00123',
  includeHeader: true,
  recalculateLines: true,
});
```

### Sales Invoices

```ts
const path = 'api/v2.0/companies({companyId})/salesInvoices';

await client.callAction(path, invoiceGuid, 'Microsoft.NAV.post');
await client.callAction(path, invoiceGuid, 'Microsoft.NAV.send');
await client.callAction(path, invoiceGuid, 'Microsoft.NAV.cancel');
await client.callAction(path, invoiceGuid, 'Microsoft.NAV.cancelAndCreateCreditMemo');
```

### Purchase Orders

```ts
const path = 'api/v2.0/companies({companyId})/purchaseOrders';

await client.callAction(path, poGuid, 'Microsoft.NAV.post');
await client.callAction(path, poGuid, 'Microsoft.NAV.reopen');
```

## Return value

BC actions return `204 No Content` by default. The `.data` field on the response
will be `undefined` unless the AL codeunit is configured to return a document:

```ts
const result = await client.callAction(path, guid, 'Microsoft.NAV.makeInvoice');
// result.status === 204 → succeeded, no body (default)
// result.data !== undefined → AL action configured to return the new invoice
```

## Custom AL actions

Any `[ServiceEnabled]` procedure in an AL extension works the same way:

```ts
await client.callAction(
  'api/myPublisher/myGroup/1.0/companies({companyId})/myEntities',
  entityGuid,
  'Microsoft.NAV.myCustomAction',
  { param1: 'value' }
);
```

Next: [Sync Engine](./sync-engine.md) →
