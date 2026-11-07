import pytest
from fastapi.testclient import TestClient

from demo.app import create_app

ADR_METRICS = (
    "mars_info",
    "mars_http_request_duration_seconds",
    "mars_http_requests_in_flight",
    "mars_http_requests_in_flight_limit",
    "mars_process_cpu_seconds_total",
    "mars_stage_duration_seconds",
)


@pytest.fixture
def client():
    # Latency scaled down so the tests don't sleep through real stage latencies.
    return TestClient(create_app("search", latency_scale=0.01, cpu_ms=0, seed=1))


def count(client, route, code_class):
    value = client.app.state.probe.registry.get_sample_value(
        "mars_http_request_duration_seconds_count",
        {
            "station": "search",
            "route": route,
            "method": "POST",
            "code_class": code_class,
            "region": "unknown",
        },
    )
    return value or 0


def test_routes_answer(client):
    assert client.post("/v1/predict").status_code == 200
    assert client.post("/v1/embed").status_code == 200
    assert client.post("/v1/rank").status_code == 200
    assert client.get("/v1/models").json()["station"] == "search"
    assert client.get("/v1/items/12").json() == {"station": "search", "id": 12}
    assert client.get("/v1/items/9500").status_code == 404
    assert client.get("/healthz").json()["ok"] is True


def test_metrics_carry_routes_and_stages(client):
    client.post("/v1/rank")
    client.get("/v1/items/3")
    text = client.get("/metrics").text
    for name in ADR_METRICS:
        assert name in text
    assert 'route="/v1/items/{item_id}"' in text
    assert 'station="search"' in text
    for name in ("ingress", "auth", "embed", "rank", "egress"):
        assert f'stage="{name}"' in text
    # /v1/rank doesn't run inference. (mars_stage_info lists it anyway: the order is declared.)
    timed = [line for line in text.splitlines() if line.startswith("mars_stage_duration")]
    assert not any('stage="infer"' in line for line in timed)
    assert 'mars_stage_info{order="3",stage="infer",station="search"} 1.0' in text


def test_chaos_and_health_are_not_timed(client):
    client.post("/_chaos", json={"latency_ms": 1, "duration_s": 5})
    client.get("/_chaos")
    client.delete("/_chaos")
    client.get("/healthz")
    text = client.get("/metrics").text
    assert "/_chaos" not in text
    assert "/healthz" not in text


def test_region_header_passes_through(client):
    r = client.post("/v1/predict", headers={"X-Demo-Region": "NRT"})
    assert r.headers["x-demo-region"] == "NRT"
    assert "x-demo-region" not in client.post("/v1/predict").headers


def test_chaos_errors_raise_5xx_and_clear(client):
    r = client.post("/_chaos", json={"error_rate": 1, "duration_s": 60})
    assert r.json()["active"] is True
    for _ in range(5):
        r = client.post("/v1/predict", headers={"X-Demo-Region": "FRA"})
        assert r.status_code == 500
        assert r.headers["x-demo-region"] == "FRA"
    assert count(client, "/v1/predict", "5xx") == 5
    assert client.delete("/_chaos").json() == {"active": False}
    assert client.post("/v1/predict").status_code == 200


def test_chaos_on_a_stage_only_hits_routes_through_it(client):
    client.post("/_chaos", json={"error_rate": 1, "stage": "infer", "duration_s": 60})
    assert client.post("/v1/predict").status_code == 500
    assert client.post("/v1/embed").status_code == 200


def test_chaos_latency_lands_in_its_stage(client):
    probe = client.app.state.probe

    def stage_sum(name):
        return probe.registry.get_sample_value(
            "mars_stage_duration_seconds_sum", {"station": "search", "stage": name}
        )

    client.post("/v1/embed")
    before = stage_sum("embed")
    client.post("/_chaos", json={"latency_ms": 50, "stage": "embed", "duration_s": 60})
    client.post("/v1/embed")
    assert stage_sum("embed") - before >= 0.05


def test_chaos_expires(client):
    client.post("/_chaos", json={"error_rate": 1, "duration_s": 30})
    chaos = client.app.state.chaos
    chaos.until -= 31  # as if 31 s had passed
    assert client.post("/v1/predict").status_code == 200
    assert client.get("/_chaos").json() == {"active": False}


def test_chaos_validates(client):
    assert client.post("/_chaos", json={"stage": "nope"}).status_code == 422
    assert client.post("/_chaos", json={"error_rate": 2}).status_code == 422
