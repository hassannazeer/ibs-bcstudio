/**
 * Copy ../docs/*.md into src/content/docs/guides/ and inject Starlight
 * frontmatter so repo doc edits flow into the site on every build.
 *
 * Also applies a small set of known fact and typography corrections.
 * Those corrections are listed in docs-site/README.md. Do not edit
 * packages/ or sdks/ from this script.
 */
import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repoRoot = path.resolve(root, '..');
const sourceDir = path.join(repoRoot, 'docs');
const outDir = path.join(root, 'src/content/docs/guides');

const PAGE_META = {
  'getting-started.md': {
    title: 'Getting started (from the repo)',
    description: 'Prerequisites, install names, and a first Business Central request with BCStudio.',
    sidebar: { order: 1, label: 'Getting started' },
  },
  'odata-builder.md': {
    title: 'OData query builder',
    description: 'Build Business Central OData queries and strip milliseconds from datetime filters.',
    sidebar: { order: 2, label: 'OData builder' },
  },
  'crud-etag.md': {
    title: 'CRUD and ETag',
    description: 'Create, read, update and delete Business Central records with a required ETag.',
    sidebar: { order: 3, label: 'CRUD and ETag' },
  },
  'bound-actions.md': {
    title: 'Bound actions',
    description: 'Call Business Central bound actions and read the HTTP status they return.',
    sidebar: { order: 4, label: 'Bound actions' },
  },
  'bc-gotchas.md': {
    title: 'BC API traps (from the repo)',
    description: 'Filters, ETags, retries, paging, company IDs and bound action status codes.',
    sidebar: { order: 5, label: 'API traps (repo)' },
  },
  'sync-engine.md': {
    title: 'Sync engine',
    description: 'Use the BCStudio sync engine to copy Business Central data to a destination.',
    sidebar: { order: 6, label: 'Sync engine' },
  },
};

const LINK_MAP = {
  'getting-started.md': '/guides/getting-started/',
  'odata-builder.md': '/guides/odata-builder/',
  'crud-etag.md': '/guides/crud-etag/',
  'bound-actions.md': '/guides/bound-actions/',
  'bc-gotchas.md': '/guides/bc-gotchas/',
  'sync-engine.md': '/guides/sync-engine/',
};

function yamlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function frontmatter(meta) {
  const lines = [
    '---',
    `title: ${yamlQuote(meta.title)}`,
    `description: ${yamlQuote(meta.description)}`,
    'sidebar:',
    `  order: ${meta.sidebar.order}`,
    `  label: ${yamlQuote(meta.sidebar.label)}`,
    '---',
    '',
  ];
  return lines.join('\n');
}

function stripEmDashes(text) {
  return text
    .replaceAll('\u2014', ' - ')
    .replaceAll('\u2013', '-')
    .replace(/[ \t]+\-[ \t]+/g, ' - ');
}

function rewriteLinks(text) {
  return text.replace(
    /\]\(\.\/([a-z0-9-]+\.md)\)/gi,
    (match, file) => {
      const href = LINK_MAP[file];
      return href ? `](${href})` : match;
    },
  );
}

function applyFactFixes(filename, text) {
  let out = text;

  out = out.replaceAll('pip install bcstudio', 'pip install ibs-bcstudio');
  out = out.replaceAll('composer require bcstudio/bc-sdk', 'composer require ilmora/ibs-bcstudio');

  if (filename === 'getting-started.md') {
    const notice = [
      '',
      ':::caution[Registry packages are not published yet]',
      'As of 15 November 2026, the npm, Packagist and PyPI packages are not live.',
      'Clone the repository until they are published:',
      '',
      '```bash',
      'git clone https://github.com/hassannazeer/ibs-bcstudio.git',
      '```',
      '',
      'The registry commands below are the intended package names after publish. They will fail if you run them today.',
      ':::',
      '',
    ].join('\n');
    out = out.replace('## Install\n', `## Install\n${notice}`);
  }

  if (filename === 'bc-gotchas.md') {
    const oldSection = /## 7\. Bound actions return 204 No Content by default[\s\S]*?(?=\n## |\nNext:|$)/;
    const next = out.match(/\nNext:[\s\S]*$/)?.[0] ?? '';
    const replacement = [
      '## 7. Bound actions often return 204 No Content',
      '',
      '**What happens:** Standard API v2.0 actions such as `salesOrders` `shipAndInvoice` and `purchaseOrders` `receiveAndInvoice` return `204 No Content` with no body. Learn documents this.',
      '',
      'A custom action that uses `SetResultCode(Created)` returns `201 Created` with a `Location` header and no body, not the document JSON.',
      '',
      '**SDK behaviour:** `callAction()` reports the status. Follow `Location` or GET the new record if you need the document.',
      '',
    ].join('\n');
    if (oldSection.test(out)) {
      out = out.replace(oldSection, replacement) + (out.includes('Next:') ? '' : '');
      // Keep a trailing Next link if the replace dropped it by ending at Next
      if (!out.includes('Next:') && next) {
        out = out.trimEnd() + '\n' + next;
      }
    } else {
      out = out.replace(
        /the actual document on 200\/201 \(when AL is configured to return it\)\.?/g,
        'a 201 from `SetResultCode(Created)` includes a Location header and no body. Follow Location or GET the new record if you need the document.',
      );
    }
  }

  if (filename === 'bound-actions.md') {
    const learnNote = [
      '',
      ':::note[Standard API v2.0 actions]',
      'On the standard Business Central API v2.0, `salesOrders` exposes `Microsoft.NAV.shipAndInvoice` and `purchaseOrders` exposes `Microsoft.NAV.receiveAndInvoice`. Both return `204 No Content` with no body. See [salesOrder](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_salesorder) and [purchaseOrder](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_purchaseorder) on Microsoft Learn.',
      'The examples below are copied from the repository docs. Treat any action name that is not on Learn as unverified until the repo list is updated.',
      ':::',
      '',
    ].join('\n');
    out = out.replace(
      'Bound actions trigger BC workflow operations from outside BC.\nThey POST to `entity(GUID)/Microsoft.NAV.actionName`.',
      'Bound actions trigger BC workflow operations from outside BC.\nThey POST to `entity(GUID)/Microsoft.NAV.actionName`.' + learnNote,
    );

    const oldReturn = /## Return value[\s\S]*?(?=\n## )/;
    const returnSection = [
      '## Return value',
      '',
      'Standard API v2.0 actions such as `shipAndInvoice` and `receiveAndInvoice` return `204 No Content` with no body. The `.data` field on the response is `undefined`.',
      '',
      'A custom action that uses `SetResultCode(Created)` returns `201 Created` with a `Location` header and no body, not the document JSON. `callAction()` reports the status. Follow `Location` or GET the new record if you need the document.',
      '',
      '```ts',
      "const result = await client.callAction(path, guid, 'Microsoft.NAV.shipAndInvoice');",
      '// result.status === 204: succeeded, no body (standard API v2.0)',
      '// result.status === 201: SetResultCode(Created). Look at Location, not the body',
      '```',
      '',
    ].join('\n');
    if (oldReturn.test(out)) {
      out = out.replace(oldReturn, returnSection);
    }
  }

  return out;
}

function stripLeadingH1(text) {
  return text.replace(/^# .+\n+/, '');
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const files = (await readdir(sourceDir)).filter((name) => name.endsWith('.md')).sort();
  if (files.length === 0) {
    throw new Error(`No markdown files found in ${sourceDir}`);
  }

  for (const name of files) {
    const meta = PAGE_META[name] ?? {
      title: name.replace(/\.md$/, ''),
      description: 'BCStudio documentation copied from the repository docs folder.',
      sidebar: { order: 99, label: name.replace(/\.md$/, '') },
    };
    const source = await readFile(path.join(sourceDir, name), 'utf8');
    let body = stripLeadingH1(source);
    body = applyFactFixes(name, body);
    body = rewriteLinks(body);
    body = stripEmDashes(body);
    const destName = name === 'crud-etag.md' ? 'crud-etag.md' : name;
    await writeFile(path.join(outDir, destName), `${frontmatter(meta)}${body.trim()}\n`);
    process.stdout.write(`synced ${name}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
