# Step 01: Probe core (`mars-probe`)

Status: done
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

- [x] `uv run --project probe --extra dev pytest` passes. `ruff check` and `ruff format --check`
      are clean.
- [x] The metric and label names match ADR-0003 exactly (a test asserts the full set of names).
- [x] Middleware overhead is < 50 µs per request on a trivial endpoint (add a quick benchmark
      test marked `slow`, and report the number in the handoff).

## Verification

```bash
cd probe && uv sync --extra dev && uv run pytest -q && uv run ruff check . && uv run ruff format --check .
```

## Out of scope

Prometheus config and rules (step 03), GeoIP and regions (step 11), WSGI frameworks.

## Handoff

**Built**

- [probe/pyproject.toml](../../probe/pyproject.toml): `mars-probe`, hatchling, src layout, version
  from [_version.py](../../probe/src/mars_probe/_version.py) (`0.1.0`), `dev` extra, `mars-probe`
  console script, ruff (line length 100, py311) and a `slow` pytest marker. `uv.lock` is committed.
- [probe.py](../../probe/src/mars_probe/probe.py): `Probe` (its own `CollectorRegistry`, all
  ADR-0003 metrics, ADR buckets, `gauge()`, `stage()`, `metrics_app`) and `instrument()`.
- [middleware.py](../../probe/src/mars_probe/middleware.py): pure ASGI. Times each request by
  wrapping `send`, until the last body chunk. Also handles in-flight, `code_class`, exceptions
  (→ `5xx`, re-raised), `exclude_paths`, and passes websocket/lifespan through. It serves
  `metrics_path` itself.
- [routes.py](../../probe/src/mars_probe/routes.py): route templates with mount prefixes joined
  (see Deviations).
- [stages.py](../../probe/src/mars_probe/stages.py): `stage()` as `with` / `async with` / decorator
  (sync and async).
- [exemplars.py](../../probe/src/mars_probe/exemplars.py) (token bucket),
  [collectors.py](../../probe/src/mars_probe/collectors.py) (CPU at scrape time),
  [regions.py](../../probe/src/mars_probe/regions.py) (`resolve_region(scope) -> "unknown"`),
  [exposition.py](../../probe/src/mars_probe/exposition.py) (`/metrics` with content negotiation via
  `prometheus_client.exposition.choose_encoder`), [cli.py](../../probe/src/mars_probe/cli.py)
  (`mars-probe version`).
- Tests in [probe/tests/](../../probe/tests/) (23), and [probe/README.md](../../probe/README.md).

**Deviations and decisions**

- **`mars_client_rtt_seconds` is not exposed yet.** ADR-0003 marks it optional and for step 11.
  The name-set test asserts the other seven names exactly and excludes this one on purpose.
  Step 11 adds the metric and the name to `EXPECTED` in `tests/test_exposition.py`.
- **Route resolution doesn't rely on `scope["route"]` alone.** Starlette's own router writes
  `scope["route"]` only in recent 1.x releases (checked: 0.37–0.52, 1.0 and 1.5 don't; 1.10
  does). FastAPI's routes always write it. Every version writes `scope["endpoint"]`. The resolver
  walks the app's route tree once (cached, rebuilt on a miss) and maps both route and endpoint
  to the full template, joining mount prefixes. When several routes share one endpoint, the one
  whose regex matches the path inside the innermost mount wins. A request that enters a router
  mount but matches nothing inside it is `<unmatched>`.
- **`metrics_path` is served by the middleware, not added as a route,** so a catch-all route
  can't shadow it and FastAPI's OpenAPI schema stays clean. It is never timed, even when it's
  not in `exclude_paths`. `probe.metrics_app` is exposed for `metrics_path=None` users.
- **Request end is the last body chunk, not when the app returns,** so background tasks don't
  inflate latency. An app that returns without a complete response counts as `5xx`, because the
  server answers 500. An exception after a complete response (in a background task) doesn't
  change the recorded class.
- **The exemplar `status` uses the real HTTP status.** For an exception before any response it's
  `500`. A 1xx final status (not possible over HTTP) would be folded into `2xx`, because the ADR
  only knows 2xx–5xx.
- **Which probe a `stage()` records to:** the probe of the request being served (a context
  variable; this also reaches sync endpoints in the threadpool, which is tested). Outside a
  request it's the most recent `instrument()` call. With no probe at all it does nothing.
  `probe.stage(name)` always records to that probe.
- The token bucket starts full (capacity `max(1, rate)`), so the first request carries an exemplar.
- No `license` field in `pyproject.toml`: no project licence has been chosen yet (see open
  questions).
- No dependencies beyond the step's list.

**Verification**

```
$ cd probe && uv sync --extra dev && uv run pytest -q && uv run ruff check . && uv run ruff format --check .
23 passed, 1 warning in 0.95s
All checks passed!
17 files already formatted

$ uv run pytest -q -s -m slow        # Python 3.13, starlette 1.10.0, fastapi 0.162.0, prometheus-client 0.26.0
bare 2.9 µs, probed 5.0 µs, overhead 2.1 µs/request
```

- Minimum versions (Python 3.11, starlette 0.37.2, fastapi 0.111.0, prometheus-client 0.20.0,
  httpx < 0.28) in a scratch venv: `23 passed`, overhead 2.4 µs/request. Before the
  endpoint fallback this run failed on the mounted plain-Starlette sub-app, which is how the
  `scope["route"]` gap was found.
- The benchmark calls the ASGI app directly (5000 requests × 7 rounds, best round) and
  compares against the same app without the probe. A sanity run confirmed every call returned
  200 and was counted (35 001 observations under `/ping/{n}`). The numbers are from an Apple
  Silicon Mac; slower machines will be several times higher and still far under 50 µs.
- `uv run mars-probe version` → `0.1.0`. `cd web && npm run smoke` → `smoke: ok` (unchanged).

**Not verified / needs a person**

- No real Prometheus scrape yet (step 03). OpenMetrics output is checked with
  `prometheus_client`'s own OpenMetrics parser, including the exemplar.
- Not run under a real uvicorn server, only via TestClient and direct ASGI calls.

**Notes for later steps**

- Step 02/03: Prometheus must scrape with OpenMetrics (its default `scrape_protocols` does) to
  get exemplars. `mars_process_cpu_seconds_total` is a custom collector, so it isn't in
  `registry.get_sample_value` until the first scrape, but it's always in `/metrics`.
- Step 03: `mars-probe rules` goes into [cli.py](../../probe/src/mars_probe/cli.py). The rules file
  belongs in `probe/src/mars_probe/prometheus/`, and hatchling's src-layout wheel config already
  includes everything under `src/mars_probe`.
- Step 11: replace `probe.resolve_region` (per probe) or `mars_probe.regions.resolve_region`. The
  middleware calls `probe.resolve_region(scope)` once per request, at the end of the response.
- Starlette 1.10 warns that `starlette.testclient` with `httpx` is deprecated in favour of
  `httpx2`. It's harmless now, but the `dev` extra may need `httpx2` once Starlette drops httpx.
- The `.labels()` children are cached per probe. The label sets are bounded by the routes
  (templates, never raw paths), so the cache doesn't grow with traffic.
