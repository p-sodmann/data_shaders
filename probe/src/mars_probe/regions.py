"""Client region resolution. Step 11 replaces this with GeoIP / a trusted proxy header."""

from __future__ import annotations

UNKNOWN = "unknown"


def resolve_region(scope) -> str:
    """Region code (e.g. "FRA") for the request in `scope`, or "unknown"."""
    return UNKNOWN
