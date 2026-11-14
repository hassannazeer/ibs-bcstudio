# CRUD & ETag

## Why ETag matters in BC

BC returns `412 Precondition Failed` on PATCH and DELETE when `If-Match` is omitted.
This SDK enforces ETag via method signatures — you cannot call `patch()` or `delete()` without it.

## Flow

```ts
// 1. CREATE → captures ETag
const created = await client.post(
  'api/v2.0/companies({companyId})/customers',
  { displayName: 'Acme Corp', currencyCode: 'USD' }
);
const etag = created.etag!;

// 2. READ → refreshes ETag (always use the freshest one)
const record = await client.getOne(
  'api/v2.0/companies({companyId})/customers', 'GUID'
);
const freshEtag = record.etag!;

// 3. UPDATE — etag required
await client.patch(
  'api/v2.0/companies({companyId})/customers', 'GUID',
  { displayName: 'Acme Corp Ltd.' },
  freshEtag
);

// 4. DELETE — etag required
await client.delete(
  'api/v2.0/companies({companyId})/customers', 'GUID',
  freshEtag
);
```

## 412 Concurrency conflict

A `412` means someone else modified the record between your GET and your PATCH.
Fetch again, merge changes, retry:

```ts
if (BCClient.isConcurrencyConflict(result)) {
  // re-fetch and retry
}
```

## Bypass ETag check (use sparingly)

Pass `'*'` as the ETag to skip BC's concurrency check.
This overwrites concurrent edits silently — only use it when you own the data exclusively.

```ts
await client.patch(path, 'GUID', data, '*');
```

Next: [Bound Actions](./bound-actions.md) →
