/**
 * Basic GET — list BC companies and fetch a few customers.
 *
 * Run:
 *   npx ts-node index.ts
 *
 * Env vars required:
 *   BC_TENANT_ID, BC_CLIENT_ID, BC_CLIENT_SECRET, BC_ENVIRONMENT
 */
import { BCClient } from '@bcstudio/client';

const client = new BCClient({
  tenantId: process.env.BC_TENANT_ID!,
  clientId: process.env.BC_CLIENT_ID!,
  clientSecret: process.env.BC_CLIENT_SECRET!,
  environment: process.env.BC_ENVIRONMENT ?? 'production',
});

// 1. List companies
const companies = await client.get<{ value: { id: string; name: string }[] }>('companies');
console.log('Companies:', companies.data?.value?.map((c) => c.name));

// 2. Use the first company
const companyId = companies.data?.value?.[0]?.id;
if (!companyId) throw new Error('No companies found');

// 3. Fetch 5 customers
const customers = await client.get<{ value: { number: string; displayName: string }[] }>(
  `companies(${companyId})/customers`,
  { odataQuery: '$top=5&$select=number,displayName' },
);
console.table(customers.data?.value);
