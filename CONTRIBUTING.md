# Contributing

## Setup

```bash
git clone https://github.com/bcstudio/bc-sdk.git
cd bc-sdk
npm install
cp .env.example .env   # fill in your BC credentials
```

## Structure

```
packages/types      — shared TypeScript interfaces
packages/client     — ODataBuilder + BCClient
packages/metadata   — BCMetadata (endpoint + schema discovery)
packages/sync       — BCSyncEngine + adapters
sdks/python         — Python bcstudio package
sdks/php            — PHP bcstudio/bc-sdk package
examples/           — runnable TypeScript examples
docs/               — documentation source
```

## Running examples

```bash
cd examples/basic-get
npx tsx index.ts
```

## Submitting changes

1. Fork the repo
2. Create a branch: `git checkout -b fix/describe-the-fix`
3. Make changes and commit with a clear message
4. Open a pull request — describe what changed and why

## Reporting a BC quirk

If you've hit a BC API behaviour not documented here, open an issue with:
- The endpoint / action involved
- What you expected vs what happened
- A minimal code snippet to reproduce it

These are the most valuable contributions to this project.
