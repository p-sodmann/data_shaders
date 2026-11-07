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


@pytest.mark.slow
def test_region_resolution_under_20us():
    # Step 11: resolving from headers must stay under 20 µs. A browser-sized header list, with
    # the region header near the end so the scan covers all of it.
    from mars_probe import RegionConfig
    from mars_probe.regions import RegionResolver

    resolve = RegionResolver(RegionConfig(header="X-Region", rtt_header="X-Client-RTT"))
    headers = [
        (b"host", b"api.example.com"),
        (b"user-agent", b"Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/140.0"),
        (b"accept", b"application/json"),
        (b"accept-language", b"de-DE,de;q=0.9,en;q=0.8"),
        (b"accept-encoding", b"gzip, deflate, br"),
        (b"content-type", b"application/json"),
        (b"content-length", b"17"),
        (b"x-request-id", b"7f8e9d0c-1b2a-4c3d-8e9f-0a1b2c3d4e5f"),
        (b"x-forwarded-for", b"85.10.10.10"),
        (b"x-forwarded-proto", b"https"),
        (b"cf-ipcountry", b"DE"),
        (b"x-client-rtt", b"23500"),
        (b"x-region", b"fra"),
    ]
    scope = {"type": "http", "headers": headers, "client": ("10.0.0.2", 5000)}
    assert resolve(scope) == ("FRA", pytest.approx(0.0235))
    best = float("inf")
    for _ in range(ROUNDS):
        t0 = perf_counter()
        for _ in range(N):
            resolve(scope)
        best = min(best, (perf_counter() - t0) / N)
    print(f"\nregion resolution {best * 1e6:.2f} µs")
    assert best * 1e6 < 20
