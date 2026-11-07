"""Client region resolution: which region code a request's `region` label gets (ADR-0003).

Codes only ever come from the shared table in regions.json (the same table the display draws
on its map), so the label has at most len(table) + 1 values whatever clients send. Resolution
order, first hit wins:

1. a trusted header carrying a region code (`RegionConfig.header`, e.g. "X-Region"),
2. a country header set by a CDN edge (`CF-IPCountry`, ...), mapped to the region nearest that
   country's capital,
3. GeoIP (`mars-probe[geo]` and a GeoLite2 Country database) on the client IP,
4. "unknown".
"""

from __future__ import annotations

import ipaddress
import json
import math
from collections.abc import Iterable
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from os import PathLike

UNKNOWN = "unknown"

_TABLE = json.loads(resources.files(__package__).joinpath("regions.json").read_text())
# code → (name, lat, lon). Edit regions.json, not this; see scripts/gen_regions.py.
REGIONS: dict[str, tuple[str, float, float]] = {c: tuple(v) for c, v in _TABLE["regions"].items()}
# ISO 3166-1 alpha-2 → region code
COUNTRIES: dict[str, str] = _TABLE["countries"]


@dataclass(frozen=True)
class RegionConfig:
    """Where a request's region (and optionally its client RTT) comes from.

    header: a request header holding a region code from the table (any case). Only name a
        header that your edge sets and clients can't, since it is believed as it is.
    country_headers: headers holding an ISO country code. The defaults are set by Cloudflare
        and CloudFront; pass () if neither sits in front of the app, or clients could pick
        their own region by sending one.
    geoip: path to a GeoLite2/GeoIP2 Country database (needs `mars-probe[geo]`), or any object
        with a geoip2-style `country(ip)` method.
    trusted_proxies: addresses or networks ("10.0.0.0/8") of proxies whose X-Forwarded-For is
        believed. From any other peer the socket address is the client.
    geoip_cache: how many client IPs keep their looked-up region.
    rtt_header: a header holding the client's TCP round-trip time, set by the proxy (nginx:
        `proxy_set_header X-Client-RTT $tcpinfo_rtt;`). Observed as mars_client_rtt_seconds.
    rtt_unit: seconds per unit of rtt_header. nginx's $tcpinfo_rtt is in µs, hence 1e-6.
    """

    header: str | None = None
    country_headers: Iterable[str] = ("CF-IPCountry", "CloudFront-Viewer-Country")
    geoip: str | PathLike | object | None = None
    trusted_proxies: Iterable[str] = ()
    geoip_cache: int = 4096
    rtt_header: str | None = None
    rtt_unit: float = 1e-6


def _name(header: str) -> bytes:
    # ASGI servers hand header names over lower case.
    return header.lower().encode("latin-1")


def _open_geoip(geoip):
    if geoip is None or hasattr(geoip, "country"):
        return geoip
    try:
        import geoip2.database
    except ImportError as e:
        raise ImportError("RegionConfig(geoip=...) needs the extra: mars-probe[geo]") from e
    return geoip2.database.Reader(str(geoip))


class RegionResolver:
    """Turns an ASGI scope into (region code, client RTT in seconds or None).

    Built once per probe: header names are encoded up front, and each request is a single pass
    over its headers. That keeps the header path to a few µs; GeoIP results are cached by IP.
    """

    def __init__(self, config: RegionConfig):
        self.config = config
        self.region_header = _name(config.header) if config.header else None
        self.country_headers = tuple(_name(h) for h in config.country_headers)
        self.rtt_header = _name(config.rtt_header) if config.rtt_header else None
        self.rtt_unit = config.rtt_unit
        self.proxies = tuple(ipaddress.ip_network(p, strict=False) for p in config.trusted_proxies)
        self.reader = _open_geoip(config.geoip)
        wanted = [self.region_header, *self.country_headers, self.rtt_header]
        if self.reader is not None:
            wanted.append(b"x-forwarded-for")
        self.wanted = frozenset(h for h in wanted if h)
        # Per probe, not module-wide, so two probes with different databases don't share.
        self.geoip_region = lru_cache(maxsize=config.geoip_cache)(self._geoip_region)
        self.is_trusted = lru_cache(maxsize=256)(self._is_trusted)

    def __call__(self, scope) -> tuple[str, float | None]:
        wanted = self.wanted
        found = {}
        for name, value in scope["headers"]:
            if name in wanted:
                found[name] = value
        return self.region(scope, found), self.rtt(found)

    def region(self, scope, found: dict) -> str:
        if self.region_header is not None:
            value = found.get(self.region_header)
            if value is not None:
                code = value.decode("latin-1").strip().upper()
                if code in REGIONS:
                    return code
        for name in self.country_headers:
            value = found.get(name)
            if value is not None:
                code = COUNTRIES.get(value.decode("latin-1").strip().upper())
                if code is not None:
                    return code
        if self.reader is not None:
            ip = self.client_ip(scope, found.get(b"x-forwarded-for"))
            if ip is not None:
                return self.geoip_region(ip)
        return UNKNOWN

    def rtt(self, found: dict) -> float | None:
        if self.rtt_header is None:
            return None
        value = found.get(self.rtt_header)
        if value is None:
            return None
        try:
            rtt = float(value) * self.rtt_unit
        except ValueError:
            return None
        return rtt if math.isfinite(rtt) and rtt >= 0 else None

    def client_ip(self, scope, forwarded: bytes | None) -> str | None:
        """The client's address: the socket peer, unless that peer is a trusted proxy.

        Behind trusted proxies, X-Forwarded-For is read from the right (each proxy appends the
        address it saw) and the first address that isn't a trusted proxy is the client. Entries
        to the left of it were written by the client itself, so they are never believed.
        """
        client = scope.get("client")
        peer = client[0] if client else None
        if peer is None or forwarded is None or not self.is_trusted(peer):
            return peer
        for hop in reversed(forwarded.decode("latin-1").split(",")):
            hop = hop.strip()
            if not self.is_trusted(hop):
                return hop or None
        return None

    def _is_trusted(self, ip: str) -> bool:
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return False
        return any(addr in net for net in self.proxies)

    def _geoip_region(self, ip: str) -> str:
        try:
            if not ipaddress.ip_address(ip).is_global:
                return UNKNOWN  # private and loopback addresses are in no database
            iso = self.reader.country(ip).country.iso_code
        except Exception:
            # Not an address, or not in the database (geoip2 raises AddressNotFoundError).
            return UNKNOWN
        return COUNTRIES.get(iso or "", UNKNOWN)


def no_region(scope) -> tuple[str, float | None]:
    """The resolver of a probe without a RegionConfig: every request is "unknown"."""
    return UNKNOWN, None
