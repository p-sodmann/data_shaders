"""Push mode (ADR-0010): the probe sends its registry to mars-gateway every second from a
background thread, so the app needs no port that Prometheus can reach.

Pushes are OpenMetrics, the only format that carries exemplars, POSTed to
`<url>/push/<instance>` with the key in an `Authorization: Bearer` header. The gateway takes
the station from the key.
"""

from __future__ import annotations

import logging
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import quote

from prometheus_client.openmetrics.exposition import CONTENT_TYPE_LATEST, generate_latest

log = logging.getLogger("mars_probe")
BACKOFF_MAX = 10.0


class Pusher(threading.Thread):
    """Pushes `registry` to `url` every `interval` seconds until `stop()`."""

    def __init__(self, registry, url: str, key: str, instance: str, interval: float = 1.0):
        super().__init__(name="mars-probe-push", daemon=True)
        self.registry = registry
        self.url = f"{url.rstrip('/')}/push/{quote(instance, safe='')}"
        self.key = key
        self.interval = interval
        self.pushes = 0
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def push_once(self) -> None:
        req = urllib.request.Request(
            self.url,
            data=generate_latest(self.registry),
            method="POST",
            headers={"Authorization": f"Bearer {self.key}", "Content-Type": CONTENT_TYPE_LATEST},
        )
        with urllib.request.urlopen(req, timeout=max(self.interval * 2, 2.0)):
            pass

    def run(self) -> None:
        last_error, delay = None, self.interval
        next_at = time.monotonic()
        while not self._stop.is_set():
            try:
                self.push_once()
            except Exception as e:  # any failure is logged and retried
                if isinstance(e, urllib.error.HTTPError) and e.code == 401:
                    msg = "401: the gateway doesn't know this key (revoked, or a typo?)"
                else:
                    msg = str(getattr(e, "reason", e))
                if msg != last_error:
                    log.warning("mars-probe: push to %s failed: %s", self.url, msg)
                    last_error = msg
                delay = min(delay * 2, BACKOFF_MAX)
                next_at = time.monotonic() + delay
            else:
                if last_error is not False:
                    log.info("mars-probe: pushing to %s", self.url)
                    last_error = False
                self.pushes += 1
                delay = self.interval
                # On the second, without drift: Prometheus scrapes the gateway once a second.
                next_at = max(next_at + self.interval, time.monotonic())
            self._stop.wait(max(0.0, next_at - time.monotonic()))
