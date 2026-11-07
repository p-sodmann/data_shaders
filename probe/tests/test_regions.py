import json
import random
import string
from pathlib import Path
from types import SimpleNamespace

import pytest
from conftest import build_app, sample
from fastapi.testclient import TestClient

from mars_probe import RegionConfig
from mars_probe.regions import COUNTRIES, REGIONS, UNKNOWN, RegionResolver

REPO = Path(__file__).resolve().parents[2]


class FakeGeoIP:
    """Stands in for geoip2.database.Reader: a fixed IP → ISO country table."""

    def __init__(self, table):
        self.table = table
        self.lookups = 0

    def country(self, ip):
        self.lookups += 1
        if ip not in self.table:
            raise LookupError(ip)  # geoip2 raises AddressNotFoundError
        return SimpleNamespace(country=SimpleNamespace(iso_code=self.table[ip]))


def scope(headers=(), client=("85.10.10.10", 5000)):
    return {
        "type": "http",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
        "client": client,
    }


def test_table_is_shared_with_the_web_app():
    # The display joins label values against its copy; a code it lacks is dropped from the map.
    probe_copy = REPO / "probe" / "src" / "mars_probe" / "regions.json"
    web_copy = REPO / "web" / "src" / "data" / "regions.json"
    assert json.loads(web_copy.read_text()) == json.loads(probe_copy.read_text())


def test_every_country_maps_to_a_known_region():
    assert len(COUNTRIES) > 240
    assert set(COUNTRIES.values()) <= set(REGIONS)
    assert (COUNTRIES["DE"], COUNTRIES["US"], COUNTRIES["JP"]) == ("BER", "IAD", "NRT")


def test_precedence_header_then_country_then_geoip():
    geo = FakeGeoIP({"85.10.10.10": "BR"})
    resolve = RegionResolver(RegionConfig(header="X-Region", geoip=geo))
    both = [("X-Region", "fra"), ("CF-IPCountry", "JP")]
    assert resolve(scope(both)) == ("FRA", None)
    assert resolve(scope([("CF-IPCountry", "JP")])) == ("NRT", None)
    assert resolve(scope([("CloudFront-Viewer-Country", "au")])) == ("SYD", None)
    assert resolve(scope()) == ("GRU", None)
    # A code outside the table isn't believed; the next source decides.
    assert resolve(scope([("X-Region", "XYZ"), ("CF-IPCountry", "JP")])) == ("NRT", None)
    # Cloudflare's "XX" (no country) and "T1" (Tor) aren't countries either.
    assert resolve(scope([("CF-IPCountry", "T1")])) == ("GRU", None)


def test_unknown_fallback():
    assert RegionResolver(RegionConfig())(scope()) == (UNKNOWN, None)
    no_country = RegionResolver(RegionConfig(country_headers=()))
    assert no_country(scope([("CF-IPCountry", "DE")])) == (UNKNOWN, None)
    geo = RegionResolver(RegionConfig(geoip=FakeGeoIP({})))
    assert geo(scope()) == (UNKNOWN, None)  # not in the database
    assert geo(scope(client=("10.1.2.3", 5000))) == (UNKNOWN, None)  # private
    assert geo(scope(client=None)) == (UNKNOWN, None)  # no peer (e.g. a unix socket)


def test_spoofed_forwarded_for_from_untrusted_peer_is_ignored():
    geo = FakeGeoIP({"85.10.10.10": "DE", "133.11.0.1": "JP"})
    resolve = RegionResolver(RegionConfig(geoip=geo, trusted_proxies=["10.0.0.0/8"]))
    # The client claims to be a Japanese address, but connected directly from Germany.
    spoofed = scope([("X-Forwarded-For", "133.11.0.1")], client=("85.10.10.10", 5000))
    assert resolve(spoofed) == ("BER", None)
    # The same header through a trusted proxy is believed.
    proxied = scope([("X-Forwarded-For", "133.11.0.1")], client=("10.0.0.2", 5000))
    assert resolve(proxied) == ("NRT", None)


def test_forwarded_for_is_read_from_the_right():
    geo = FakeGeoIP({"85.10.10.10": "DE", "133.11.0.1": "JP"})
    resolve = RegionResolver(RegionConfig(geoip=geo, trusted_proxies=["10.0.0.0/8", "::1"]))
    # client → 10.0.0.5 → 10.0.0.2 → app. The leftmost entry is whatever the client sent.
    chain = "133.11.0.1, 85.10.10.10, 10.0.0.5"
    assert resolve(scope([("X-Forwarded-For", chain)], client=("10.0.0.2", 1))) == ("BER", None)
    # Only trusted hops: no client address left, so no lookup.
    only = scope([("X-Forwarded-For", "10.0.0.5")], client=("::1", 1))
    assert resolve(only) == (UNKNOWN, None)
    garbage = scope([("X-Forwarded-For", "not-an-ip")], client=("10.0.0.2", 1))
    assert resolve(garbage) == (UNKNOWN, None)


def test_geoip_is_cached_by_ip():
    geo = FakeGeoIP({"85.10.10.10": "DE"})
    resolve = RegionResolver(RegionConfig(geoip=geo, geoip_cache=8))
    for _ in range(50):
        assert resolve(scope())[0] == "BER"
    assert geo.lookups == 1


def test_geoip_path_needs_the_extra(monkeypatch):
    import builtins

    real_import = builtins.__import__

    def no_geoip2(name, *args, **kwargs):
        if name.startswith("geoip2"):
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_geoip2)
    with pytest.raises(ImportError, match=r"mars-probe\[geo\]"):
        RegionResolver(RegionConfig(geoip="/nope/GeoLite2-Country.mmdb"))


@pytest.mark.parametrize(
    ("value", "unit", "expected"),
    [("23500", 1e-6, 0.0235), ("12.5", 1e-3, 0.0125), ("-4", 1e-6, None), ("x", 1e-6, None)],
)
def test_rtt_header(value, unit, expected):
    resolve = RegionResolver(RegionConfig(rtt_header="X-Client-RTT", rtt_unit=unit))
    region, rtt = resolve(scope([("X-Client-RTT", value)]))
    assert region == UNKNOWN
    assert rtt == pytest.approx(expected) if expected is not None else rtt is None


def test_label_values_bounded_by_table():
    cfg = RegionConfig(header="X-Region", rtt_header="X-RTT")
    app, probe = build_app(regions=cfg)
    rng = random.Random(7)
    codes = list(REGIONS)
    with TestClient(app) as c:
        for i in range(600):
            if i % 3 == 0:
                region = rng.choice(codes).lower()
            else:  # whatever a client might send
                region = "".join(rng.choices(string.ascii_letters + "-_ /", k=rng.randint(0, 12)))
            c.get("/items/1", headers={"X-Region": region, "X-RTT": str(rng.randint(1, 900_000))})
    seen = {
        s.labels["region"]
        for m in probe.registry.collect()
        for s in m.samples
        if m.name in ("mars_http_request_duration_seconds", "mars_client_rtt_seconds")
    }
    assert UNKNOWN in seen
    assert seen - {UNKNOWN} <= set(REGIONS)
    assert len(seen) <= len(REGIONS) + 1


def test_requests_get_region_and_rtt():
    app, probe = build_app(regions=RegionConfig(header="X-Region", rtt_header="X-RTT"))
    with TestClient(app) as c:
        c.get("/items/1", headers={"X-Region": "FRA", "X-RTT": "20000"})
        c.get("/items/1", headers={"X-Region": "FRA", "X-RTT": "40000"})
        c.get("/items/1", headers={"X-Region": "FRA"})  # no RTT: still counted, not timed
    labels = dict(route="/items/{item_id}", method="GET", code_class="2xx", region="FRA")
    assert sample(probe, "mars_http_request_duration_seconds_count", **labels) == 3
    assert sample(probe, "mars_client_rtt_seconds_count", region="FRA") == 2
    assert sample(probe, "mars_client_rtt_seconds_sum", region="FRA") == pytest.approx(0.06)


def test_no_config_no_rtt_metric(app_probe):
    _, probe = app_probe
    names = {m.name for m in probe.registry.collect()}
    assert "mars_client_rtt_seconds" not in names
    assert probe.resolve_region(scope([("CF-IPCountry", "DE")])) == (UNKNOWN, None)
