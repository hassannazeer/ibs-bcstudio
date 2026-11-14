# Getting Started

## Prerequisites

- A Microsoft Entra ID (Azure AD) app registration with:
  - `client_credentials` grant type
  - API permission: `Dynamics 365 Business Central` → `Financials.ReadWrite.All`
- Your BC environment name (`production`, `sandbox`, or a named sandbox)

## Install

```bash
# TypeScript / Node.js
npm install @ilmora/bc-client

# Python
pip install bcstudio

# PHP
composer require bcstudio/bc-sdk
```

## Connect

```ts
import { BCClient } from '@ilmora/bc-client';

const client = new BCClient({
  tenantId:     process.env.BC_TENANT_ID!,
  clientId:     process.env.BC_CLIENT_ID!,
  clientSecret: process.env.BC_CLIENT_SECRET!,
  environment:  'production',
});
```

## Discover your company ID

```ts
const id = await client.resolveCompanyId('CRONUS International Ltd.');
const c   = client.withCompany(id!);
```

Or list all companies:

```ts
const result = await client.listCompanies();
result.data?.value.forEach(c => console.log(c.id, c.name));
```

## First request

```ts
const customers = await c.getAll('api/v2.0/companies({companyId})/customers');
console.log(customers.length);
```

Next: [OData Query Builder](./odata-builder.md) →
