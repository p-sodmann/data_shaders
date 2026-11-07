"""Load generator for the demo stations: `python -m demo.loadgen`.

Open loop: arrivals are a Poisson process at the target rate, independent of how fast the
service answers, so an injected slowdown shows up as latency and in-flight requests instead of
silently lowering the throughput (which is what a closed loop of waiting clients would do).

Shapes the traffic like the simulator does: a daily sine, a periodic batch job of /v1/rank
bursts (something for the Rhythms instrument to find), a weighted route mix and client regions
that follow their local daylight, and now and then a random incident injected through a target's
/_chaos. Each request carries its region (`X-Demo-Region`) and a client RTT in µs
(`X-Demo-RTT`): the distance to HOME, plus jitter, plus now and then a degraded route.

Environment (durations take plain seconds or a 30s / 10m / 2h suffix):

    LOADGEN_TARGETS         comma-separated base URLs (default http://localhost:8000)
    LOADGEN_RPS             base requests per second per target (default 40)
    LOADGEN_DAY_SECONDS     period of the daily sine (default 24h; 600 compresses a day)
    LOADGEN_BATCH_EVERY     period of the batch job (default 5m; 0 disables it)
    LOADGEN_BATCH_SIZE      /v1/rank requests per batch (default 300)
    LOADGEN_INCIDENT_EVERY  mean time between incidents (default 45m; 0 disables them)
    LOADGEN_HOME            "lat,lon" of the stations, for the RTT (default 50.1,8.7, the
                            display's default station home)
    LOADGEN_DEGRADE_EVERY   mean time between degraded routes (default 15m; 0 disables them)
    LOADGEN_SEED            random seed (default: random)
"""

from __future__ import annotations

import asyncio
import contextlib
import math
import os
import random
import time
from collections import Counter
from dataclasses import dataclass

import httpx
from mars_probe.regions import REGIONS as REGION_TABLE

# [method, path or template, weight]. Mirrors the simulator's route mix.
ROUTES = [
    ("POST", "/v1/predict", 0.50),
    ("POST", "/v1/embed", 0.20),
    ("POST", "/v1/rank", 0.12),
    ("GET", "/v1/models", 0.08),
    ("GET", "/v1/items/{id}", 0.10),
]

# Region codes and traffic shares, the same as the simulator's REGIONS (web/src/config.js).
REGIONS = [
    ("IAD", 0.20), ("SFO", 0.12), ("MEX", 0.04), ("GRU", 0.05), ("LHR", 0.12), ("MAD", 0.06),
    ("JNB", 0.02), ("DXB", 0.04), ("BOM", 0.08), ("SIN", 0.09), ("NRT", 0.13), ("SYD", 0.05),
]  # fmt: skip
ROUTE_WEIGHTS = [w for *_, w in ROUTES]
REGION_WEIGHTS = [w for _, w in REGIONS]
REGION_CODES = [code for code, _ in REGIONS]

INCIDENT_STAGES = ("auth", "embed", "infer", "rank")
# Daily swing: the rate moves between (1 - DAY_AMPLITUDE) and (1 + DAY_AMPLITUDE) × base.
DAY_AMPLITUDE = 0.6
# The batch job's requests are spread over this many seconds, not fired at once.
BATCH_SPREAD_S = 10
# Upper bound on requests in flight per target, so a stalled target can't eat all memory.
MAX_PENDING = 512
REPORT_EVERY_S = 10
# The simulator's RTT model (web/src/data/simulator.js): 3 ms plus 1 ms per 95 km, which is
# roughly fibre at 2/3 c over a route about 1.5 × the great-circle distance, there and back.
RTT_BASE_MS = 3
RTT_KM_PER_MS = 95
RTT_JITTER = 0.08  # log-normal sigma of a single request's RTT


def parse_duration(value: str) -> float:
    value = value.strip().lower()
    units = {"s": 1, "m": 60, "h": 3600}
    if value and value[-1] in units:
        return float(value[:-1]) * units[value[-1]]
    return float(value)


def parse_home(value: str) -> tuple[float, float]:
    lat, lon = (float(v) for v in value.split(","))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError(f"LOADGEN_HOME {value!r} is not a lat,lon")
    return lat, lon


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(a))


@dataclass
class Config:
    targets: list[str]
    rps: float = 40
    day_seconds: float = 86_400
    batch_every: float = 300
    batch_size: int = 300
    incident_every: float = 2_700
    home: tuple[float, float] = (50.1, 8.7)
    degrade_every: float = 900
    seed: int | None = None

    @classmethod
    def from_env(cls, env=os.environ) -> Config:
        def duration(name, default):
            return parse_duration(env[name]) if env.get(name) else default

        targets = env.get("LOADGEN_TARGETS", "http://localhost:8000")
        return cls(
            targets=[t.strip().rstrip("/") for t in targets.split(",") if t.strip()],
            rps=float(env.get("LOADGEN_RPS") or 40),
            day_seconds=duration("LOADGEN_DAY_SECONDS", 86_400),
            batch_every=duration("LOADGEN_BATCH_EVERY", 300),
            batch_size=int(env.get("LOADGEN_BATCH_SIZE") or 300),
            incident_every=duration("LOADGEN_INCIDENT_EVERY", 2_700),
            home=parse_home(env.get("LOADGEN_HOME") or "50.1,8.7"),
            degrade_every=duration("LOADGEN_DEGRADE_EVERY", 900),
            seed=int(env["LOADGEN_SEED"]) if env.get("LOADGEN_SEED") else None,
        )


def daily_factor(t: float, day_seconds: float) -> float:
    """Traffic multiplier at wall-clock time `t`: lowest at 03:00, highest at 15:00 (UTC).

    Wall clock rather than time since start, so several loadgens (and restarts) agree on the
    time of day, and a 24 h day lines up with real days.
    """
    phase = (t % day_seconds) / day_seconds
    return 1 + DAY_AMPLITUDE * math.sin(2 * math.pi * (phase - 0.375))


def region_weights(t: float, day_seconds: float) -> list[float]:
    """Each region's share at time `t`, scaled by its local daylight (the simulator's curve).

    Busy where it is afternoon, quiet where it is night, so the request-weighted centre of
    traffic (the display's ground track) drifts west through the day. The day is the same
    (possibly compressed) day as `daily_factor`.
    """
    utc_hour = (t % day_seconds) / day_seconds * 24
    weights = []
    for code, share in REGIONS:
        hour = (utc_hour + REGION_TABLE[code][2] / 15) % 24
        daylight = (0.5 - 0.5 * math.cos(2 * math.pi * (hour - 4) / 24)) ** 1.4
        weights.append(share * (0.25 + 0.75 * daylight))
    return weights


def pick_request(rng: random.Random, weights=REGION_WEIGHTS) -> tuple[str, str, str]:
    """(method, path, region) for one request of the normal mix."""
    method, path, _ = rng.choices(ROUTES, weights=ROUTE_WEIGHTS)[0]
    if "{id}" in path:
        # Ids 9000+ don't exist on the demo app: about 10 % of item lookups are 404s.
        path = path.replace("{id}", str(rng.randrange(1, 10_000)))
    return method, path, pick_region(rng, weights)


def pick_region(rng: random.Random, weights=REGION_WEIGHTS) -> str:
    return rng.choices(REGION_CODES, weights=weights)[0]


class Routes:
    """Client RTT per region: distance to home, jitter, and now and then a degraded route.

    One instance for all targets, since the stations share a home: a degraded route to Tokyo
    shows on both. The display warns at 1.4 × a region's learned RTT and goes critical at 2 ×.
    """

    def __init__(self, home: tuple[float, float]):
        self.base_ms = {
            code: RTT_BASE_MS + distance_km(*REGION_TABLE[code][1:], *home) / RTT_KM_PER_MS
            for code in REGION_CODES
        }
        self.degraded: dict[str, tuple[float, float]] = {}  # code → (until, multiplier)

    def degrade(self, code: str, now: float, seconds: float, mul: float) -> None:
        self.degraded[code] = (now + seconds, mul)

    def rtt_us(self, code: str, now: float, rng: random.Random) -> int:
        ms = self.base_ms[code] * math.exp(RTT_JITTER * rng.gauss(0, 1))
        until, mul = self.degraded.get(code, (0, 1))
        if now < until:
            ms *= mul
        return round(ms * 1000)


def random_incident(rng: random.Random) -> dict:
    """A /_chaos body: a slow stage, an error burst, or both."""
    kind = rng.choice(("latency", "errors", "both"))
    body = {"duration_s": rng.randrange(60, 241, 30)}
    if kind != "errors":
        body["stage"] = rng.choice(INCIDENT_STAGES)
        body["latency_ms"] = rng.choice((15, 25, 40, 80))
    if kind != "latency":
        body["error_rate"] = rng.choice((0.02, 0.05, 0.1, 0.25))
    return body


class Target:
    def __init__(self, base: str, client: httpx.AsyncClient, routes: Routes, rng: random.Random):
        self.base = base
        self.client = client
        self.routes = routes
        self.rng = rng
        self.pending = asyncio.Semaphore(MAX_PENDING)
        self.stats: Counter = Counter()

    async def request(self, method: str, path: str, region: str) -> None:
        if self.pending.locked():
            self.stats["dropped"] += 1
            return
        async with self.pending:
            try:
                kw = {"json": {"input": "demo"}} if method == "POST" else {}
                rtt = self.routes.rtt_us(region, time.time(), self.rng)
                headers = {"X-Demo-Region": region, "X-Demo-RTT": str(rtt)}
                r = await self.client.request(method, self.base + path, headers=headers, **kw)
                self.stats[f"{r.status_code // 100}xx"] += 1
            except httpx.HTTPError:
                self.stats["failed"] += 1

    def fire(self, tasks: set, method: str, path: str, region: str) -> None:
        # Keep a reference until done: the event loop only holds tasks weakly.
        task = asyncio.create_task(self.request(method, path, region))
        tasks.add(task)
        task.add_done_callback(tasks.discard)


async def traffic(target: Target, cfg: Config, rng: random.Random, tasks: set) -> None:
    while True:
        rate = max(cfg.rps * daily_factor(time.time(), cfg.day_seconds), 0.1)
        await asyncio.sleep(rng.expovariate(rate))
        target.fire(tasks, *pick_request(rng, region_weights(time.time(), cfg.day_seconds)))


async def batch_job(targets: list[Target], cfg: Config, rng: random.Random, tasks: set) -> None:
    while True:
        # Aligned to the wall clock (every 5 min on the 5-min mark), so the job keeps its
        # phase across restarts, like a cron job would.
        await asyncio.sleep(cfg.batch_every - time.time() % cfg.batch_every)
        print(f"loadgen: batch job, {cfg.batch_size} × /v1/rank per target", flush=True)
        for _ in range(cfg.batch_size):
            weights = region_weights(time.time(), cfg.day_seconds)
            for target in targets:
                target.fire(tasks, "POST", "/v1/rank", pick_region(rng, weights))
            await asyncio.sleep(BATCH_SPREAD_S / cfg.batch_size)


async def incidents(targets: list[Target], cfg: Config, rng: random.Random) -> None:
    while True:
        await asyncio.sleep(rng.expovariate(1 / cfg.incident_every))
        target = rng.choice(targets)
        body = random_incident(rng)
        try:
            await target.client.post(target.base + "/_chaos", json=body)
            print(f"loadgen: incident on {target.base}: {body}", flush=True)
        except httpx.HTTPError as e:
            print(f"loadgen: incident on {target.base} failed: {e!r}", flush=True)


async def degradations(routes: Routes, cfg: Config, rng: random.Random) -> None:
    while True:
        await asyncio.sleep(rng.expovariate(1 / cfg.degrade_every))
        code = pick_region(rng)
        # Warn (×1.6) or critical (×2.5) on the display, for 2 to 7 minutes.
        seconds, mul = rng.randrange(120, 421, 60), rng.choice((1.6, 2.5))
        routes.degrade(code, time.time(), seconds, mul)
        print(f"loadgen: route {code} degraded ×{mul} for {seconds}s", flush=True)


async def report(targets: list[Target]) -> None:
    while True:
        await asyncio.sleep(REPORT_EVERY_S)
        for t in targets:
            stats = " ".join(f"{k}={v}" for k, v in sorted(t.stats.items())) or "no requests"
            print(f"loadgen: {t.base} last {REPORT_EVERY_S}s: {stats}", flush=True)
            t.stats.clear()


async def run(cfg: Config) -> None:
    rng = random.Random(cfg.seed)
    tasks: set[asyncio.Task] = set()
    routes = Routes(cfg.home)
    limits = httpx.Limits(max_connections=MAX_PENDING, max_keepalive_connections=64)
    async with httpx.AsyncClient(timeout=10, limits=limits) as client:
        targets = [Target(base, client, routes, rng) for base in cfg.targets]
        print(
            f"loadgen: {len(targets)} targets, {cfg.rps} rps base, day {cfg.day_seconds:g}s, "
            f"batch every {cfg.batch_every:g}s, incident every ~{cfg.incident_every:g}s, "
            f"home {cfg.home[0]:g},{cfg.home[1]:g}",
            flush=True,
        )
        jobs = [traffic(t, cfg, rng, tasks) for t in targets]
        jobs.append(report(targets))
        if cfg.batch_every > 0:
            jobs.append(batch_job(targets, cfg, rng, tasks))
        if cfg.incident_every > 0:
            jobs.append(incidents(targets, cfg, rng))
        if cfg.degrade_every > 0:
            jobs.append(degradations(routes, cfg, rng))
        await asyncio.gather(*jobs)


def main() -> None:
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(run(Config.from_env()))


if __name__ == "__main__":
    main()
