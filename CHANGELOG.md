# Changelog

## [1.0.0] — 2024-11

### Added
- `@ilmora/types` — complete BC OData v4 type system
- `@ilmora/client` — `ODataBuilder` + full `BCClient` with token caching, ETag, retry, pagination
- `@ilmora/metadata` — `BCMetadata` with pure-regex `$metadata` XML parser, schema discovery
- `@ilmora/sync` — `BCSyncEngine` with Supabase and SQL Server adapters
- `bcstudio` Python package — full port of client, odata, metadata, sync + adapters
- `bcstudio/bc-sdk` PHP package — ODataBuilder, BCClient, all params
- Documented 7 undocumented BC API traps: silent `$filter` ignore, millisecond datetime bug, mandatory ETag, 429 Retry-After, nextLink pagination, companyId injection, bound action 204
