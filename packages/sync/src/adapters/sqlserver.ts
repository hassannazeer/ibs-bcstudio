/**
 * SQL Server SyncAdapter
 *
 * Uses mssql for MERGE-based upserts.
 * Pass a connected mssql ConnectionPool.
 *
 * @example
 *   import sql from 'mssql';
 *   import { createSqlServerAdapter } from '@bcstudio/sync/adapters/sqlserver';
 *
 *   const pool = await sql.connect({ server, database, user, password, options: { encrypt: true } });
 *   const adapter = createSqlServerAdapter(pool, 'id');
 */
import type { SyncAdapter } from '../index.js';

interface SqlPool {
  request(): SqlRequest;
}
interface SqlRequest {
  input(name: string, value: unknown): SqlRequest;
  query<T = unknown>(sql: string): Promise<{ recordset: T[] }>;
}

type R = Record<string, unknown>;

export function createSqlServerAdapter(pool: SqlPool, pkField: string): SyncAdapter {
  return {
    async verifyDestination(table): Promise<void> {
      await pool.request().query(`SELECT TOP 0 * FROM [dbo].[${table}]`);
    },

    async loadExisting(table): Promise<Map<string, R>> {
      const map = new Map<string, R>();
      const result = await pool.request().query<R>(`SELECT * FROM [dbo].[${table}]`);
      for (const row of result.recordset) {
        const pk = row[pkField] as string | undefined;
        if (pk) map.set(pk, row);
      }
      return map;
    },

    async bulkInsert(table, records): Promise<void> {
      if (!records.length) return;
      const cols = Object.keys(records[0]);
      const BATCH = 1000;
      for (let i = 0; i < records.length; i += BATCH) {
        const chunk = records.slice(i, i + BATCH);
        for (const rec of chunk) {
          const req = pool.request();
          cols.forEach(c => req.input(c, rec[c]));
          const cols_sql = cols.map(c => `[${c}]`).join(', ');
          const vals_sql = cols.map(c => `@${c}`).join(', ');
          await req.query(`INSERT INTO [dbo].[${table}] (${cols_sql}) VALUES (${vals_sql})`);
        }
      }
    },

    async update(table, pkValue, data): Promise<void> {
      const cols = Object.keys(data).filter(c => c !== pkField);
      const req  = pool.request();
      cols.forEach(c => req.input(c, data[c]));
      req.input('__pk', pkValue);
      const setClause = cols.map(c => `[${c}] = @${c}`).join(', ');
      await req.query(`UPDATE [dbo].[${table}] SET ${setClause} WHERE [${pkField}] = @__pk`);
    },
  };
}
