"""The board: what every client pushed last, served to Prometheus as one scrape (ADR-0010).

Each push replaces that client's families. Prometheus scrapes the board every second like any
target, so its staleness handling works as it does for a pulled target: a client that stops
pushing is dropped from the board after `ttl` seconds, its series go stale, and
`mars_push_up{station, instance}` turns 0 (the recording rules read that for `mars:node_up`).

Every sample gets the key's `station` and the pushed `instance`, whatever the client sent, so a
key can't write into another station. Pushed timestamps are dropped: a sample with an explicit
timestamp gets no staleness marker in Prometheus.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

from prometheus_client.metrics_core import Metric
from prometheus_client.openmetrics.parser import text_string_to_metric_families as parse_om
from prometheus_client.parser import text_string_to_metric_families as parse_text

from .keys import Key

# Only the MARS families: a client can't fill Prometheus with arbitrary series.
FAMILY_PREFIX = "mars_"
MAX_SAMPLES = 20_000
# How long a client that stopped pushing still reads as a node (at 0), as `last_over_time(…[1h])`
# keeps a pulled node's mars_info.
FORGET = 3600.0


@dataclass
class Entry:
    station: str
    families: list[Metric]
    at: float  # time.monotonic() of the last push
    wall: float  # time.time() of the last push, for the keys plate
    revoked: bool = False


def parse(body: str, content_type: str) -> list[Metric]:
    """The MARS families of a push in the text format (0.0.4) or OpenMetrics."""
    om = content_type.split(";")[0].strip() == "application/openmetrics-text"
    try:
        families = list((parse_om if om else parse_text)(body))
    except Exception as e:  # the parsers raise ValueError, KeyError, IndexError …
        raise ValueError(f"not {'OpenMetrics' if om else 'Prometheus text format'}: {e}") from e
    return [f for f in families if f.name.startswith(FAMILY_PREFIX)]


def relabel(families: list[Metric], station: str, instance: str) -> list[Metric]:
    out, n = [], 0
    for f in families:
        m = Metric(f.name, f.documentation, f.type, f.unit)
        for s in f.samples:
            labels = {k: v for k, v in s.labels.items() if k != "job"}
            labels["station"], labels["instance"] = station, instance
            m.samples.append(s._replace(labels=labels, timestamp=None))
        n += len(m.samples)
        out.append(m)
    if n > MAX_SAMPLES:
        raise ValueError(f"{n} samples in one push, at most {MAX_SAMPLES}")
    return out


class Board:
    def __init__(self, ttl: float = 5.0, clock=time.monotonic):
        self.ttl = ttl
        self.clock = clock
        self._lock = threading.Lock()
        self._entries: dict[tuple[str, str], Entry] = {}  # (key id, instance) → entry

    def push(self, key: Key, instance: str, body: str, content_type: str) -> int:
        """Replaces what `instance` pushed with `key`; returns the number of samples kept."""
        families = relabel(parse(body, content_type), key.station, instance)
        entry = Entry(key.station, families, self.clock(), time.time())
        with self._lock:
            self._entries[(key.id, instance)] = entry
        return sum(len(f.samples) for f in families)

    def revoke(self, key_id: str) -> None:
        """A revoked key's clients read as down at once, not after `ttl`."""
        with self._lock:
            for (kid, _), e in self._entries.items():
                if kid == key_id:
                    e.revoked, e.families = True, []

    def clients(self, key_id: str) -> list[dict]:
        """The instances that pushed with a key in the last hour, for the keys plate."""
        now = self.clock()
        with self._lock:
            return sorted(
                (
                    {"instance": inst, "lastPush": e.wall, "live": self._fresh(e, now)}
                    for (kid, inst), e in self._entries.items()
                    if kid == key_id
                ),
                key=lambda c: c["instance"],
            )

    def _fresh(self, e: Entry, now: float) -> bool:
        return not e.revoked and now - e.at <= self.ttl

    def collect(self):
        """The prometheus_client collector protocol: every fresh client's families, merged by
        name, and mars_push_up for every client of the last hour."""
        now = self.clock()
        with self._lock:
            for k in [k for k, e in self._entries.items() if now - e.at > FORGET]:
                del self._entries[k]
            entries = list(self._entries.items())
        merged: dict[str, Metric] = {}
        up = Metric("mars_push_up", "1 while a client pushes, 0 once it stopped", "gauge")
        for (_, instance), e in entries:
            fresh = self._fresh(e, now)
            up.add_sample(
                "mars_push_up", {"station": e.station, "instance": instance}, 1 if fresh else 0
            )
            if not fresh:
                continue
            for f in e.families:
                m = merged.setdefault(f.name, Metric(f.name, f.documentation, f.type, f.unit))
                if m.type == f.type:  # two clients disagreeing on a type: the first one wins
                    m.samples.extend(f.samples)
        yield up
        yield from merged.values()
