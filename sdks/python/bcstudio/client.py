"""
BCClient — production-grade Business Central OData v4 HTTP client.

Handles:
- OAuth2 client_credentials token acquisition + per-tenant caching
- {companyId} injection in all API paths
- Full CRUD with ETag enforcement (If-Match)
- Automatic @odata.nextLink pagination (getAll)
- 429 Retry-After + 5xx exponential backoff
- Bound actions (Microsoft.NAV.*)
- Multi-company support via with_company()
"""
from __future__ import annotations

import re
import time
import threading
from dataclasses import dataclass, field
from typing import Any, TypeVar, Generic, Optional
from urllib.parse import urljoin, urlencode

try:
    import requests
    from requests import Session
except ImportError:
    raise ImportError("bcstudio requires 'requests': pip install requests")

from .odata import ODataBuilder, normalize_filter_date

T = TypeVar("T")

# Token cache: key = "tenantId:clientId", value = (token_str, expires_at)
_token_cache: dict[str, tuple[str, float]] = {}
_token_lock = threading.Lock()


@dataclass
class BCConnectionConfig:
    tenant_id: str
    client_id: str
    client_secret: str
    environment: str                     # 'production', 'sandbox', 'MySandbox', etc.
    company_id: str = ""                 # injected into {companyId} paths
    base_url: str = "https://api.businesscentral.dynamics.com"
    api_version: str = "v2.0"


@dataclass
class BCResponse(Generic[T]):
    success: bool
    status: int
    duration_ms: float
    data: Optional[T] = None
    etag: Optional[str] = None
    error: Optional[str] = None
    error_data: Any = None


@dataclass
class BCActionResponse(Generic[T]):
    success: bool
    status: int
    duration_ms: float
    data: Optional[T] = None
    error: Optional[str] = None


class BCClient:
    """Full-featured BC OData v4 client."""

    def __init__(self, config: BCConnectionConfig):
        self.config = config
        self._session = Session()
        self._session.headers.update({
            "Accept": "application/json",
            "Content-Type": "application/json",
        })

    # ── Token ─────────────────────────────────────────────────────────────────

    def get_access_token(self) -> str:
        cache_key = f"{self.config.tenant_id}:{self.config.client_id}"
        now = time.time()

        with _token_lock:
            cached = _token_cache.get(cache_key)
            if cached and cached[1] > now + 60:
                return cached[0]

        url = (f"https://login.microsoftonline.com/{self.config.tenant_id}"
               f"/oauth2/v2.0/token")
        resp = self._session.post(url, data={
            "grant_type":    "client_credentials",
            "client_id":     self.config.client_id,
            "client_secret": self.config.client_secret,
            "scope":         "https://api.businesscentral.dynamics.com/.default",
        }, headers={"Content-Type": "application/x-www-form-urlencoded"})

        if not resp.ok:
            raise RuntimeError(f"Token error {resp.status_code}: {resp.text}")

        body = resp.json()
        token = body["access_token"]
        expires_at = now + int(body.get("expires_in", 3600))

        with _token_lock:
            _token_cache[cache_key] = (token, expires_at)

        return token

    # ── URL building ───────────────────────────────────────────────────────────

    def build_url(self, path: str, entity_id: str = "",
                  odata_query: str = "") -> str:
        """Build a full BC API URL, injecting {companyId}."""
        path = path.replace("{companyId}", self.config.company_id)
        base = (f"{self.config.base_url}/v2.0"
                f"/{self.config.tenant_id}/{self.config.environment}")
        url = f"{base}/{path.lstrip('/')}"
        if entity_id:
            url = f"{url}({entity_id})"
        if odata_query:
            sep = "?" if "?" not in url else "&"
            url = f"{url}{sep}{odata_query}"
        return url

    def build_url_with_options(self, path: str, entity_id: str = "",
                                options: dict | None = None) -> str:
        qs = ODataBuilder.from_dict(options or {}).build()
        return self.build_url(path, entity_id, qs)

    # ── Core request with retry ────────────────────────────────────────────────

    def _request(self, method: str, url: str, **kwargs) -> requests.Response:
        token = self.get_access_token()
        headers = {"Authorization": f"Bearer {token}"}
        headers.update(kwargs.pop("headers", {}))

        max_retries = 5
        for attempt in range(max_retries):
            resp = self._session.request(method, url, headers=headers, **kwargs)

            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 2))
                time.sleep(retry_after)
                continue

            if resp.status_code >= 500 and attempt < max_retries - 1:
                time.sleep(2 ** attempt)
                continue

            return resp

        return resp  # return last response after exhausting retries

    # ── CRUD ──────────────────────────────────────────────────────────────────

    def get(self, path: str, options: dict | None = None) -> BCResponse[dict]:
        """GET a list of records."""
        t0 = time.time()
        url = self.build_url_with_options(path, options=options)
        resp = self._request("GET", url)
        ms = (time.time() - t0) * 1000

        if resp.ok:
            return BCResponse(True, resp.status_code, ms, data=resp.json())
        return BCResponse(False, resp.status_code, ms,
                          error=resp.text, error_data=_try_json(resp))

    def get_one(self, path: str, entity_id: str,
                options: dict | None = None) -> BCResponse[dict]:
        """GET a single record by ID. Returns ETag in response.etag."""
        t0 = time.time()
        url = self.build_url_with_options(path, entity_id, options)
        resp = self._request("GET", url)
        ms = (time.time() - t0) * 1000

        if resp.ok:
            return BCResponse(True, resp.status_code, ms,
                              data=resp.json(),
                              etag=resp.headers.get("ETag"))
        return BCResponse(False, resp.status_code, ms,
                          error=resp.text, error_data=_try_json(resp))

    def get_all(self, path: str, options: dict | None = None) -> list[dict]:
        """GET all records, following @odata.nextLink automatically."""
        results: list[dict] = []
        url: str | None = self.build_url_with_options(path, options=options)

        while url:
            resp = self._request("GET", url)
            if not resp.ok:
                raise RuntimeError(f"BC GET failed {resp.status_code}: {resp.text}")
            body = resp.json()
            results.extend(body.get("value", []))
            url = body.get("@odata.nextLink")

        return results

    def post(self, path: str, body: dict) -> BCResponse[dict]:
        """POST — create a new record."""
        t0 = time.time()
        url = self.build_url(path)
        resp = self._request("POST", url, json=body)
        ms = (time.time() - t0) * 1000

        if resp.ok:
            return BCResponse(True, resp.status_code, ms,
                              data=resp.json() if resp.content else None,
                              etag=resp.headers.get("ETag"))
        return BCResponse(False, resp.status_code, ms,
                          error=resp.text, error_data=_try_json(resp))

    def patch(self, path: str, entity_id: str, body: dict,
              etag: str) -> BCResponse[dict]:
        """
        PATCH — update a record. etag is REQUIRED (BC returns 412 without it).
        Use '*' to skip the concurrency check (overwrites concurrent edits).
        """
        t0 = time.time()
        url = self.build_url(path, entity_id)
        resp = self._request("PATCH", url, json=body,
                             headers={"If-Match": etag})
        ms = (time.time() - t0) * 1000

        if resp.ok:
            return BCResponse(True, resp.status_code, ms,
                              data=resp.json() if resp.content else None)
        return BCResponse(False, resp.status_code, ms,
                          error=resp.text, error_data=_try_json(resp))

    def delete(self, path: str, entity_id: str, etag: str) -> BCResponse[None]:
        """
        DELETE — remove a record. etag is REQUIRED (BC returns 412 without it).
        """
        t0 = time.time()
        url = self.build_url(path, entity_id)
        resp = self._request("DELETE", url, headers={"If-Match": etag})
        ms = (time.time() - t0) * 1000

        if resp.ok:
            return BCResponse(True, resp.status_code, ms)
        return BCResponse(False, resp.status_code, ms,
                          error=resp.text, error_data=_try_json(resp))

    def call_action(self, path: str, entity_id: str, action: str,
                    body: dict | None = None) -> BCActionResponse[dict]:
        """
        Call a BC bound action (Microsoft.NAV.*).
        POST to entity(GUID)/Microsoft.NAV.actionName

        Common actions:
          salesOrders:   makeInvoice, makeQuote, post, reopen, releaseOrder
          salesInvoices: post, send, cancel, cancelAndCreateCreditMemo
          purchaseOrders: post, reopen
        """
        t0 = time.time()
        url = self.build_url(path, entity_id)
        url = f"{url}/{action}"
        resp = self._request("POST", url, json=body or {})
        ms = (time.time() - t0) * 1000

        if resp.ok:
            return BCActionResponse(True, resp.status_code, ms,
                                    data=resp.json() if resp.content else None)
        return BCActionResponse(False, resp.status_code, ms, error=resp.text)

    # ── Company helpers ───────────────────────────────────────────────────────

    def list_companies(self) -> BCResponse[dict]:
        """List all companies accessible with current credentials."""
        url = (f"{self.config.base_url}/v2.0"
               f"/{self.config.tenant_id}/{self.config.environment}/api/v2.0/companies")
        t0 = time.time()
        resp = self._request("GET", url)
        ms = (time.time() - t0) * 1000
        if resp.ok:
            return BCResponse(True, resp.status_code, ms, data=resp.json())
        return BCResponse(False, resp.status_code, ms, error=resp.text)

    def resolve_company_id(self, name: str) -> str | None:
        """Find companyId by company name (case-insensitive)."""
        result = self.list_companies()
        if not result.success or not result.data:
            return None
        for c in result.data.get("value", []):
            if c.get("name", "").lower() == name.lower():
                return c.get("id")
        return None

    def with_company(self, company_id: str) -> "BCClient":
        """Return a new BCClient configured for a different company."""
        import copy
        new_config = copy.copy(self.config)
        new_config.company_id = company_id
        return BCClient(new_config)

    # ── Static helpers ────────────────────────────────────────────────────────

    @staticmethod
    def normalize_filter_date(iso: str) -> str:
        """Strip milliseconds: '2024-01-15T10:30:45.003Z' → '...45Z'"""
        return normalize_filter_date(iso)

    @staticmethod
    def build_incremental_filter(field: str, last_value: str) -> str:
        """Build a $filter for incremental sync, stripping milliseconds."""
        return f"$filter={field} gt {normalize_filter_date(last_value)}"

    @staticmethod
    def detect_filter_honoured(records: list[dict], field: str,
                                cutoff: str) -> bool:
        """
        Detect if BC silently ignored the $filter.
        Returns False if any record predates the cutoff (filter was ignored).
        """
        cutoff_clean = normalize_filter_date(cutoff)
        for r in records:
            val = r.get(field, "")
            if val and normalize_filter_date(val) <= cutoff_clean:
                return False
        return True

    @staticmethod
    def is_concurrency_conflict(response: BCResponse) -> bool:
        return response.status == 412

    @staticmethod
    def is_not_found(response: BCResponse) -> bool:
        return response.status == 404


def _try_json(resp: requests.Response) -> Any:
    try:
        return resp.json()
    except Exception:
        return None
