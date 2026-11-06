import random

import pytest

from demo.app import ROUTE_STAGES
from demo.chaos import ChaosRequest
from demo.loadgen import (
    INCIDENT_STAGES,
    Config,
    daily_factor,
    parse_duration,
    pick_request,
    random_incident,
)


def test_parse_duration():
    assert parse_duration("45m") == 2700
    assert parse_duration("2h") == 7200
    assert parse_duration("30s") == 30
    assert parse_duration("600") == 600


def test_config_from_env():
    cfg = Config.from_env(
        {
            "LOADGEN_TARGETS": "http://a:8000/, http://b:8000",
            "LOADGEN_DAY_SECONDS": "600",
            "LOADGEN_INCIDENT_EVERY": "10m",
        }
    )
    assert cfg.targets == ["http://a:8000", "http://b:8000"]
    assert cfg.day_seconds == 600
    assert cfg.incident_every == 600
    assert cfg.batch_every == 300
    assert Config.from_env({}).day_seconds == 86_400


def test_daily_factor_swings_once_per_day():
    day = 600
    values = [daily_factor(t, day) for t in range(0, day)]
    assert min(values) == pytest.approx(0.4, abs=0.01)
    assert max(values) == pytest.approx(1.6, abs=0.01)
    # Lowest at 03:00, highest at 15:00 of the (compressed) day.
    assert values.index(min(values)) == pytest.approx(day * 3 / 24, abs=2)
    assert values.index(max(values)) == pytest.approx(day * 15 / 24, abs=2)
    assert daily_factor(123, day) == pytest.approx(daily_factor(123 + day, day))


def test_pick_request_follows_the_mix():
    rng = random.Random(7)
    picks = [pick_request(rng) for _ in range(5000)]
    paths = [p for _, p, _ in picks]
    assert paths.count("/v1/predict") / len(paths) == pytest.approx(0.5, abs=0.03)
    items = [p for p in paths if p.startswith("/v1/items/")]
    assert items and all(p.split("/")[-1].isdigit() for p in items)
    assert {r for *_, r in picks} >= {"IAD", "NRT", "LHR"}


def test_incidents_are_valid_chaos_requests():
    rng = random.Random(3)
    for _ in range(200):
        body = random_incident(rng)
        req = ChaosRequest(**body)  # raises if the app would reject it
        assert req.latency_ms > 0 or req.error_rate > 0
        if req.stage:
            assert req.stage in INCIDENT_STAGES
            assert any(req.stage in dict(s) for s in ROUTE_STAGES.values())
