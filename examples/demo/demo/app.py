"""Demo FastAPI service: fake ML-API routes with realistic latencies, instrumented by mars-probe.

One app, several stations: `MARS_STATION=api uvicorn demo.app:app` and
`MARS_STATION=search uvicorn demo.app:app` are two stations of the same code. Handlers don't
compute anything; they sleep through their pipeline stages with log-normal latencies, so the
display gets plausible P50/P95 spreads and stage breakdowns without real load on the machine.
"""

from __future__ import annotations

import asyncio
import math
import os
import random
from time import perf_counter

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from mars_probe import instrument, stage

from .chaos import Chaos, ChaosRequest

# Median (ms) and log-normal sigma per stage. The medians follow the simulator's STAGE_SHARE
# (web/src/config.js), so /v1/predict sits around an 18 ms P50, inside the display's 25 ms warn.
STAGE_LATENCY = {
    "ingress": (1.2, 0.3),
    "auth": (1.0, 0.4),
    "embed": (3.0, 0.35),
    "infer": (8.0, 0.45),
    "rank": (2.8, 0.4),
    "egress": (1.0, 0.3),
}

# The stages each route passes through, with a per-route scale on that stage's median.
ROUTE_STAGES = {
    "predict": (("ingress", 1), ("auth", 1), ("embed", 1), ("infer", 1), ("egress", 1)),
    "embed": (("ingress", 1), ("auth", 1), ("embed", 2.2), ("egress", 1.4)),
    "rank": (("ingress", 1), ("auth", 1), ("embed", 1.5), ("rank", 2), ("egress", 1)),
    "models": (("ingress", 0.6), ("egress", 0.5)),
    "items": (("ingress", 1), ("auth", 1), ("egress", 0.8)),
}

MODELS = ["mars-small-3", "mars-base-3", "mars-large-2"]
# Items at or above this id don't exist, so the loadgen produces a trickle of 404s.
ITEM_COUNT = 9000


def env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    return float(value) if value else default


def lognormal_s(median_ms: float, sigma: float, rng: random.Random) -> float:
    return median_ms * math.exp(sigma * rng.gauss(0, 1)) / 1000


def burn_cpu(ms: float) -> None:
    # A little real CPU per inference, so mars_process_cpu_seconds_total (node load) moves with
    # traffic. Sleeping alone would leave the node load at zero.
    end = perf_counter() + ms / 1000
    while perf_counter() < end:
        pass


def create_app(
    station: str = "api",
    *,
    latency_scale: float = 1.0,
    cpu_ms: float = 0.4,
    max_inflight: int = 64,
    seed: int | None = None,
) -> FastAPI:
    rng = random.Random(seed)
    chaos = Chaos()

    def echo_region(request: Request, response: Response) -> str | None:
        # Passed through unchanged; step 11 resolves regions from it.
        region = request.headers.get("x-demo-region")
        if region is not None:
            response.headers["X-Demo-Region"] = region
        return region

    app = FastAPI(title=f"MARS demo · {station}", dependencies=[Depends(echo_region)])
    app.state.chaos = chaos
    # /_chaos is control traffic and /healthz is the container healthcheck; neither is the
    # service's real load, so they'd only skew the station's latency and throughput.
    probe = instrument(
        app,
        station=station,
        max_inflight=max_inflight,
        exclude_paths=("/metrics", "/_chaos", "/healthz"),
    )
    app.state.probe = probe
    # Read at scrape time, so it drops to 0 the moment an incident expires.
    probe.gauge("chaos_active").set_function(lambda: float(chaos.active()))

    def fail(region: str | None) -> HTTPException:
        headers = {"X-Demo-Region": region} if region is not None else None
        return HTTPException(500, "injected failure (chaos)", headers=headers)

    async def pipeline(route: str, region: str | None) -> None:
        hit = chaos.active()
        if hit and chaos.stage is None:
            await asyncio.sleep(chaos.latency_ms / 1000)
            if rng.random() < chaos.error_rate:
                raise fail(region)
        for name, scale in ROUTE_STAGES[route]:
            median, sigma = STAGE_LATENCY[name]
            with stage(name):
                delay = lognormal_s(median * scale * latency_scale, sigma, rng)
                if hit and chaos.stage == name:
                    delay += chaos.latency_ms / 1000
                await asyncio.sleep(delay)
                if name == "infer" and cpu_ms > 0:
                    burn_cpu(cpu_ms)
                if hit and chaos.stage == name and rng.random() < chaos.error_rate:
                    raise fail(region)

    @app.post("/v1/predict")
    async def predict(region: str | None = Depends(echo_region)):
        await pipeline("predict", region)
        return {"station": station, "label": rng.choice("ABCD"), "score": round(rng.random(), 3)}

    @app.post("/v1/embed")
    async def embed(region: str | None = Depends(echo_region)):
        await pipeline("embed", region)
        return {"station": station, "dim": 384}

    @app.post("/v1/rank")
    async def rank(region: str | None = Depends(echo_region)):
        await pipeline("rank", region)
        return {"station": station, "ranked": rng.sample(range(100), 10)}

    @app.get("/v1/models")
    async def models(region: str | None = Depends(echo_region)):
        await pipeline("models", region)
        return {"station": station, "models": MODELS}

    @app.get("/v1/items/{item_id}")
    async def item(item_id: int, region: str | None = Depends(echo_region)):
        await pipeline("items", region)
        if item_id >= ITEM_COUNT:
            raise HTTPException(404, "no such item")
        return {"station": station, "id": item_id}

    @app.get("/healthz")
    async def healthz():
        return {"ok": True, "station": station}

    @app.get("/_chaos")
    async def chaos_get():
        return chaos.describe()

    @app.post("/_chaos")
    async def chaos_set(req: ChaosRequest):
        chaos.set(req)
        return chaos.describe()

    @app.delete("/_chaos")
    async def chaos_clear():
        chaos.clear()
        return chaos.describe()

    return app


app = create_app(
    os.environ.get("MARS_STATION", "api"),
    latency_scale=env_float("DEMO_LATENCY_SCALE", 1.0),
    cpu_ms=env_float("DEMO_CPU_MS", 0.4),
    max_inflight=int(env_float("DEMO_MAX_INFLIGHT", 64)),
)
