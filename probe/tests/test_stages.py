import asyncio

from conftest import build_app, sample
from fastapi.testclient import TestClient

from mars_probe import Probe, stage, stages

COUNT = "mars_stage_duration_seconds_count"
SUM = "mars_stage_duration_seconds_sum"


def test_sync_context_manager_outside_request():
    _, probe = build_app("outside")
    with stage("embed"):
        pass
    assert sample(probe, COUNT, stage="embed") == 1


def test_async_context_manager_and_nesting(app_probe):
    app, probe = app_probe
    with TestClient(app) as c:
        c.get("/staged")
    assert sample(probe, COUNT, stage="outer") == 1
    assert sample(probe, COUNT, stage="inner") == 1
    assert sample(probe, SUM, stage="outer") >= sample(probe, SUM, stage="inner") >= 0.009


def test_decorator_sync_in_threadpool(app_probe):
    app, probe = app_probe
    with TestClient(app) as c:
        assert c.get("/staged-sync").json() == {"n": 1}
    assert sample(probe, COUNT, stage="decorated-sync") == 1


def test_decorator_async_and_concurrency():
    _, probe = build_app("deco")

    @stage("rank")
    async def rank(x):
        await asyncio.sleep(0.01)
        return x * 2

    async def main():
        return await asyncio.gather(*(rank(i) for i in range(5)))

    assert asyncio.run(main()) == [0, 2, 4, 6, 8]
    assert rank.__name__ == "rank"
    assert sample(probe, COUNT, stage="rank") == 5


def test_reentrant_instance_and_exceptions():
    _, probe = build_app("reentry")
    s = stage("loop")
    with s, s:
        pass
    try:
        with stage("fails"):
            raise KeyError
    except KeyError:
        pass
    assert sample(probe, COUNT, stage="loop") == 2
    assert sample(probe, COUNT, stage="fails") == 1


def test_bound_probe_stage_and_no_probe_noop():
    _, probe_a = build_app("bound-a")
    _, probe_b = build_app("bound-b")  # now the default
    with probe_a.stage("x"):
        pass
    assert sample(probe_a, COUNT, stage="x") == 1
    assert sample(probe_b, COUNT, stage="x") is None

    stages.set_default(None)
    with stage("nowhere"):  # no probe: silently ignored
        pass
    assert isinstance(probe_a, Probe)
