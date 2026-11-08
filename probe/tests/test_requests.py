import threading

import pytest
from conftest import build_app, sample
from fastapi.testclient import TestClient

DURATION = "mars_http_request_duration_seconds_count"


def count(probe, route, code_class, method="GET"):
    return sample(
        probe, DURATION, route=route, method=method, code_class=code_class, region="unknown"
    )


def test_route_template_with_path_params(app_probe):
    app, probe = app_probe
    with TestClient(app) as c:
        assert c.get("/items/1").status_code == 200
        assert c.get("/items/2").status_code == 200
    assert count(probe, "/items/{item_id}", "2xx") == 2


def test_router_prefix_and_mounted_subapp(app_probe):
    app, probe = app_probe
    with TestClient(app) as c:
        assert c.get("/v1/users/ada").status_code == 200
        assert c.get("/legacy/v0/things/7").text == "thing"
    assert count(probe, "/v1/users/{uid}", "2xx") == 1
    # Both mount prefixes are joined in front of the inner route's template.
    assert count(probe, "/legacy/v0/things/{tid}", "2xx") == 1


def test_unmatched_is_4xx_not_raw_path(app_probe):
    app, probe = app_probe
    with TestClient(app) as c:
        assert c.get("/nope/123").status_code == 404
        # Inside a mount, but nothing in the sub-app matches.
        assert c.get("/legacy/v0/missing").status_code == 404
    assert count(probe, "<unmatched>", "4xx") == 2
    text = probe.registry.collect()
    routes = {s.labels.get("route") for m in text for s in m.samples}
    assert "/nope/123" not in routes


def test_code_classes(app_probe):
    app, probe = app_probe
    with TestClient(app, raise_server_exceptions=True) as c:
        assert c.get("/items/1").status_code == 200
        assert c.get("/teapot").status_code == 418
        with pytest.raises(RuntimeError, match="boom"):
            c.get("/boom")
    assert count(probe, "/items/{item_id}", "2xx") == 1
    assert count(probe, "/teapot", "4xx") == 1
    assert count(probe, "/boom", "5xx") == 1
    assert sample(probe, "mars_http_requests_in_flight") == 0


def test_in_flight_gauge(app_probe):
    app, probe = app_probe
    app.state.entered, app.state.release = threading.Event(), threading.Event()
    with TestClient(app) as c:
        result = {}
        t = threading.Thread(target=lambda: result.setdefault("r", c.get("/slow")))
        t.start()
        assert app.state.entered.wait(5)
        assert sample(probe, "mars_http_requests_in_flight") == 1
        app.state.release.set()
        t.join(5)
    assert result["r"].status_code == 200
    assert sample(probe, "mars_http_requests_in_flight") == 0


def test_streaming_is_timed_to_last_chunk(app_probe):
    app, probe = app_probe
    with TestClient(app) as c:
        assert c.get("/stream").text == "0\n1\n2\n"
    labels = dict(route="/stream", method="GET", code_class="2xx", region="unknown")
    assert sample(probe, DURATION, **labels) == 1
    # Three chunks 50 ms apart: the response object returns instantly, the body doesn't.
    assert sample(probe, "mars_http_request_duration_seconds_sum", **labels) >= 0.14


def test_excluded_paths_and_metrics_not_timed():
    app, probe = build_app(exclude_paths=("/metrics", "/items/1"))
    with TestClient(app) as c:
        c.get("/items/1")
        c.get("/metrics")
        c.get("/items/2")
    assert count(probe, "/items/{item_id}", "2xx") == 1
    routes = {s.labels.get("route") for m in probe.registry.collect() for s in m.samples}
    assert "/metrics" not in routes


def test_two_probes_do_not_interfere():
    app_a, probe_a = build_app("alpha")
    app_b, probe_b = build_app("beta")
    with TestClient(app_a) as a, TestClient(app_b) as b:
        a.get("/items/1")
        b.get("/items/1")
        b.get("/items/2")
        b.get("/staged")
        text_a = a.get("/metrics").text
    assert count(probe_a, "/items/{item_id}", "2xx") == 1
    assert count(probe_b, "/items/{item_id}", "2xx") == 2
    # The stage ran in beta's request, so it lands in beta even though alpha exists too.
    assert sample(probe_b, "mars_stage_duration_seconds_count", stage="inner") == 1
    assert sample(probe_a, "mars_stage_duration_seconds_count", stage="inner") is None
    assert 'station="beta"' not in text_a


def test_websocket_and_lifespan_pass_through():
    from fastapi import WebSocket

    app, probe = build_app()

    @app.websocket("/ws")
    async def ws(socket: WebSocket):
        await socket.accept()
        await socket.send_text("hi")
        await socket.close()

    with TestClient(app) as c, c.websocket_connect("/ws") as s:
        assert s.receive_text() == "hi"
    routes = {s.labels.get("route") for m in probe.registry.collect() for s in m.samples}
    assert "/ws" not in routes


def test_invalid_station_rejected():
    from fastapi import FastAPI

    from mars_probe import instrument

    for bad in ("API", "1api", "", "a" * 33, "my_api"):
        with pytest.raises(ValueError):
            instrument(FastAPI(), station=bad)


def test_shared_endpoint_and_scope_without_route():
    # Starlette before recent 1.x doesn't write scope["route"] for its own routes, so the
    # template must come from scope["endpoint"], even when one endpoint serves several routes.
    from starlette.applications import Starlette
    from starlette.responses import PlainTextResponse
    from starlette.routing import Mount, Route

    from mars_probe.routes import RouteTemplates

    async def shared(request):
        return PlainTextResponse("ok")

    sub = Starlette(routes=[Route("/a/{x}", shared), Route("/b/{y}", shared)])
    app = Starlette(routes=[Mount("/m", app=sub)])
    rt = RouteTemplates()

    def resolve(path):
        return rt.resolve(app, {"endpoint": shared, "path": path, "root_path": "/m"})

    assert resolve("/m/a/1") == "/m/a/{x}"
    assert resolve("/m/b/2") == "/m/b/{y}"
    # The router mount itself as endpoint: the request entered /m but matched nothing inside.
    assert rt.resolve(app, {"endpoint": sub, "path": "/m/zzz", "root_path": "/m"}) == "<unmatched>"
    assert rt.resolve(app, {"path": "/zzz"}) == "<unmatched>"


def test_shared_subapp_keeps_each_mount_template():
    from fastapi import FastAPI

    from mars_probe import instrument

    child = FastAPI()

    @child.get("/items/{item_id}")
    def item(item_id: int):
        return {"id": item_id}

    app = FastAPI()
    app.mount("/one", child)
    app.mount("/two", child)
    probe = instrument(app, "api")
    with TestClient(app, root_path="/proxy") as c:
        c.get("/proxy/one/items/1")
        c.get("/proxy/two/items/2")
        c.get("/proxy/one/items/3")
    assert count(probe, "/one/items/{item_id}", "2xx") == 2
    assert count(probe, "/two/items/{item_id}", "2xx") == 1


def test_shared_subapp_with_parameterized_mounts_and_reused_parameter_names():
    from fastapi import FastAPI

    from mars_probe import instrument

    child = FastAPI()

    @child.get("/items/{id}")
    def item(id: int):
        return {"id": id}

    app = FastAPI()
    app.mount("/one/{id}", child)
    app.mount("/two/{id}", child)
    probe = instrument(app, "api")
    with TestClient(app) as c:
        c.get("/one/123/items/1")
        c.get("/two/456/items/2")
    assert count(probe, "/one/{id}/items/{id}", "2xx") == 1
    assert count(probe, "/two/{id}/items/{id}", "2xx") == 1
