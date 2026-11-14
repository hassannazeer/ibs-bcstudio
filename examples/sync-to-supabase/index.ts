/**
 * Sync BC Customers → Supabase.
 *
 * Uses incremental mode: on first run, syncs all records.
 * On subsequent runs, only fetches records modified since the last run.
 *
 * IMPORTANT: BC custom API pages may silently ignore $filter — the engine
 * detects this automatically and falls back to full comparison.
 *
 * Required env vars:
 *   BC_TENANT_ID, BC_CLIENT_ID, BC_CLIENT_SECRET, BC_ENVIRONMENT, BC_COMPANY_ID
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   LAST_INCREMENTAL_VALUE  (optional — set to empty string for full sync)
 */
import { createClient } from '@supabase/supabase-js';
import { BCClient } from '@bcstudio/client';
import { BCSyncEngine } from '@bcstudio/sync';
import { createSupabaseAdapter } from '@bcstudio/sync/adapters/supabase';

const bcClient = new BCClient({
  tenantId: process.env.BC_TENANT_ID!,
  clientId: process.env.BC_CLIENT_ID!,
  clientSecret: process.env.BC_CLIENT_SECRET!,
  environment: process.env.BC_ENVIRONMENT ?? 'production',
  companyId: process.env.BC_COMPANY_ID,
});

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const adapter = createSupabaseAdapter(supabase, 'id');
const engine = new BCSyncEngine(bcClient, adapter);

const result = await engine.run({
  sourceEndpoint: 'api/v2.0/companies({companyId})/customers',
  destinationTable: 'bc_customers',
  primaryKeyField: 'id',
  syncMode: 'incremental',
  incrementalField: 'lastModifiedDateTime',
  lastIncrementalValue: process.env.LAST_INCREMENTAL_VALUE || undefined,
  fieldMappings: [
    { sourceField: 'id',                    destinationField: 'id',               dataType: 'string' },
    { sourceField: 'number',                destinationField: 'number',            dataType: 'string' },
    { sourceField: 'displayName',           destinationField: 'display_name',      dataType: 'string' },
    { sourceField: 'email',                 destinationField: 'email',             dataType: 'string' },
    { sourceField: 'lastModifiedDateTime',  destinationField: 'last_modified_at',  dataType: 'datetime' },
  ],
});

console.log('Sync complete:', result);
// Persist result.nextIncrementalValue for the next run
if (result.nextIncrementalValue) {
  console.log(`\nNext LAST_INCREMENTAL_VALUE: ${result.nextIncrementalValue}`);
}
