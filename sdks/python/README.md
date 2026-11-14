# bcstudio — Python SDK for Business Central

```bash
pip install bcstudio
pip install bcstudio[supabase]    # + Supabase adapter
pip install bcstudio[sqlserver]   # + SQL Server adapter
pip install bcstudio[all]         # everything
```

## Quick start

```python
from bcstudio import BCClient, BCConnectionConfig, ODataBuilder, ODataFilter

config = BCConnectionConfig(
    tenant_id     = "xxxxxxxx-...",
    client_id     = "xxxxxxxx-...",
    client_secret = "your-secret",
    environment   = "production",
    company_id    = "xxxxxxxx-...",
)
client = BCClient(config)

# List companies (discover company_id)
companies = client.list_companies()

# OData query builder — all params
qs = (ODataBuilder()
      .top(50)
      .select("id", "number", "displayName", "lastModifiedDateTime")
      .filter([ODataFilter("lastModifiedDateTime", "gt", "2024-01-15T10:30:45.003Z")])
      # ↑ milliseconds auto-stripped
      .orderby("displayName", "asc")
      .expand("customerPaymentTerms")
      .count()
      .build())

# GET with options dict
result = client.get(
    "api/v2.0/companies({companyId})/customers",
    options={"top": 50, "select": ["id", "displayName"], "orderby": "displayName asc"}
)

# GET all pages (auto follows @odata.nextLink)
all_customers = client.get_all("api/v2.0/companies({companyId})/customers")

# CRUD with ETag
record   = client.get_one("api/v2.0/companies({companyId})/customers", "GUID")
etag     = record.etag  # REQUIRED for PATCH/DELETE
client.patch("api/v2.0/companies({companyId})/customers", "GUID",
             {"displayName": "New Name"}, etag)
client.delete("api/v2.0/companies({companyId})/customers", "GUID", etag)

# Bound actions
client.call_action(
    "api/v2.0/companies({companyId})/salesOrders",
    "ORDER-GUID", "Microsoft.NAV.makeInvoice"
)

# Multi-company
client2 = client.with_company("other-company-guid")
```

## Sync to Supabase

```python
from bcstudio import BCSyncEngine, FieldMapping, SyncJobConfig
from bcstudio.sync import SupabaseAdapter
from supabase import create_client

sb = create_client(SUPABASE_URL, SUPABASE_KEY)
engine = BCSyncEngine(client, SupabaseAdapter(sb, pk_field="id"))

result = engine.run(SyncJobConfig(
    source_endpoint      = "api/v2.0/companies({companyId})/customers",
    destination_table    = "bc_customers",
    sync_mode            = "incremental",
    incremental_field    = "lastModifiedDateTime",
    last_incremental_value = saved_value,  # None for first run
    field_mappings = [
        FieldMapping("id",                   "id",          "guid"),
        FieldMapping("number",               "number",      "string"),
        FieldMapping("displayName",          "name",        "string"),
        FieldMapping("lastModifiedDateTime", "modified_at", "datetime"),
    ],
))
print(result.records_inserted, result.records_updated)
# persist result.next_incremental_value for next run
```
