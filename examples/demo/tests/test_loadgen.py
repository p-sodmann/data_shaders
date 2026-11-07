import math
import random

import pytest

from demo.app import ROUTE_STAGES
from demo.chaos import ChaosRequest
from demo.loadgen import (
    INCIDENT_STAGES,
    REGION_CODES,
    Config,
    Routes,
    daily_factor,
    parse_duration,
    pick_request,
    random_incident,
    region_weights,
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
    assert Config.from_env({}).home == (50.1, 8.7)
    assert Config.from_env({"LOADGEN_HOME": "38.9, -77.4"}).home == (38.9, -77.4)
    with pytest.raises(ValueError):
        Config.from_env({"LOADGEN_HOME": "8.7,250"})


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


def test_rtt_grows_with_distance_from_home():
    routes = Routes((50.1, 8.7))  # Frankfurt
    rng = random.Random(1)

    def median_ms(code):
        values = sorted(routes.rtt_us(code, 0, rng) for _ in range(501))
        return values[250] / 1000

    assert median_ms("LHR") == pytest.approx(10, abs=2)
    assert median_ms("IAD") == pytest.approx(70, abs=6)
    assert median_ms("SYD") > 160
    assert median_ms("LHR") < median_ms("IAD") < median_ms("NRT") < median_ms("SYD")


def test_degraded_route_multiplies_rtt_until_it_ends():
    routes = Routes((50.1, 8.7))
    rng = random.Random(2)
    normal = routes.rtt_us("NRT", 100, rng)
    routes.degrade("NRT", 100, 60, 2.5)
    assert routes.rtt_us("NRT", 130, rng) == pytest.approx(normal * 2.5, rel=0.4)
    assert routes.rtt_us("NRT", 161, rng) == pytest.approx(normal, rel=0.4)
    assert routes.rtt_us("LHR", 130, rng) < normal  # other routes untouched


def test_region_mix_follows_local_daylight():
    # The traffic centre is the display's ground track: the mix must move it through the day.
    from mars_probe.regions import REGIONS

    day = 600

    def mean_lon(t):
        w = region_weights(t, day)
        lons = [math.radians(REGIONS[c][2]) for c in REGION_CODES]
        x = sum(wi * math.cos(lon) for wi, lon in zip(w, lons, strict=True))
        y = sum(wi * math.sin(lon) for wi, lon in zip(w, lons, strict=True))
        return math.degrees(math.atan2(y, x))

    # 15:00 UTC: afternoon in Europe and the Americas, the centre near 0°. 03:00 UTC: afternoon
    # in Asia and evening in the Americas, the centre out over the Pacific.
    noon, night = mean_lon(day * 15 / 24), mean_lon(day * 3 / 24)
    assert abs(noon) < 30
    assert abs((night - noon + 180) % 360 - 180) > 90
    w = region_weights(day * 15 / 24, day)
    assert w[REGION_CODES.index("IAD")] > w[REGION_CODES.index("NRT")] * 2
    assert all(wi > 0 for wi in w)
    rng = random.Random(5)
    picks = [pick_request(rng, w)[2] for _ in range(3000)]
    assert picks.count("IAD") > picks.count("NRT") * 2
