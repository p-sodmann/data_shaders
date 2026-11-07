import re
import subprocess
import sys

from conftest import build_app
from fastapi.testclient import TestClient
from prometheus_client.openmetrics.parser import text_string_to_metric_families as parse_om
from prometheus_client.parser import text_string_to_metric_families as parse_text

from mars_probe import __version__

# ADR-0003 raw metrics. mars_client_rtt_seconds is optional (RegionConfig.rtt_header).
EXPECTED = {
    "mars_info": {"station", "version"},
    "mars_http_request_duration_seconds": {"station", "route", "method", "code_class", "region"},
    "mars_http_requests_in_flight": {"station"},
    "mars_http_requests_in_flight_limit": {"station"},
    "mars_process_cpu_seconds": {"station"},  # family name; the sample is ..._total
    "mars_stage_duration_seconds": {"station", "stage"},
    "mars_stage_info": {"station", "stage", "order"},
    "mars_signal": {"station", "signal"},
}
OM = "application/openmetrics-text; version=1.0.0; charset=utf-8"


def scrape(accept=None):
    app, probe = build_app("expo", max_inflight=64)
    probe.gauge("queue_depth").set(12)
    with TestClient(app) as c:
        c.get("/items/1")
        c.get("/staged")
        headers = {"accept": accept} if accept else {}
        r = c.get("/metrics", headers=headers)
    assert r.status_code == 200
    return r


def families(parsed):
    out = {}
    for fam in parsed:
        labels = set()
        for s in fam.samples:
            labels |= set(s.labels) - {"le", "quantile"}
            assert s.labels["station"] == "expo", s
        out[fam.name.removesuffix("_total")] = labels
    return out


def test_text_format_has_exact_metric_set():
    r = scrape()
    assert r.headers["content-type"].startswith("text/plain")
    fams = families(parse_text(r.text))
    assert {k: v for k, v in fams.items() if not k.endswith("_created")} == EXPECTED
    assert "mars_process_cpu_seconds_total{" in r.text
    assert f'mars_info{{station="expo",version="{__version__}"}} 1.0' in r.text
    assert 'mars_http_requests_in_flight_limit{station="expo"} 64.0' in r.text
    assert 'mars_signal{signal="queue_depth",station="expo"} 12.0' in r.text


def test_openmetrics_format_and_exemplar():
    r = scrape(OM)
    assert r.headers["content-type"].startswith("application/openmetrics-text")
    assert r.text.rstrip().endswith("# EOF")
    fams = families(parse_om(r.text))
    assert fams == EXPECTED
    # The first request takes the bucket's initial token, so it carries the exemplar.
    assert re.search(
        r'mars_http_request_duration_seconds_bucket\{[^}]*route="/items/\{item_id\}"[^}]*\} '
        r'\S+ # \{status="200"\} \S+',
        r.text,
    ), r.text


def test_exemplars_rate_limited_and_disabled():
    app, probe = build_app("ex", exemplar_rate=0)
    with TestClient(app) as c:
        c.get("/items/1")
        assert "# {" not in c.get("/metrics", headers={"accept": OM}).text

    app, probe = build_app("ex2", exemplar_rate=1.0)
    with TestClient(app) as c:
        for i in range(50):
            c.get(f"/items/{i}")
        text = c.get("/metrics", headers={"accept": OM}).text
    # 50 requests in well under a second: about one exemplar, not fifty.
    assert 1 <= text.count('# {status="200"}') <= 2


def test_metrics_path_none_and_custom():
    app, probe = build_app("nomount", metrics_path=None)
    with TestClient(app) as c:
        assert c.get("/metrics").status_code == 404
    app, probe = build_app("custom", metrics_path="/internal/metrics")
    with TestClient(app) as c:
        assert "mars_info" in c.get("/internal/metrics").text


def test_cli_version():
    out = subprocess.run(
        [sys.executable, "-m", "mars_probe.cli", "version"], capture_output=True, text=True
    )
    assert out.returncode == 0
    assert out.stdout.strip() == __version__


def test_rtt_histogram_only_with_rtt_header():
    from mars_probe import RegionConfig

    app, _ = build_app("expo", regions=RegionConfig(header="X-Region", rtt_header="X-RTT"))
    with TestClient(app) as c:
        c.get("/items/1", headers={"X-Region": "FRA", "X-RTT": "12000"})
        text = c.get("/metrics").text
    fams = families(parse_text(text))
    assert fams["mars_client_rtt_seconds"] == {"station", "region"}
    assert 'mars_client_rtt_seconds_bucket{le="0.02",region="FRA",station="expo"} 1.0' in text
