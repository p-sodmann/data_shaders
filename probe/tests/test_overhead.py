"""Middleware overhead on a trivial endpoint, measured with direct ASGI calls (no HTTP client,
which would dwarf the difference). Target from step 01: < 50 µs per request."""

import asyncio
from time import perf_counter

import pytest
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from mars_probe import instrument

N = 5000
ROUNDS = 7
LIMIT_US = 50


def make_app(instrumented: bool):
    async def ping(request):
        return PlainTextResponse("ok")

    app = Starlette(routes=[Route("/ping/{n}", ping)])
    if instrumented:
        instrument(app, station="bench")
    return app


async def per_request_seconds(app) -> float:
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/ping/1",
        "raw_path": b"/ping/1",
        "root_path": "",
        "query_string": b"",
        "headers": [],
        "server": ("test", 80),
        "client": ("test", 1234),
    }

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        pass

    best = float("inf")
    for _ in range(ROUNDS):
        t0 = perf_counter()
        for _ in range(N):
            # Starlette/the router write into the scope; give each request a fresh one.
            await app(dict(scope), receive, send)
        best = min(best, (perf_counter() - t0) / N)
    return best


@pytest.mark.slow
def test_middleware_overhead_under_50us():
    bare, probed = make_app(False), make_app(True)

    async def main():
        await per_request_seconds(bare)  # warm up both stacks (middleware build, caches)
        await per_request_seconds(probed)
        return await per_request_seconds(bare), await per_request_seconds(probed)

    t_bare, t_probed = asyncio.run(main())
    overhead_us = (t_probed - t_bare) * 1e6
    print(
        f"\nbare {t_bare * 1e6:.1f} µs, probed {t_probed * 1e6:.1f} µs, "
        f"overhead {overhead_us:.1f} µs/request"
    )
    assert overhead_us < LIMIT_US
