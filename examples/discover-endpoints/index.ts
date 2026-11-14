/**
 * Discover all endpoints on a BC environment and inspect their schemas.
 */
import { BCMetadata } from '@bcstudio/metadata';

const meta = new BCMetadata({
  tenantId: process.env.BC_TENANT_ID!,
  clientId: process.env.BC_CLIENT_ID!,
  clientSecret: process.env.BC_CLIENT_SECRET!,
  environment: process.env.BC_ENVIRONMENT ?? 'production',
});

const endpoints = await meta.discoverEndpoints();
console.log(`Found ${endpoints.length} endpoints`);

for (const ep of endpoints.slice(0, 5)) {
  const schema = await meta.getEntitySchema(ep.path);
  console.log(`\n${ep.name} (${ep.path})`);
  console.table(schema.map((f) => ({ name: f.name, type: f.mappedType, pk: f.isPrimaryKey })));
}
