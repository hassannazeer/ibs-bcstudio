"""
OData v4 query builder for Business Central.

Handles all standard parameters: $filter, $select, $top, $skip,
$orderby, $expand, $count, $search, plus raw passthrough.

BC-specific: datetimes in $filter are auto-normalised (milliseconds
stripped) because BC silently returns all records when ms are present.
"""
from __future__ import annotations
import re
from typing import Any, Union
from urllib.parse import quote


def normalize_filter_date(iso: str) -> str:
    """Strip milliseconds from an ISO 8601 datetime string.
    
    BC OData $filter silently fails when milliseconds are present.
    '2024-01-15T10:30:45.003Z' → '2024-01-15T10:30:45Z'
    """
    return re.sub(r'\.\d{1,3}Z$', 'Z', iso)


class ODataFilter:
    """A single OData filter expression."""
    def __init__(self, field: str, op: str, value: Any):
        self.field = field
        self.op = op      # eq, ne, gt, ge, lt, le, contains, startswith, endswith
        self.value = value

    def build(self) -> str:
        v = self.value
        if isinstance(v, str):
            # Datetime: strip milliseconds
            if re.match(r'\d{4}-\d{2}-\d{2}T', v):
                v = normalize_filter_date(v)
                return f"{self.field} {self.op} {v}"
            # Boolean-like strings
            if v.lower() in ('true', 'false'):
                return f"{self.field} {self.op} {v.lower()}"
            # Function calls: contains(), startswith(), endswith()
            if self.op in ('contains', 'startswith', 'endswith'):
                return f"{self.op}({self.field},'{v}')"
            return f"{self.field} {self.op} '{v}'"
        if isinstance(v, bool):
            return f"{self.field} {self.op} {'true' if v else 'false'}"
        if v is None:
            return f"{self.field} {self.op} null"
        return f"{self.field} {self.op} {v}"


class ODataBuilder:
    """
    Programmatic OData v4 query builder for Business Central.

    Usage::

        qs = (ODataBuilder()
              .top(50)
              .select('id', 'number', 'displayName', 'lastModifiedDateTime')
              .filter([ODataFilter('lastModifiedDateTime', 'gt', '2024-01-15T10:30:45.003Z')])
              .orderby('displayName', 'asc')
              .expand('customerPaymentTerms')
              .count()
              .build())
        # → $top=50&$select=id,...&$filter=lastModifiedDateTime gt 2024-01-15T10:30:45Z&...
    """

    def __init__(self):
        self._top: int | None = None
        self._skip: int | None = None
        self._select: list[str] = []
        self._filters: list[str] = []
        self._orderby: str | None = None
        self._expand: list[str] = []
        self._count: bool = False
        self._search: str | None = None
        self._raw: str | None = None

    def top(self, n: int) -> "ODataBuilder":
        """$top — maximum records to return."""
        self._top = n
        return self

    def skip(self, n: int) -> "ODataBuilder":
        """$skip — records to skip (for manual pagination)."""
        self._skip = n
        return self

    def select(self, *fields: str) -> "ODataBuilder":
        """$select — fields to include in the response."""
        self._select.extend(fields)
        return self

    def filter(self, f: Union[str, ODataFilter, list]) -> "ODataBuilder":
        """
        $filter — add a filter expression.

        Accepts:
        - A raw string: ``"displayName eq 'Acme'"``
        - An ODataFilter instance
        - A list of ODataFilter instances (joined with 'and')
        """
        if isinstance(f, str):
            self._filters.append(f)
        elif isinstance(f, ODataFilter):
            self._filters.append(f.build())
        elif isinstance(f, list):
            parts = [x.build() if isinstance(x, ODataFilter) else str(x) for x in f]
            self._filters.append(' and '.join(parts))
        return self

    def orderby(self, field: str, direction: str = 'asc') -> "ODataBuilder":
        """$orderby — sort field and direction ('asc' or 'desc')."""
        self._orderby = f"{field} {direction}"
        return self

    def expand(self, *props: str) -> "ODataBuilder":
        """$expand — navigation properties to include."""
        self._expand.extend(props)
        return self

    def count(self, include: bool = True) -> "ODataBuilder":
        """$count=true — include total count in response."""
        self._count = include
        return self

    def search(self, term: str) -> "ODataBuilder":
        """$search — full-text search term."""
        self._search = term
        return self

    def raw(self, qs: str) -> "ODataBuilder":
        """Append a raw query string fragment (no leading '&' needed)."""
        self._raw = qs
        return self

    def build(self) -> str:
        """Build and return the OData query string (without leading '?')."""
        parts: list[str] = []

        if self._top is not None:
            parts.append(f"$top={self._top}")
        if self._skip is not None:
            parts.append(f"$skip={self._skip}")
        if self._select:
            parts.append(f"$select={','.join(self._select)}")
        if self._filters:
            combined = ' and '.join(f"({f})" if ' or ' in f else f for f in self._filters)
            parts.append(f"$filter={combined}")
        if self._orderby:
            parts.append(f"$orderby={self._orderby}")
        if self._expand:
            parts.append(f"$expand={','.join(self._expand)}")
        if self._count:
            parts.append("$count=true")
        if self._search:
            parts.append(f"$search={self._search}")
        if self._raw:
            parts.append(self._raw.lstrip('&'))

        return '&'.join(parts)

    @classmethod
    def from_dict(cls, opts: dict) -> "ODataBuilder":
        """Build from a plain dict of options."""
        b = cls()
        if 'top' in opts:    b.top(opts['top'])
        if 'skip' in opts:   b.skip(opts['skip'])
        if 'select' in opts:
            fields = opts['select']
            b.select(*([fields] if isinstance(fields, str) else fields))
        if 'filter' in opts: b.filter(opts['filter'])
        if 'orderby' in opts: b.orderby(*opts['orderby'].split(' '))
        if 'expand' in opts:
            props = opts['expand']
            b.expand(*([props] if isinstance(props, str) else props))
        if 'count' in opts:  b.count(opts['count'])
        if 'search' in opts: b.search(opts['search'])
        if 'raw' in opts:    b.raw(opts['raw'])
        return b
