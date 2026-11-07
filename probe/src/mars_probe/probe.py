"""The probe: one registry with the ADR-0003 metrics for one station."""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import TYPE_CHECKING

from prometheus_client import CollectorRegistry, Gauge, Histogram

from . import stages as _stages
from ._version import __version__
from .collectors import CpuCollector
from .exemplars import TokenBucket
from .exposition import MetricsApp
from .middleware import MarsMiddleware
from .regions import RegionConfig, RegionResolver, no_region

if TYPE_CHECKING:
    from starlette.applications import Starlette

STATION_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")

# ADR-0003. The recording rules and the display's thresholds are tuned to these edges, so they
# are part of the contract, not a tuning knob.
BUCKETS = (
    0.001, 0.0025, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.025, 0.03, 0.04,
    0.05, 0.075, 0.1, 0.15, 0.25, 0.5, 1, 2.5, 5, 10,
)  # fmt: skip
# Client RTT (step 11). The rules only read its mean, so these are for people reading the raw
# histogram: LAN, same metro, same continent, across an ocean, across the planet.
RTT_BUCKETS = (0.001, 0.0025, 0.005, 0.01, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 1)


class Probe:
    """Metrics for one station. Use `instrument()` to create one and attach it to an app."""

    def __init__(
        self,
        station: str,
        *,
        max_inflight: int | None = None,
        exemplar_rate: float = 1.0,
        exclude_paths: Iterable[str] = ("/metrics",),
        metrics_path: str | None = "/metrics",
        stages: Iterable[str] = (),
        regions: RegionConfig | None = None,
    ) -> None:
        if not STATION_RE.match(station):
            raise ValueError(f"station {station!r} must match {STATION_RE.pattern}")
        self.station = station
        self.metrics_path = metrics_path
        self.exclude_paths = frozenset(exclude_paths)
        self.exemplars = TokenBucket(exemplar_rate)
        # scope → (region, client RTT seconds or None). Without a config every request is
        # "unknown", as before step 11.
        self.resolve_region = RegionResolver(regions) if regions is not None else no_region

        # A registry of our own: tests stay isolated, several probes can live in one process,
        # and the default process_* / python_* collectors don't leak into the MARS series.
        self.registry = r = CollectorRegistry(auto_describe=True)
        s = ["station"]
        info = Gauge("mars_info", "MARS probe identity", s + ["version"], registry=r)
        info.labels(station, __version__).set(1)
        self.request_duration = Histogram(
            "mars_http_request_duration_seconds",
            "HTTP request duration, from receiving the request to the last body chunk",
            s + ["route", "method", "code_class", "region"],
            buckets=BUCKETS,
            registry=r,
        )
        self.in_flight = Gauge(
            "mars_http_requests_in_flight", "Requests currently being handled", s, registry=r
        ).labels(station)
        Gauge(
            "mars_http_requests_in_flight_limit",
            "Configured max_inflight (0 = unset)",
            s,
            registry=r,
        ).labels(station).set(max_inflight or 0)
        self._stage = Histogram(
            "mars_stage_duration_seconds",
            "Time spent inside stage()",
            s + ["stage"],
            buckets=BUCKETS,
            registry=r,
        )
        # Prometheus can't tell which stage comes first in a request, so the probe says so: the
        # order given here, then stages in the order this process first sees them.
        self._stage_info = Gauge(
            "mars_stage_info", "Pipeline position of a stage", s + ["stage", "order"], registry=r
        )
        self._stage_order: dict[str, int] = {}
        for name in stages:
            self.see_stage(name)
        # Only with an RTT header: an always-empty histogram would just be noise on /metrics.
        self._rtt = None
        if regions is not None and regions.rtt_header:
            self._rtt = Histogram(
                "mars_client_rtt_seconds",
                "Client TCP round-trip time, from a trusted proxy header",
                s + ["region"],
                buckets=RTT_BUCKETS,
                registry=r,
            )
        self._rtt_children: dict[str, Histogram] = {}
        self._signal = Gauge("mars_signal", "Custom signals", s + ["signal"], registry=r)
        r.register(CpuCollector(station))

        self.metrics_app = MetricsApp(r)
        # Children by label values: `.labels()` validates and locks on every call, which is
        # most of the per-request cost if done each time.
        self._duration_children: dict[tuple[str, str, str, str], Histogram] = {}
        self._stage_children: dict[str, Histogram] = {}

    def observe_request(
        self, route: str, method: str, code_class: str, region: str, seconds: float, status: int
    ) -> None:
        key = (route, method, code_class, region)
        child = self._duration_children.get(key)
        if child is None:
            child = self.request_duration.labels(self.station, *key)
            self._duration_children[key] = child
        if self.exemplars.take():
            child.observe(seconds, {"status": str(status)})
        else:
            child.observe(seconds)

    def observe_rtt(self, region: str, seconds: float) -> None:
        child = self._rtt_children.get(region)
        if child is None:
            child = self._rtt_children[region] = self._rtt.labels(self.station, region)
        child.observe(seconds)

    def observe_stage(self, name: str, seconds: float) -> None:
        child = self._stage_children.get(name)
        if child is None:
            child = self._stage_children[name] = self._stage.labels(self.station, name)
            self.see_stage(name)
        child.observe(seconds)

    def see_stage(self, name: str) -> None:
        """Give a stage its pipeline position the first time it is seen (`mars_stage_info`)."""
        if name in self._stage_order:
            return
        order = self._stage_order[name] = len(self._stage_order)
        self._stage_info.labels(self.station, name, str(order)).set(1)

    def stage(self, name: str) -> _stages.stage:
        """Like `mars_probe.stage`, but always records to this probe."""
        return _stages.stage(name, probe=self)

    def gauge(self, signal: str) -> Gauge:
        """A custom signal, exposed as `mars_signal{station, signal}`."""
        return self._signal.labels(self.station, signal)


def instrument(
    app: Starlette,
    station: str,
    *,
    max_inflight: int | None = None,
    metrics_path: str | None = "/metrics",
    exemplar_rate: float = 1.0,
    exclude_paths: Iterable[str] = ("/metrics",),
    stages: Iterable[str] = (),
    regions: RegionConfig | None = None,
) -> Probe:
    """Instrument a FastAPI/Starlette app and (unless `metrics_path` is None) serve /metrics.

    `stages` is the pipeline order of the app's `stage()` names, exported as `mars_stage_info`.
    Stages not listed follow in the order the process first sees them.

    `regions` turns on the `region` label (and with `rtt_header`, mars_client_rtt_seconds);
    without it every request is region "unknown". See `RegionConfig`.

    Must be called before the app starts serving, like any `add_middleware`.
    """
    probe = Probe(
        station,
        max_inflight=max_inflight,
        exemplar_rate=exemplar_rate,
        exclude_paths=exclude_paths,
        metrics_path=metrics_path,
        stages=stages,
        regions=regions,
    )
    app.add_middleware(MarsMiddleware, probe=probe)
    # Stages outside any request go to the most recently instrumented app.
    _stages.set_default(probe)
    return probe
