/**
 * Supabase SyncAdapter
 *
 * Uses Supabase JS client for loadExisting (paginated SELECT), bulkInsert
 * (upsert in 500-row batches) and update (single row by PK).
 *
 * @example
 *   import { createClient } from '@supabase/supabase-js';
 *   import { createSupabaseAdapter } from '@bcstudio/sync/adapters/supabase';
 *
 *   const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
 *   const adapter  = createSupabaseAdapter(supabase, 'id');
 */
import type { SyncAdapter } from '../index.js';

// Minimal Supabase client interface (avoids hard dep on @supabase/supabase-js types)
interface SBClient {
  from(table: string): SBQuery;
}
interface SBQuery {
  select(cols?: string): SBQuery;
  upsert(data: unknown[], opts?: { onConflict?: string }): SBQuery;
  update(data: unknown): SBQuery;
  insert(data: unknown[]): SBQuery;
  eq(col: string, val: unknown): SBQuery;
  range(from: number, to: number): SBQuery;
  limit(n: number): SBQuery;
  then(cb: (r: { data: unknown; error: unknown }) => void): void;
}

type R = Record<string, unknown>;

export function createSupabaseAdapter(supabase: SBClient, pkField: string): SyncAdapter {
  return {
    async verifyDestination(table): Promise<void> {
      const { error } = await q(supabase.from(table).select('*').limit(0));
      if (error) throw new Error(`Table '${table}' not found in Supabase: ${JSON.stringify(error)}`);
    },

    async loadExisting(table): Promise<Map<string, R>> {
      const map  = new Map<string, R>();
      const PAGE = 1000;
      let   from = 0;
      while (true) {
        const { data, error } = await q<R[]>(supabase.from(table).select().range(from, from + PAGE - 1));
        if (error)             throw new Error(`loadExisting error: ${JSON.stringify(error)}`);
        if (!data?.length)     break;
        for (const row of data) {
          const pk = row[pkField] as string | undefined;
          if (pk) map.set(pk, row);
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return map;
    },

    async bulkInsert(table, records): Promise<void> {
      const BATCH = 500;
      for (let i = 0; i < records.length; i += BATCH) {
        const chunk = records.slice(i, i + BATCH);
        const { error } = await q(supabase.from(table).upsert(chunk, { onConflict: pkField }));
        if (error) throw new Error(`bulkInsert error: ${JSON.stringify(error)}`);
      }
    },

    async update(table, pkValue, data): Promise<void> {
      const { error } = await q(supabase.from(table).update(data).eq(pkField, pkValue));
      if (error) throw new Error(`update error (${pkValue}): ${JSON.stringify(error)}`);
    },
  };
}

function q<T = unknown>(queryBuilder: SBQuery): Promise<{ data: T | null; error: unknown }> {
  return new Promise(resolve => queryBuilder.then(resolve as (r: { data: unknown; error: unknown }) => void));
}
