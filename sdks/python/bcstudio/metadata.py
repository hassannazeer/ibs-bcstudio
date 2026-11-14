"""
BCMetadata — discover BC OData endpoints and parse $metadata schemas.
No external XML library required: pure regex parsing.
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field
from typing import Optional
from .client import BCClient, BCConnectionConfig


@dataclass
class BCFieldSchema:
    name: str
    odata_type: str
    mapped_type: str        # string, number, boolean, datetime, guid, decimal
    sql_type: str           # NVARCHAR, INT, BIT, DATETIME2, UNIQUEIDENTIFIER, DECIMAL
    is_nullable: bool = True
    is_primary_key: bool = False
    max_length: Optional[int] = None


@dataclass
class BCEndpoint:
    path: str
    entity_type: str
    endpoint_type: str      # standard | custom | extension | automation
    display_name: str = ""


_EDM_MAP = {
    "Edm.String":           ("string",   "NVARCHAR(MAX)"),
    "Edm.Int32":            ("number",   "INT"),
    "Edm.Int64":            ("number",   "BIGINT"),
    "Edm.Decimal":          ("decimal",  "DECIMAL(18,2)"),
    "Edm.Double":           ("decimal",  "FLOAT"),
    "Edm.Boolean":          ("boolean",  "BIT"),
    "Edm.DateTimeOffset":   ("datetime", "DATETIME2"),
    "Edm.Date":             ("datetime", "DATE"),
    "Edm.Guid":             ("guid",     "UNIQUEIDENTIFIER"),
    "Edm.Stream":           ("string",   "NVARCHAR(MAX)"),
    "Edm.Binary":           ("string",   "VARBINARY(MAX)"),
}


class BCMetadata:
    """Discover and inspect BC API endpoints and their schemas."""

    def __init__(self, config: BCConnectionConfig):
        self._client = BCClient(config)

    @classmethod
    def from_client(cls, client: BCClient) -> "BCMetadata":
        m = cls.__new__(cls)
        m._client = client
        return m

    def discover_endpoints(self, api_path: str = "api/v2.0") -> list[BCEndpoint]:
        """Fetch $metadata and return all entity endpoints."""
        url = self._client.build_url(f"{api_path}/$metadata")
        token = self._client.get_access_token()
        import requests
        resp = requests.get(url, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/xml",
        })
        if not resp.ok:
            raise RuntimeError(f"$metadata error {resp.status_code}: {resp.text}")
        return _parse_endpoints(resp.text, api_path)

    def get_entity_schema(self, endpoint_path: str) -> list[BCFieldSchema]:
        """Parse $metadata for a specific endpoint's field schema."""
        # Strip entity segment, get the api path
        parts = endpoint_path.split("/")
        api_path = "/".join(parts[:3]) if len(parts) >= 3 else "api/v2.0"
        url = self._client.build_url(f"{api_path}/$metadata")
        token = self._client.get_access_token()
        import requests
        resp = requests.get(url, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/xml",
        })
        if not resp.ok:
            raise RuntimeError(f"$metadata error {resp.status_code}: {resp.text}")

        entity_name = parts[-1].split("(")[0] if parts else ""
        return _parse_schema(resp.text, entity_name)

    def infer_schema_from_sample(self, endpoint_path: str) -> list[BCFieldSchema]:
        """Infer schema from a live $top=1 record (fallback when $metadata unavailable)."""
        records = self._client.get_all(endpoint_path, {"top": 1})
        if not records:
            return []
        return _infer_from_record(records[0])

    def discover_companies(self) -> list[dict]:
        result = self._client.list_companies()
        if result.success and result.data:
            return result.data.get("value", [])
        return []


# ── Pure-regex XML parser ─────────────────────────────────────────────────────

def _parse_endpoints(xml: str, api_path: str) -> list[BCEndpoint]:
    endpoints = []
    for m in re.finditer(r'<EntitySet\s+Name="([^"]+)"\s+EntityType="([^"]+)"', xml):
        name, etype = m.group(1), m.group(2)
        short_type = etype.split(".")[-1]
        ep_type = "standard"
        if "custom" in api_path.lower():
            ep_type = "custom"
        elif api_path.startswith("api/v2"):
            ep_type = "standard"
        else:
            ep_type = "extension"
        endpoints.append(BCEndpoint(
            path=f"{api_path}/companies({{companyId}})/{name}",
            entity_type=short_type,
            endpoint_type=ep_type,
            display_name=name,
        ))
    return endpoints


def _parse_schema(xml: str, entity_name: str) -> list[BCFieldSchema]:
    # Find the EntityType block matching entity_name (case-insensitive search)
    block_pattern = rf'<EntityType[^>]+Name="{re.escape(entity_name)}"[^>]*>(.*?)</EntityType>'
    block_m = re.search(block_pattern, xml, re.DOTALL | re.IGNORECASE)
    if not block_m:
        # Try partial match
        block_m = re.search(r'<EntityType[^>]*>(.*?)</EntityType>', xml, re.DOTALL)
    if not block_m:
        return []

    block = block_m.group(1)
    fields = []

    # Primary key
    pk_names: set[str] = set()
    for pk_m in re.finditer(r'<PropertyRef\s+Name="([^"]+)"', block):
        pk_names.add(pk_m.group(1))

    # Properties
    for prop_m in re.finditer(
        r'<Property\s+Name="([^"]+)"\s+Type="([^"]+)"([^/]*)/>', block
    ):
        name = prop_m.group(1)
        odata_type = prop_m.group(2).replace("Collection(", "").rstrip(")")
        attrs = prop_m.group(3)
        nullable = 'Nullable="false"' not in attrs
        max_len_m = re.search(r'MaxLength="(\d+)"', attrs)
        max_len = int(max_len_m.group(1)) if max_len_m else None
        mapped, sql = _EDM_MAP.get(odata_type, ("string", "NVARCHAR(MAX)"))
        if max_len and sql.startswith("NVARCHAR"):
            sql = f"NVARCHAR({max_len})"
        fields.append(BCFieldSchema(
            name=name,
            odata_type=odata_type,
            mapped_type=mapped,
            sql_type=sql,
            is_nullable=nullable,
            is_primary_key=name in pk_names,
            max_length=max_len,
        ))

    return fields


def _infer_from_record(record: dict) -> list[BCFieldSchema]:
    TYPE_MAP = {
        str:   ("string",   "NVARCHAR(MAX)", "Edm.String"),
        int:   ("number",   "INT",           "Edm.Int32"),
        float: ("decimal",  "DECIMAL(18,2)", "Edm.Decimal"),
        bool:  ("boolean",  "BIT",           "Edm.Boolean"),
    }
    fields = []
    for key, val in record.items():
        if isinstance(val, str) and re.match(r'\d{4}-\d{2}-\d{2}T', val):
            mapped, sql, odt = "datetime", "DATETIME2", "Edm.DateTimeOffset"
        elif isinstance(val, str) and re.match(
            r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', val, re.I
        ):
            mapped, sql, odt = "guid", "UNIQUEIDENTIFIER", "Edm.Guid"
        elif type(val) in TYPE_MAP:
            mapped, sql, odt = TYPE_MAP[type(val)]
        else:
            mapped, sql, odt = "string", "NVARCHAR(MAX)", "Edm.String"
        fields.append(BCFieldSchema(
            name=key, odata_type=odt, mapped_type=mapped,
            sql_type=sql, is_nullable=True, is_primary_key=(key == "id"),
        ))
    return fields
