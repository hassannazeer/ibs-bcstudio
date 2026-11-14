# BC API Gotchas

Undocumented behaviours found in production. Every one of these is handled
automatically by this SDK.

---

## 1. `$filter` is silently ignored on custom API pages

**What happens:** BC custom API pages (AL `page type = API`) return ALL records
regardless of your `$filter`. No error. No warning. All your data. Every time.

**Why:** Custom BC page objects don't implement server-side `$filter` by default.
Microsoft's standard v2.0 endpoints do; your custom ones may not.

**Detection:**

```ts
const records = await client.getAll(path, { odataQuery: '$filter=...' });
const honoured = BCClient.detectFilterHonoured(records, 'lastModifiedDateTime', cutoff);
// false → BC returned old records too
```

**SDK behaviour:** `BCSyncEngine` detects this and applies the filter in memory,
logging a warning in `result.warnings` and setting `result.meta.filterHonoured = false`.

---

## 2. Milliseconds in `$filter` cause silent total failure

**What happens:** BC OData v4 silently returns all records (or zero) when
the datetime value in `$filter` contains milliseconds.

```
# ❌ SILENT FAILURE — returns everything
$filter=lastModifiedDateTime gt 2024-01-15T10:30:45.003Z

# ✅ WORKS
$filter=lastModifiedDateTime gt 2024-01-15T10:30:45Z
```

**Root cause:** BC's OData datetime parser doesn't handle sub-second precision.

**SDK behaviour:** `ODataBuilder.filter()`, `BCSyncEngine`, and `BCClient.normalizeFilterDate()`
all strip milliseconds automatically.

---

## 3. PATCH and DELETE require `If-Match` with ETag

**What happens:** BC returns `412 Precondition Failed` if you omit the `If-Match` header.

**SDK behaviour:** `patch()` and `delete()` require `etag` as a parameter.
You cannot call them without it.

Pass `'*'` to skip the check (overwrites concurrent edits — use carefully).

---

## 4. `Retry-After` on 429 must be respected

**What happens:** BC rate-limits aggressively and sends a `Retry-After: N` header
(seconds to wait). Fixed-delay retries don't work — the limit resets unpredictably.

**SDK behaviour:** Every request reads `Retry-After` and waits exactly that long
before retrying.

---

## 5. `@odata.nextLink` pagination — never assume one page

**What happens:** BC returns between 1 and 1000 records per page depending on
endpoint, field count, and server load. There is no guaranteed page size.

**SDK behaviour:** `client.getAll()` follows `@odata.nextLink` automatically.
Never use `client.get()` for large datasets — you will miss records.

---

## 6. `{companyId}` must be injected at request time

**What happens:** BC API paths contain the literal string `{companyId}` as a
placeholder. It is not a URL template variable — it must be replaced before
the HTTP request is made.

**SDK behaviour:** Pass `companyId` in the config and use `{companyId}` in paths.
The SDK injects it automatically.

---

## 7. Bound actions return 204 No Content by default

**What happens:** `Microsoft.NAV.makeInvoice`, `Microsoft.NAV.post`, etc. return
`204 No Content` by default. The response body is empty.

To return the resulting document, the AL codeunit must call:
```al
WebServiceActionContext.SetObjectType(ObjectType::Page);
WebServiceActionContext.SetObjectId(Page::"Sales Invoice");
WebServiceActionContext.AddEntityKey(SalesInvoiceHeader.FieldNo(SystemId), InvoiceId);
WebServiceActionContext.SetResultCode(WebServiceActionResultCode::Created);
```

**SDK behaviour:** `callAction()` returns `result.data = undefined` on 204, and
the actual document on 200/201 (when AL is configured to return it).
