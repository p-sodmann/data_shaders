"""Collectors that read their value at scrape time."""

from __future__ import annotations

import time

from prometheus_client.metrics_core import CounterMetricFamily


class CpuCollector:
    """mars_process_cpu_seconds_total{station}: CPU time of this process (user + system).

    The recording rules turn its rate into node load, so a single-process uvicorn server at
    1.0 is using one full core.
    """

    def __init__(self, station: str):
        self.station = station

    def collect(self):
        c = CounterMetricFamily(
            "mars_process_cpu_seconds", "CPU time of the process", labels=["station"]
        )
        c.add_metric([self.station], time.process_time())
        yield c
