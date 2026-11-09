"""Push mode: the probe POSTs OpenMetrics to mars-gateway (ADR-0010)."""

import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from mars_probe import instrument


@pytest.fixture
def gateway():
    pushes = []

    class H(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            body = self.rfile.read(int(self.headers["Content-Length"]))
            pushes.append((self.path, dict(self.headers), body.decode()))
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}", pushes
    server.shutdown()
    server.server_close()


def wait_for(cond, timeout=5.0):
    end = time.monotonic() + timeout
    while not cond():
        assert time.monotonic() < end, "timed out"
        time.sleep(0.01)


def test_push(gateway):
    url, pushes = gateway
    app = FastAPI()

    @app.get("/x")
    async def x():
        return {}

    probe = instrument(app, "api", push_url=url, push_key="mars_k3y", instance="api-1")
    probe.pusher.interval = 0.02
    try:
        with TestClient(app) as c:
            c.get("/x")
        # A push already in flight can contain a snapshot from before /x completed.
        # Wait for the request's metrics and exemplar, not just another HTTP POST.
        wait_for(
            lambda: any(
                'route="/x"' in body and '# {status="200"}' in body for _, _, body in pushes
            )
        )
    finally:
        probe.pusher.stop()
    path, headers, body = next(
        push
        for push in reversed(pushes)
        if 'route="/x"' in push[2] and '# {status="200"}' in push[2]
    )
    assert path == "/push/api-1"
    assert headers["Authorization"] == "Bearer mars_k3y"
    assert headers["Content-Type"].startswith("application/openmetrics-text")
    assert body.endswith("# EOF\n")
    # exemplars only travel in OpenMetrics, and the display's trace needs them
    assert 'route="/x"' in body and '# {status="200"}' in body


def test_push_reads_the_environment(gateway, monkeypatch):
    url, pushes = gateway
    monkeypatch.setenv("MARS_PUSH_URL", url)
    monkeypatch.setenv("MARS_PUSH_KEY", "mars_k3y")
    monkeypatch.setenv("MARS_INSTANCE", "api-2")
    probe = instrument(FastAPI(), "api")
    try:
        wait_for(lambda: pushes)
    finally:
        probe.pusher.stop()
    assert pushes[0][0] == "/push/api-2"


def test_no_push_without_url(monkeypatch):
    monkeypatch.delenv("MARS_PUSH_URL", raising=False)
    assert instrument(FastAPI(), "api").pusher is None
    with pytest.raises(ValueError, match="push_key"):
        instrument(FastAPI(), "api", push_url="http://mars:8080", push_key="")
