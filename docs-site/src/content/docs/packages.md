---
title: Packages
description: TypeScript, Python and PHP packages in the BCStudio repository, and their intended registry names.
---

BCStudio is one product. The language ports live in the same [GitHub repository](https://github.com/hassannazeer/ibs-bcstudio). You only need the packages you use. The project is MIT licensed. You do not need to be an Ilmora customer to use it.

As of 15 November 2026 none of these packages are on npm, Packagist or PyPI. Install names below are the intended names after publish. See [Install](/install/).

## TypeScript

| Package | Path | Role |
|---|---|---|
| `@ilmora/bc-client` | `packages/client` | OAuth2 HTTP client for Business Central OData v4 APIs |
| `@ilmora/bc-types` | `packages/types` | Shared TypeScript interfaces |
| `@ilmora/bc-metadata` | `packages/metadata` | Discover endpoints and parse `$metadata` |
| `@ilmora/bc-sync` | `packages/sync` | Business Central to destination sync engine, with pluggable adapters |

## Python

| Project name | Import | Path |
|---|---|---|
| `ibs-bcstudio` | `bcstudio` | `sdks/python` |

## PHP

| Composer name | Path | Note |
|---|---|---|
| `ilmora/ibs-bcstudio` | `sdks/php` | Coming soon. A usage sample is held back until the source namespace matches the autoload map (`IbsBCStudio\\` in composer.json, `BCStudio` in the source). |

## Source and issues

- Repository: [github.com/hassannazeer/ibs-bcstudio](https://github.com/hassannazeer/ibs-bcstudio)
- Issues: [github.com/hassannazeer/ibs-bcstudio/issues](https://github.com/hassannazeer/ibs-bcstudio/issues)
- License: [MIT](/license/)
