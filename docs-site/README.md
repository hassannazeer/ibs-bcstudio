# BCStudio docs site

Starlight (Astro) docs for BCStudio, meant to be published at https://dev.ilmora.tech on the free Cloudflare Pages plan.

This folder is a standalone Node project. It is not part of the repository npm workspaces. A Cloudflare Pages build with root directory `docs-site` only installs the dependencies listed here.

## How docs stay in sync with the repo

On every build, `scripts/sync-docs.mjs` copies `../docs/*.md` into `src/content/docs/guides/` and injects Starlight frontmatter. Edits to the Markdown files in `docs/` therefore appear on the site the next time the site is built.

With Cloudflare Pages Git integration on this repository:

- Every push to `main` redeploys production at https://dev.ilmora.tech
- Every branch and pull request gets a preview URL

You do not need a webhook or a cron job. The Pages project watches the GitHub repo.

The sync script also applies a short list of known corrections so the site does not repeat errors that are still in some repo docs:

- typography: em dashes and en dashes become ASCII hyphens
- install names: `pip install ibs-bcstudio` and `composer require ilmora/ibs-bcstudio` (not the older README names)
- a "not published yet" notice on the copied Getting started page
- bound actions: standard API v2.0 actions are `shipAndInvoice` and `receiveAndInvoice`, both 204 with no body; `SetResultCode(Created)` returns 201 with a Location header and no body

Those corrections are site-side only. This project does not edit `packages/` or `sdks/`.

## Local development

Node 22 or later.

```bash
cd docs-site
npm ci
npm run dev
```

Build and preview the static output:

```bash
npm run build
npm run preview
```

`npm run build` runs the sync script, then `astro build`. The output directory is `dist/`. Pagefind search is generated as part of that build.

## Cloudflare Pages settings

Create a Pages project from the GitHub repo `hassannazeer/ibs-bcstudio` (or the org fork you use in production). Use these values:

| Setting | Value |
|---|---|
| Framework preset | Astro, or None |
| Root directory | `docs-site` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Production branch | `main` |
| Node version | `22` |

Set these environment variables in the Pages project:

```
NODE_VERSION=22
ASTRO_TELEMETRY_DISABLED=1
```

Cloudflare Pages also honours `docs-site/.nvmrc`, which contains `22`. Prefer the environment variable so the version is visible in the project settings.

Do not enable SSR or the Cloudflare adapter. This site is a static Astro build. The free Pages plan is enough.

### Custom domain

1. In the Pages project, open Custom domains and add `dev.ilmora.tech`.
2. In DNS for `ilmora.tech`, add the CNAME (or the records Cloudflare shows) for `dev` pointing at the project `pages.dev` hostname.
3. Wait for HTTPS to become active, then confirm https://dev.ilmora.tech and a known page such as https://dev.ilmora.tech/quickstart/.

### Confirm that a push redeploys

1. Merge this `docs-site` branch to `main` (or merge via PR).
2. Confirm the first Pages production deployment succeeds and the custom domain serves the site.
3. Push a small docs-only change to `docs/*.md` on `main`.
4. Confirm Pages starts a new production deployment and the updated Markdown is visible on the live site.

Pull request previews: open a PR that changes `docs-site/` or `docs/`. Pages should post a preview URL on the PR.

## Package status on first launch

As of 15 November 2026 the TypeScript, PHP and Python packages are not on npm, Packagist or PyPI. The site labels registry installs as coming soon and shows `git clone` as the command that works today. After the packages are published, remove or narrow those notices on `index.mdx`, `install.mdx`, `quickstart.mdx` and `packages.md`.

## Brand and fact rules for this site

- No em dashes
- No Microsoft partner or certification claims, no MIRA endorsement, no pricing, no invented statistics
- Facts must match the repository APIs and Microsoft Learn
- PHP samples stay off the site until the namespace and autoload map match
