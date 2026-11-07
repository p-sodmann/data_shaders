"""Push mode (ADR-0010): the agent sends its reading to mars-gateway every second instead of
waiting for Prometheus to scrape it, so the host needs no open port.

Each push is the same text /metrics would serve, POSTed to `<url>/push/<instance>` with the
key in an `Authorization: Bearer` header. The gateway takes the station from the key.
"""

from __future__ import annotations

import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from urllib.parse import quote

CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"
# Touched after every accepted push; `--healthcheck` reads its age.
HEARTBEAT = Path("/tmp/mars-agent.pushed")
BACKOFF_MAX = 10.0


def endpoint(url: str, instance: str) -> str:
    return f"{url.rstrip('/')}/push/{quote(instance, safe='')}"


def push_once(url: str, key: str, body: bytes, timeout: float) -> None:
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": CONTENT_TYPE},
    )
    with urllib.request.urlopen(req, timeout=timeout):
        pass


def describe(e: Exception) -> str:
    if isinstance(e, urllib.error.HTTPError):
        detail = e.read().decode(errors="replace").strip()
        if e.code == 401:
            return "401: the gateway doesn't know this key (revoked, or a typo?)"
        return f"{e.code}: {detail or e.reason}"
    if isinstance(e, urllib.error.URLError):
        return str(e.reason)
    return str(e)


def run(
    url: str,
    key: str,
    body: Callable[[], bytes],
    interval: float = 1.0,
    heartbeat: Path | None = HEARTBEAT,
    stop: Callable[[], bool] = lambda: False,
) -> None:
    """Pushes `body()` to `url` every `interval` seconds until `stop()`.

    Logs only when the state changes (first success, a new error, recovery), and backs off to
    10 s while the gateway is unreachable.
    """
    last_error, delay = None, interval
    next_at = time.monotonic()
    while not stop():
        try:
            push_once(url, key, body(), timeout=max(interval * 2, 2.0))
        except Exception as e:  # any failure is logged and retried
            msg = describe(e)
            if msg != last_error:
                print(f"mars-agent: push to {url} failed: {msg}", file=sys.stderr, flush=True)
                last_error = msg
            delay = min(delay * 2, BACKOFF_MAX)
            next_at = time.monotonic() + delay
        else:
            if last_error is not False:
                print(f"mars-agent: pushing to {url}", file=sys.stderr, flush=True)
                last_error = False
            delay = interval
            if heartbeat:
                heartbeat.touch()
            # On the second, without drift: Prometheus scrapes the gateway once a second.
            next_at = max(next_at + interval, time.monotonic())
        time.sleep(max(0.0, next_at - time.monotonic()))
