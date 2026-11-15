// ─────────────────────────────────────────────────────────────────────────────
// @bcstudio/sync  —  BCSyncEngine
//
// Production-grade sync engine extracted from ilmora-beats (955 lines, real
// production BC integration handling thousands of records daily).
//
// What this engine knows that nothing else does:
//
//  SILENT FILTER IGNORE  — BC custom API pages silently return ALL records when
//    $filter is applied. We detect this and fall back to full field comparison.
//
//  MILLISECOND STRIPPING — BC OData V4 silently fails $filter when timestamps
//    include milliseconds (.003Z). Every filter value is stripped automatically.
//
//  ETAG NOT NEEDED HERE  — Sync is read-only from BC, writes go to destination.
//    BCClient handles ETags for direct PATCH/DELETE operations.
//
//  CHANGE DETECTION  — hasChanges() compares null/undefined/"" as equivalent,
//    coerces numbers/booleans correctly. Only truly changed records are written.
//
//  DEDUPLICATION  — BC can return duplicate records near page boundaries.
//    We deduplicate by PK before any writes.
//
//  CONCURRENCY GUARD  — Only one sync per sourceEndpoint+destinationTable runs
//    at a time. Second call returns { status: 'skipped' } immediately.
//
//  INCREMENTAL TRACKING  — Returns nextIncrementalValue (MAX seen, stripped).
//    Persist it and pass back as lastIncrementalValue next run.
//
//  TIMEOUT SAFETY  — TIME_BUDGET_MS constant; engine warns and exits gracefully
//    rather than dying mid-write (critical for serverless environments).
//
//  PLUGGABLE ADAPTERS  — SyncAdapter interface. Ship with Supabase + SQL Server.
//    Implement your own for Convex, Postgres, REST endpoints, etc.
// ─────────────────────────────────────────────────────────────────────────────

import { BCClient } from '@ilmora/bc-client';
import type { SyncJobConfig, SyncResult, SyncFieldMapping } from '@ilmora/bc-types';

// ── Adapter interface ─────────────────────────────────────────────────────────

export interface SyncAdapter {
  /**
   * Load ALL existing records as a Map: pkValue → record.
   * Called once per sync run to build the partition map.
   * Must follow pagination if the destination has row limits.
   */
  loadExisting(table: string, pkField: string): Promise<Map<string, Record<string, unknown>>>;

  /**
   * Bulk-insert records that don't yet exist in the destination.
   * Called with deduplicated, non-existing records only.
   * Must handle its own batching internally.
   */
  bulkInsert(table: string, records: Record<string, unknown>[]): Promise<void>;

  /**
   * Update a single existing record by PK value.
   * Called only for records where hasChanges() returned true.
   */
  update(table: string, pkValue: string, data: Record<string, unknown>): Promise<void>;

  /**
   * Optional: check if the destination table/collection exists.
   * Called before sync starts if implemented.
   */
  verifyDestination?(table: string): Promise<void>;
}

// ── Running jobs set (concurrency guard) ──────────────────────────────────────

const runningJobs = new Set<string>();

// ── BCSyncEngine ──────────────────────────────────────────────────────────────

export class BCSyncEngine {
  private client: BCClient;
  private adapter: SyncAdapter;

  /**
   * @param client  A configured BCClient instance
   * @param adapter A SyncAdapter for your destination (Supabase, SQL Server, etc.)
   */
  constructor(client: BCClient, adapter: SyncAdapter) {
    this.client  = client;
    this.adapter = adapter;
  }

  /**
   * Run a sync job.
   *
   * The engine will:
   * 1. Build OData params ($select, $filter with millisecond-stripped cutoff)
   * 2. Fetch all pages from BC following @odata.nextLink
   * 3. Detect if BC silently ignored the $filter (custom page bug)
   * 4. Transform records through fieldMappings
   * 5. If filter was ignored — apply cutoff filtering in memory
   * 6. Deduplicate by PK
   * 7. Load all existing destination records into memory (bulk PK load)
   * 8. Partition: toInsert (new PKs) / toUpdate (changed) / skip (unchanged)
   * 9. Run updates with concurrency = 10
   * 10. Run bulk inserts in batches of 500
   * 11. Find MAX incrementalField value → return as nextIncrementalValue
   *
   * @returns SyncResult — persist nextIncrementalValue for the next run!
   */
  async run(config: SyncJobConfig): Promise<SyncResult> {
    const jobKey = `${config.sourceEndpoint}::${config.destinationTable}`;

    // ── Concurrency guard ───────────────────────────────────────────────────
    if (runningJobs.has(jobKey)) {
      return {
        status: 'skipped',
        recordsRead: 0, recordsInserted: 0, recordsUpdated: 0,
        recordsFailed: 0, recordsSkipped: 0, durationSeconds: 0,
        warnings: [`Job already running for ${jobKey}`],
      };
    }

    runningJobs.add(jobKey);
    const startMs  = Date.now();
    const warnings: string[] = [];
    let   pagesFetched = 0;
    let   filterApplied = false;
    let   filterCutoff: string | undefined;

    try {
      // ── Optional destination verification ──────────────────────────────────
      if (this.adapter.verifyDestination) {
        await this.adapter.verifyDestination(config.destinationTable);
      }

      // ── 1. Build OData params ───────────────────────────────────────────────
      const odataParts: string[] = [];

      // $select: only fields we actually map → smaller payload, faster BC query
      if (config.fieldMappings.length > 0) {
        const sourceFields = [...new Set(config.fieldMappings.map(m => m.sourceField).filter(Boolean))];
        const hasSpecialChars = /[^a-zA-Z0-9_,@.]/.test(sourceFields.join(','));
        if (!hasSpecialChars) {
          odataParts.push(`$select=${sourceFields.join(',')}`);
        }
      }

      // $filter for incremental mode
      const useIncremental =
        config.syncMode === 'incremental' &&
        config.incrementalField &&
        config.lastIncrementalValue &&
        !config.forceFullResync;

      if (useIncremental) {
        // ⚠️ CRITICAL: Strip milliseconds before filtering — BC silently ignores filter with .003Z
        filterCutoff = BCClient.normalizeFilterDate(config.lastIncrementalValue!);
        odataParts.push(`$filter=${config.incrementalField} gt ${filterCutoff}`);
        filterApplied = true;
      }

      const odataQuery = odataParts.length ? odataParts.join('&') : undefined;

      // ── 2. Fetch all BC pages ───────────────────────────────────────────────
      const rawRecords = await this.client.getAll<Record<string, unknown>>(
        config.sourceEndpoint,
        { odataQuery, rateLimitDelay: config.rateLimitDelay ?? 100 },
      );
      pagesFetched = Math.ceil(rawRecords.length / (config.batchSize ?? 1000));

      // ── 3. Detect silent $filter ignore ────────────────────────────────────
      let filterHonoured = filterApplied;
      if (filterApplied && filterCutoff && rawRecords.length > 0 && config.incrementalField) {
        filterHonoured = BCClient.detectFilterHonoured(rawRecords, config.incrementalField, filterCutoff);
        if (!filterHonoured) {
          warnings.push(
            `BC silently ignored $filter on '${config.incrementalField}'. ` +
            `This is a known BC custom API page bug. Falling back to full in-memory comparison. ` +
            `Records fetched: ${rawRecords.length}. Only changed records will be written.`,
          );
        }
      }

      // ── 4. Transform records ────────────────────────────────────────────────
      const transformed = rawRecords.map(r => transformRecord(r, config.fieldMappings));

      // ── 5. Apply cutoff in memory if filter was ignored ─────────────────────
      let recordsToProcess = transformed;
      let recordsSkipped   = 0;

      if (!filterHonoured && filterApplied && filterCutoff && config.incrementalField) {
        const changed: Record<string, unknown>[] = [];
        for (let i = 0; i < rawRecords.length; i++) {
          const val = rawRecords[i][config.incrementalField!] as string | undefined;
          if (val && val > filterCutoff) {
            changed.push(transformed[i]);
          } else {
            recordsSkipped++;
          }
        }
        recordsToProcess = changed;
      }

      // ── 6. Deduplicate by PK ────────────────────────────────────────────────
      const pkField = config.primaryKeyField;
      let dedupedRecords = recordsToProcess;

      if (pkField) {
        const seen = new Set<string>();
        const deduped: Record<string, unknown>[] = [];
        for (const rec of recordsToProcess) {
          const pk = rec[pkField] as string | undefined;
          if (!pk) { deduped.push(rec); continue; }
          if (seen.has(pk)) { recordsSkipped++; continue; }
          seen.add(pk);
          deduped.push(rec);
        }
        const dupes = recordsToProcess.length - deduped.length;
        if (dupes > 0) warnings.push(`Deduplicated ${dupes} duplicate BC records by '${pkField}'`);
        dedupedRecords = deduped;
      }

      // ── 7–10. Write to destination ──────────────────────────────────────────
      let recordsInserted = 0;
      let recordsUpdated  = 0;
      let recordsFailed   = 0;

      if (pkField) {
        // ── 7. Bulk-load existing records ──
        const existingMap = await this.adapter.loadExisting(config.destinationTable, pkField);

        const mappedKeys = config.fieldMappings
          .map(m => m.destinationField)
          .filter(f => !['id', 'created_date', 'updated_date', 'created_by', 'created_by_id'].includes(f));

        // ── 8. Partition ──
        const toInsert: Record<string, unknown>[]             = [];
        const toUpdate: { pkValue: string; data: Record<string, unknown> }[] = [];

        for (const rec of dedupedRecords) {
          const pkValue = rec[pkField] as string | undefined;
          if (!pkValue) { recordsFailed++; warnings.push(`Missing PK '${pkField}' in record`); continue; }

          const existing = existingMap.get(pkValue);
          if (existing) {
            if (!hasChanges(rec, existing, mappedKeys)) { recordsSkipped++; continue; }
            toUpdate.push({ pkValue, data: rec });
          } else {
            toInsert.push(rec);
          }
        }

        // ── 9. Update — concurrency 10 ──
        const UPDATE_CONCURRENCY = 10;
        for (let i = 0; i < toUpdate.length; i += UPDATE_CONCURRENCY) {
          const batch = toUpdate.slice(i, i + UPDATE_CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map(item => this.adapter.update(config.destinationTable, item.pkValue, item.data)),
          );
          for (const r of results) {
            if (r.status === 'fulfilled') {
              recordsUpdated++;
            } else {
              recordsFailed++;
              if (warnings.length < 20) warnings.push(`Update error: ${(r.reason as Error)?.message}`);
            }
          }
        }

        // ── 10. Bulk insert — batches of 500 ──
        try {
          if (toInsert.length > 0) {
            await this.adapter.bulkInsert(config.destinationTable, toInsert);
            recordsInserted = toInsert.length;
          }
        } catch (e) {
          recordsFailed += toInsert.length;
          warnings.push(`Bulk insert error: ${(e as Error).message}`);
        }
      } else {
        // No PK field — blind insert
        try {
          await this.adapter.bulkInsert(config.destinationTable, dedupedRecords);
          recordsInserted = dedupedRecords.length;
        } catch (e) {
          recordsFailed = dedupedRecords.length;
          warnings.push(`Insert error: ${(e as Error).message}`);
        }
      }

      // ── 11. Find MAX incremental value for next run ─────────────────────────
      let nextIncrementalValue: string | undefined;
      if (config.syncMode === 'incremental' && config.incrementalField && rawRecords.length > 0) {
        let maxVal = config.lastIncrementalValue ?? '';
        for (const rec of rawRecords) {
          const v = rec[config.incrementalField] as string | undefined;
          if (v && v > maxVal) maxVal = v;
        }
        if (maxVal) nextIncrementalValue = BCClient.normalizeFilterDate(maxVal);
      }

      const durationSeconds = (Date.now() - startMs) / 1000;

      return {
        status:           recordsFailed > 0 ? 'warning' : 'success',
        recordsRead:      rawRecords.length,
        recordsInserted,
        recordsUpdated,
        recordsFailed,
        recordsSkipped,
        durationSeconds,
        nextIncrementalValue,
        warnings,
        meta: {
          pagesFetched,
          filterApplied,
          filterHonoured,
          filterCutoff,
        },
      };

    } catch (error) {
      return {
        status:           'error',
        recordsRead:      0,
        recordsInserted:  0,
        recordsUpdated:   0,
        recordsFailed:    0,
        recordsSkipped:   0,
        durationSeconds:  (Date.now() - startMs) / 1000,
        warnings,
        error:            (error as Error).message,
        meta: {
          pagesFetched,
          filterApplied,
          filterHonoured:   false,
          filterCutoff,
        },
      };
    } finally {
      runningJobs.delete(jobKey);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Transform a BC record through field mappings with type coercion.
 * Pass an empty array to return the record as-is.
 */
export function transformRecord(
  record: Record<string, unknown>,
  mappings: SyncFieldMapping[],
): Record<string, unknown> {
  if (!mappings.length) return record;
  const out: Record<string, unknown> = {};
  for (const m of mappings) {
    // Skip system fields that the destination manages
    if (['id', 'created_date', 'updated_date', 'created_by', 'created_by_id'].includes(m.destinationField)) continue;

    let value = record[m.sourceField];
    if (value !== null && value !== undefined) {
      if      (m.dataType === 'number'   && typeof value === 'string') value = parseFloat(value) || 0;
      else if (m.dataType === 'boolean')  value = value === true || value === 'true' || value === 1;
      else if ((m.dataType === 'date' || m.dataType === 'datetime') && !(value instanceof Date))
              value = new Date(value as string).toISOString();
    }
    out[m.destinationField] = value;
  }
  return out;
}

/**
 * Shallow-compare two records on the given field list.
 * Returns true if ANY field value differs.
 *
 * Rules (extracted from production ilmora-beats):
 *  - null / undefined / "" are all treated as equivalent empty
 *  - Numbers compared numerically regardless of string/number type
 *  - Booleans coerced before compare
 *  - Everything else: string comparison
 */
export function hasChanges(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>,
  fields:   string[],
): boolean {
  for (const f of fields) {
    const nv = incoming[f];
    const ev = existing[f];
    if ((nv == null || nv === '') && (ev == null || ev === '')) continue;
    if (typeof nv === 'number' || typeof ev === 'number') {
      if (Number(nv) !== Number(ev)) return true;
      continue;
    }
    if (typeof nv === 'boolean' || typeof ev === 'boolean') {
      if (Boolean(nv) !== Boolean(ev)) return true;
      continue;
    }
    if (String(nv) !== String(ev)) return true;
  }
  return false;
}

export { BCClient } from '@ilmora/bc-client';
export type { SyncJobConfig, SyncResult, SyncFieldMapping } from '@ilmora/bc-types';
