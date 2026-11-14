"""
BCSyncEngine — incremental BC → destination sync with silent filter detection.

Adapters: SupabaseAdapter, SqlServerAdapter, or implement SyncAdapter yourself.
"""
from __future__ import annotations

import time
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional
from .client import BCClient, normalize_filter_date
from .odata import ODataBuilder, ODataFilter


@dataclass
class FieldMapping:
    source_field: str
    destination_field: str
    data_type: str = "string"       # string, number, boolean, datetime, guid, decimal


@dataclass
class SyncJobConfig:
    source_endpoint: str
    destination_table: str
    field_mappings: list[FieldMapping]
    sync_mode: str = "incremental"       # 'incremental' | 'full'
    primary_key_field: str = "id"
    incremental_field: str = "lastModifiedDateTime"
    last_incremental_value: Optional[str] = None
    force_full_resync: bool = False
    batch_size: int = 500
    update_concurrency: int = 10
    rate_limit_delay: float = 0.0


@dataclass
class SyncResult:
    status: str = "success"            # success | warning | error | skipped
    records_read: int = 0
    records_inserted: int = 0
    records_updated: int = 0
    records_failed: int = 0
    records_skipped: int = 0
    duration_seconds: float = 0.0
    next_incremental_value: Optional[str] = None
    warnings: list[str] = field(default_factory=list)
    error: Optional[str] = None
    meta: dict = field(default_factory=dict)


class SyncAdapter(ABC):
    """Interface every destination adapter must implement."""

    def verify_destination(self, table: str) -> None:
        """Optional: raise if the destination table doesn't exist."""
        pass

    @abstractmethod
    def load_existing(self, table: str, pk_field: str) -> dict[str, dict]:
        """Return {pk_value: record} for all current rows."""
        ...

    @abstractmethod
    def bulk_insert(self, table: str, records: list[dict]) -> None:
        """Insert new records in bulk."""
        ...

    @abstractmethod
    def update(self, table: str, pk_value: str, data: dict) -> None:
        """Update one existing record."""
        ...


_running_jobs: set[str] = set()
_jobs_lock = threading.Lock()


class BCSyncEngine:
    """11-step BC → destination sync pipeline."""

    def __init__(self, client: BCClient, adapter: SyncAdapter):
        self._client = client
        self._adapter = adapter

    def run(self, config: SyncJobConfig) -> SyncResult:
        job_key = f"{config.source_endpoint}:{config.destination_table}"
        with _jobs_lock:
            if job_key in _running_jobs:
                r = SyncResult(status="skipped")
                r.warnings.append("Job already running — skipped duplicate")
                return r
            _running_jobs.add(job_key)

        t0 = time.time()
        result = SyncResult()

        try:
            # 1. Verify destination
            self._adapter.verify_destination(config.destination_table)

            # 2. Build OData params
            select_fields = [m.source_field for m in config.field_mappings]
            builder = ODataBuilder().select(*select_fields)
            filter_applied = False
            cutoff = None

            if (config.sync_mode == "incremental"
                    and config.last_incremental_value
                    and not config.force_full_resync):
                cutoff = normalize_filter_date(config.last_incremental_value)
                builder.filter(
                    ODataFilter(config.incremental_field, 'gt', cutoff)
                )
                filter_applied = True

            qs = builder.build()

            # 3. Fetch all BC pages
            records = self._client.get_all(config.source_endpoint,
                                           {"raw": qs} if qs else None)
            result.records_read = len(records)

            # 4. Detect silent filter ignore
            filter_honoured = True
            if filter_applied and cutoff and records:
                filter_honoured = BCClient.detect_filter_honoured(
                    records, config.incremental_field, cutoff
                )
                if not filter_honoured:
                    result.warnings.append(
                        "BC silently ignored $filter — applying in memory"
                    )
                    records = [
                        r for r in records
                        if normalize_filter_date(r.get(config.incremental_field, ""))
                           > cutoff
                    ]

            result.meta = {
                "filter_applied":  filter_applied,
                "filter_honoured": filter_honoured,
                "cutoff": cutoff,
            }

            # 5. Transform records
            transformed = [_transform(r, config.field_mappings) for r in records]

            # 6. Deduplicate by PK
            seen: dict[str, dict] = {}
            for rec in transformed:
                pk = str(rec.get(config.primary_key_field, ""))
                if pk:
                    seen[pk] = rec
            transformed = list(seen.values())

            # 7. Load existing
            existing = self._adapter.load_existing(
                config.destination_table, config.primary_key_field
            )

            # 8. Partition
            to_insert: list[dict] = []
            to_update: list[tuple[str, dict]] = []

            for rec in transformed:
                pk = str(rec.get(config.primary_key_field, ""))
                if pk not in existing:
                    to_insert.append(rec)
                elif _has_changes(rec, existing[pk],
                                  [m.destination_field for m in config.field_mappings]):
                    to_update.append((pk, rec))
                else:
                    result.records_skipped += 1

            # 9. Updates
            for pk, data in to_update:
                try:
                    self._adapter.update(config.destination_table, pk, data)
                    result.records_updated += 1
                except Exception as e:
                    result.records_failed += 1
                    result.warnings.append(f"Update failed for {pk}: {e}")
                if config.rate_limit_delay:
                    time.sleep(config.rate_limit_delay)

            # 10. Bulk inserts
            for i in range(0, len(to_insert), config.batch_size):
                batch = to_insert[i:i + config.batch_size]
                try:
                    self._adapter.bulk_insert(config.destination_table, batch)
                    result.records_inserted += len(batch)
                except Exception as e:
                    result.records_failed += len(batch)
                    result.warnings.append(f"Bulk insert batch failed: {e}")

            # 11. Track next incremental value
            all_values = [
                normalize_filter_date(r.get(config.incremental_field, ""))
                for r in records
                if r.get(config.incremental_field)
            ]
            if all_values:
                result.next_incremental_value = max(all_values)
            elif config.last_incremental_value:
                result.next_incremental_value = normalize_filter_date(
                    config.last_incremental_value
                )

            if result.records_failed > 0:
                result.status = "warning"

        except Exception as e:
            result.status = "error"
            result.error = str(e)
        finally:
            with _jobs_lock:
                _running_jobs.discard(job_key)
            result.duration_seconds = time.time() - t0

        return result


def _transform(record: dict, mappings: list[FieldMapping]) -> dict:
    out: dict[str, Any] = {}
    for m in mappings:
        val = record.get(m.source_field)
        if val is None:
            out[m.destination_field] = None
            continue
        if m.data_type == "datetime" and isinstance(val, str):
            val = normalize_filter_date(val)
        elif m.data_type == "number":
            try:
                val = int(val)
            except (ValueError, TypeError):
                pass
        elif m.data_type == "decimal":
            try:
                val = float(val)
            except (ValueError, TypeError):
                pass
        elif m.data_type == "boolean":
            if isinstance(val, str):
                val = val.lower() in ('true', '1', 'yes')
        out[m.destination_field] = val
    return out


def _has_changes(incoming: dict, existing: dict, fields: list[str]) -> bool:
    for f in fields:
        iv = incoming.get(f)
        ev = existing.get(f)
        if str(iv) != str(ev):
            return True
    return False


# ── Adapters ──────────────────────────────────────────────────────────────────

class SupabaseAdapter(SyncAdapter):
    """Supabase SyncAdapter. Requires: pip install supabase"""

    def __init__(self, client, pk_field: str = "id"):
        self._sb = client
        self._pk = pk_field

    def verify_destination(self, table: str) -> None:
        try:
            self._sb.table(table).select(self._pk).limit(0).execute()
        except Exception as e:
            raise RuntimeError(f"Destination table '{table}' not accessible: {e}")

    def load_existing(self, table: str, pk_field: str) -> dict[str, dict]:
        result: dict[str, dict] = {}
        page, page_size = 0, 1000
        while True:
            resp = (self._sb.table(table)
                    .select("*")
                    .range(page * page_size, (page + 1) * page_size - 1)
                    .execute())
            rows = resp.data or []
            for row in rows:
                pk = str(row.get(pk_field, ""))
                if pk:
                    result[pk] = row
            if len(rows) < page_size:
                break
            page += 1
        return result

    def bulk_insert(self, table: str, records: list[dict]) -> None:
        (self._sb.table(table)
         .upsert(records, on_conflict=self._pk)
         .execute())

    def update(self, table: str, pk_value: str, data: dict) -> None:
        (self._sb.table(table)
         .update(data)
         .eq(self._pk, pk_value)
         .execute())


class SqlServerAdapter(SyncAdapter):
    """SQL Server SyncAdapter. Requires: pip install pyodbc"""

    def __init__(self, connection_string: str, pk_field: str = "id"):
        self._conn_str = connection_string
        self._pk = pk_field

    def _connect(self):
        import pyodbc
        return pyodbc.connect(self._conn_str)

    def verify_destination(self, table: str) -> None:
        with self._connect() as conn:
            conn.execute(f"SELECT TOP 0 * FROM [{table}]")

    def load_existing(self, table: str, pk_field: str) -> dict[str, dict]:
        result: dict[str, dict] = {}
        with self._connect() as conn:
            cursor = conn.execute(f"SELECT * FROM [{table}]")
            cols = [d[0] for d in cursor.description]
            for row in cursor.fetchall():
                rec = dict(zip(cols, row))
                pk = str(rec.get(pk_field, ""))
                if pk:
                    result[pk] = rec
        return result

    def bulk_insert(self, table: str, records: list[dict]) -> None:
        if not records:
            return
        import pyodbc
        with self._connect() as conn:
            cols = list(records[0].keys())
            placeholders = ", ".join(["?" ] * len(cols))
            col_names = ", ".join(f"[{c}]" for c in cols)
            sql = f"INSERT INTO [{table}] ({col_names}) VALUES ({placeholders})"
            rows = [[r.get(c) for c in cols] for r in records]
            conn.executemany(sql, rows)
            conn.commit()

    def update(self, table: str, pk_value: str, data: dict) -> None:
        import pyodbc
        cols = [k for k in data if k != self._pk]
        set_clause = ", ".join(f"[{c}] = ?" for c in cols)
        vals = [data[c] for c in cols] + [pk_value]
        with self._connect() as conn:
            conn.execute(
                f"UPDATE [{table}] SET {set_clause} WHERE [{self._pk}] = ?",
                vals
            )
            conn.commit()
