---
title: The traps it handles
description: Filters, datetime milliseconds, ETags, HTTP 429, pagination, company IDs and bound action status codes.
---

These are the behaviours the SDK is written to handle. Where Microsoft Learn documents the rule, this page says so.

## 1. `$filter` ignored on some custom API pages

No error, just more rows than you asked for. Custom API pages do not always apply `$filter` on the server. The SDK can detect this and apply the filter in memory.

## 2. Datetime `$filter` values with milliseconds

Some calls fail or return the wrong set when the timestamp includes sub-seconds. The OData builder strips milliseconds before the request.

```
# can fail or return the wrong set
$filter=lastModifiedDateTime gt 2024-01-15T10:30:45.003Z

# milliseconds stripped
$filter=lastModifiedDateTime gt 2024-01-15T10:30:45Z
```

## 3. PATCH and DELETE need `If-Match` with an ETag

Learn documents this; a missing header fails the call. `patch()` and `delete()` require the ETag. Pass `*` only if you deliberately skip the concurrency check.

## 4. HTTP 429 rate limits

Learn requires a retry with a cool-off. The client retries and, when Business Central sends `Retry-After`, waits for that value.

## 5. `@odata.nextLink` pagination

Page size is not something you can assume. `getAll()` follows the next link until the set is complete.

## 6. Company ID in the path

Set `companyId` once, use `{companyId}` in paths, or call `withCompany()` / `resolveCompanyId()`.

## 7. Bound actions often return 204

Standard API v2.0 actions such as `salesOrders` `shipAndInvoice` and `purchaseOrders` `receiveAndInvoice` return 204 with no body. Learn documents both actions and the 204 response.

A custom action that uses `SetResultCode(Created)` returns 201 and a `Location` header, not the document JSON. `callAction()` reports the status. Follow `Location` or GET the new record if you need the document.

```ts
const result = await client.callAction(
  'api/v2.0/companies({companyId})/salesOrders',
  orderId,
  'Microsoft.NAV.shipAndInvoice'
);
// result.status === 204: succeeded, no body
```

See also the [bound actions](/guides/bound-actions/) guide copied from the repository, with the same status-code correction applied at build time.
