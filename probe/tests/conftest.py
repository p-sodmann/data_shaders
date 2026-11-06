from __future__ import annotations

import asyncio

import pytest
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Mount, Route

from mars_probe import instrument, stage


def sample(probe, name: str, **labels) -> float | None:
    """Value of one sample in the probe's registry, labels matched exactly."""
    return probe.registry.get_sample_value(name, {"station": probe.station, **labels})


def build_app(station: str = "api", **kwargs):
    app = FastAPI()
    probe = instrument(app, station=station, **kwargs)
    app.state.gate = None

    @app.get("/items/{item_id}")
    async def item(item_id: int):
        return {"id": item_id}

    @app.get("/boom")
    async def boom():
        raise RuntimeError("boom")

    @app.get("/teapot")
    async def teapot():
        raise HTTPException(418)

    @app.get("/slow")
    def slow():
        # Sync on purpose: runs in the threadpool, the test thread releases it.
        app.state.entered.set()
        app.state.release.wait(5)
        return {"ok": True}

    @app.get("/stream")
    async def stream():
        async def chunks():
            for i in range(3):
                await asyncio.sleep(0.05)
                yield f"{i}\n"

        return StreamingResponse(chunks())

    @app.get("/staged")
    async def staged():
        with stage("outer"):
            async with stage("inner"):
                await asyncio.sleep(0.01)
        return {"ok": True}

    @stage("decorated-sync")
    def work():
        return 1

    @app.get("/staged-sync")
    def staged_sync():
        # Runs in the threadpool: the request context must follow it there.
        return {"n": work()}

    router = APIRouter(prefix="/v1")

    @router.get("/users/{uid}")
    async def user(uid: str):
        return {"uid": uid}

    app.include_router(router)

    # A plain Starlette sub-app under a mount: its router overwrites scope["route"].
    async def thing(request):
        return PlainTextResponse("thing")

    app.mount("/legacy", Starlette(routes=[Mount("/v0", routes=[Route("/things/{tid}", thing)])]))
    return app, probe


@pytest.fixture
def app_probe():
    return build_app()
