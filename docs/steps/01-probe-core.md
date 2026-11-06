# Step 01: Probe core (`mars-probe`)

Status: todo
Depends on: 00
Read first: [ADR-0001](../adr/0001-monorepo.md), [ADR-0003](../adr/0003-metric-contract.md) (binding)

## Context

Users plug MARS into their own FastAPI servers (a single uvicorn process) with a small
library. It exposes Prometheus metrics that follow the contract in ADR-0003 exactly.

## Goal

A tested Python package in `probe/` that, with one call, instruments a FastAPI or Starlette
app and serves `/metrics`.

## Public API

```python
from mars_probe import instrument, stage

probe = instrument(
    app,                       # FastAPI / Starlette app
    station="api",             # required, ^[a-z][a-z0-9-]{0,31}$
    max_inflight=64,           # optional, feeds saturation
    metrics_path="/metrics",   # optional, None means don't mount
    exemplar_rate=1.0,         # exemplars per second (about), 0 disables
    exclude_paths=("/metrics",),
)

with stage("embed"):           # sync or async code
    ...

@stage("rank")                 # decorator form, sync and async functions
async def rank(...): ...

probe.gauge("queue_depth").set(12)   # → mars_signal{station, signal="queue_depth"}
```

## Tasks

1. `probe/pyproject.toml`: name `mars-probe`, hatchling, `requires-python >=3.11`,
   dependencies `prometheus-client>=0.20`, `starlette>=0.37`. Extras: `dev` (pytest, httpx,
   fastapi, ruff). Console script `mars-probe` → `mars_probe.cli:main`. Use the src layout:
   `probe/src/mars_probe/`.
2. **Registry:** use a dedicated `CollectorRegistry` per `instrument()` call, not the global
   one, so tests are isolated and default process metrics don't leak in. Every metric carries
   the `station` label with the configured value.
3. **Pure ASGI middleware** (not `BaseHTTPMiddleware`, so streaming and background tasks keep
   working):
   - time each HTTP request from receiving the scope to the final `http.response.body` (or the
     exception)
   - track in-flight requests with a gauge
   - resolve `route` from `scope["route"].path` after routing. For mounted sub-apps, join the
     prefixes. If nothing matched, use `<unmatched>`.
   - `code_class` comes from the response status. An exception becomes `5xx`, and is re-raised.
   - `region` is always `unknown` in this step. Put region resolution behind a small
     `resolve_region(scope) -> str` hook that step 11 will replace.
   - skip `exclude_paths` and non-HTTP scopes (websocket and lifespan pass straight through)
4. **Exemplars:** at most about `exemplar_rate` per second (token bucket), attached to the
   duration observation with `{"status": "<code>"}`.
5. **Stages:** `stage()` works as a context manager (sync and async) and as a decorator. It
   uses `time.perf_counter()` and observes `mars_stage_duration_seconds{station, stage}`. It
   must work outside a request too.
6. **CPU:** a custom collector that exposes `mars_process_cpu_seconds_total{station}` from
   `time.process_time()` at scrape time.
7. **`/metrics` endpoint:** content negotiation. Serve OpenMetrics when `Accept` asks for it
   (Prometheus does, with exemplar storage on), otherwise the text format. Use the helpers in
   `prometheus_client`.
8. `mars_info{station, version}` = 1, and `mars_http_requests_in_flight_limit` set from
   `max_inflight` (0 if unset).
9. A stub CLI: `mars-probe version`. (`mars-probe rules` comes in step 03.)
10. Tests (`probe/tests/`), using FastAPI's `TestClient` / httpx:
    - route templating, including path params, a mounted router with a prefix, and 404 as
      `<unmatched>`
    - code classes: 200, 404 (4xx, not an error), raised exception (5xx, re-raised)
    - an in-flight gauge that goes up during a slow handler and back to 0
    - stage sync, async and decorator forms, plus nesting
    - the `/metrics` text and OpenMetrics outputs contain every ADR-0003 metric with
      `station`, and OpenMetrics contains an exemplar
    - two `instrument()` calls on two apps in one process don't interfere
    - a streaming response is timed until the last chunk
11. `probe/README.md`: install from a path or git, a 10-line FastAPI example, and the metric
    table (link to ADR-0003, don't copy it).

## Acceptance criteria

- [ ] `uv run --project probe --extra dev pytest` passes. `ruff check` and `ruff format --check`
      are clean.
- [ ] The metric and label names match ADR-0003 exactly (a test asserts the full set of names).
- [ ] Middleware overhead is < 50 µs per request on a trivial endpoint (add a quick benchmark
      test marked `slow`, and report the number in the handoff).

## Verification

```bash
cd probe && uv sync --extra dev && uv run pytest -q && uv run ruff check . && uv run ruff format --check .
```

## Out of scope

Prometheus config and rules (step 03), GeoIP and regions (step 11), WSGI frameworks.
