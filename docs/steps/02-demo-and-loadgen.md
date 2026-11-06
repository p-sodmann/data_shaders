# Step 02: Demo service and load generator

Status: done
Depends on: 01
Read first: [ADR-0003](../adr/0003-metric-contract.md), `probe/README.md`

## Context

We need realistic, controllable traffic so the stack can be tested end to end without real
servers. Over time this replaces the browser simulator as the reference data.

## Goal

`examples/demo/`: one FastAPI app that can run as several stations, and a load generator with
daily patterns, periodic jobs and injectable incidents.

## Tasks

1. `examples/demo/pyproject.toml` (uv): depends on `mars-probe` by path (`../../probe`),
   `fastapi`, `uvicorn`, `httpx`.
2. **Demo app** (`demo/app.py`): the station name comes from `MARS_STATION` (default `api`).
   - Routes, chosen to mirror the simulator's endpoints:
     `POST /v1/predict`, `POST /v1/embed`, `POST /v1/rank`, `GET /v1/models`,
     `GET /v1/items/{item_id}`, `GET /healthz`.
   - Handlers `await asyncio.sleep()` with realistic, route-specific latency distributions
     (log-normal) and use `stage()` for `ingress`, `auth`, `embed`, `infer`, `rank`,
     `egress`. Not every route goes through every stage.
   - **Chaos control** at `/_chaos` (excluded from metrics):
     `POST /_chaos {"latency_ms": 40, "error_rate": 0.05, "stage": "infer", "duration_s": 120}`,
     `DELETE /_chaos`. It slows down one stage and/or returns 500s.
   - It reads `X-Demo-Region` and passes it through unchanged (step 11 uses it).
3. **Load generator** (`demo/loadgen.py`), async httpx, run with `python -m demo.loadgen`:
   - targets from `LOADGEN_TARGETS=http://demo-api:8000,http://demo-search:8000`
   - a base RPS per target with a daily sine (period configurable, default 24 h, and
     `LOADGEN_DAY_SECONDS=600` compresses a day for demos)
   - a periodic batch job every 5 minutes (a burst of `/v1/rank`), so the Rhythms instrument
     has something to find
   - a route mix with weights, and a region header drawn from a weighted region list
   - random incidents: about once per `LOADGEN_INCIDENT_EVERY` (default 45 min) it calls
     `/_chaos` on a random target
4. `examples/demo/Dockerfile`: `python:3.12-slim` with uv. The default command runs uvicorn on
   port 8000 (single process). The same image runs the loadgen by overriding the command.
5. `examples/demo/README.md`: how to run both locally without Docker, and the chaos API.

## Acceptance criteria

- [x] Run locally: two app instances (`MARS_STATION=api` on :8001, `search` on :8002) plus the
      loadgen. After 30 s, both `/metrics` show all ADR-0003 metrics, non-zero counts on several
      routes, and stage histograms.
- [x] `POST /_chaos` with `error_rate: 0.2` visibly raises the `code_class="5xx"` counts. After
      `duration_s`, they go back to baseline.
- [x] `docker build examples/demo` succeeds. Build from the repo root context if the path
      dependency needs it, and document the command.
- [x] ruff is clean.

## Verification

```bash
cd examples/demo && uv sync
MARS_STATION=api uv run uvicorn demo.app:app --port 8001 &
MARS_STATION=search uv run uvicorn demo.app:app --port 8002 &
LOADGEN_TARGETS=http://localhost:8001,http://localhost:8002 uv run python -m demo.loadgen &
sleep 30; curl -s localhost:8001/metrics | grep -c '^mars_'
```

## Out of scope

Prometheus and compose (step 03).

## Handoff

**Built**

- [examples/demo/pyproject.toml](../../examples/demo/pyproject.toml): `mars-demo` (hatchling,
  package `demo`). `mars-probe` comes from `../../probe` through `[tool.uv.sources]` (editable
  locally). Dev group: pytest and ruff. `uv.lock` is committed.
- [demo/app.py](../../examples/demo/demo/app.py): `create_app(station, *, latency_scale, cpu_ms,
  max_inflight, seed)` plus a module-level `app` configured from `MARS_STATION`,
  `DEMO_LATENCY_SCALE`, `DEMO_CPU_MS` and `DEMO_MAX_INFLIGHT`. It has the six routes. Each route
  passes through its own subset of stages, with log-normal latencies per stage and a per-route
  scale. `X-Demo-Region` is echoed on the response, including on 500s.
- [demo/chaos.py](../../examples/demo/demo/chaos.py): `GET`, `POST` and `DELETE /_chaos`, one
  incident at a time. The body is validated by pydantic (422 on a bad stage or a rate outside
  0..1). Expiry is checked lazily on each request.
- [demo/loadgen.py](../../examples/demo/demo/loadgen.py): open-loop Poisson arrivals per target,
  a daily sine, a wall-clock-aligned `/v1/rank` batch job, a weighted route and region mix, random
  incidents, and a stats line every 10 s.
- [Dockerfile](../../examples/demo/Dockerfile) (repo-root context) and the root
  [.dockerignore](../../.dockerignore).
- 14 tests in [examples/demo/tests/](../../examples/demo/tests/), and
  [examples/demo/README.md](../../examples/demo/README.md). The root README has a "Run the demo
  service" section.

**Deviations and decisions**

- **`/healthz` is in `exclude_paths`,** along with `/metrics` and `/_chaos`. Step 03's container
  healthcheck hits it every few seconds. Timed, it would add a near-zero-latency route that drags
  the station P50 down and shows up on the endpoint radar. The loadgen doesn't call it.
- **Chaos semantics** (the step only says "slows down one stage and/or returns 500s"):
  - With `stage`, the extra latency is spent inside that stage, and the errors are raised from
    inside it. Only routes that pass through the stage are hit (`infer` hits only `/v1/predict`).
  - Without `stage`, the latency is added outside every stage and the errors hit all routes.
  - `duration_s` defaults to 120 s. A new `POST` replaces the current incident. `GET /_chaos`
    returns the state.
  - Errors are `HTTPException(500)`, not unhandled exceptions, so uvicorn doesn't log a traceback
    for each one. The probe counts them as `5xx` either way.
- **Additions beyond the task list,** all small, so the downstream instruments have signal:
  - `/v1/items/{id}` returns 404 for ids ≥ 9000, which gives about 1 % 4xx overall.
  - `infer` burns 0.4 ms of CPU, because with sleeping alone `mars:node_load_ratio` would sit at 0.
  - A custom signal `mars_signal{signal="chaos_active"}`, read at scrape time, so the optional
    `mars_signal` metric is exercised too.
  - `DEMO_LATENCY_SCALE` lets step 03 make the two stations differ.
- **Loadgen extras:** `LOADGEN_RPS` (default 40), `LOADGEN_BATCH_EVERY` (5 m),
  `LOADGEN_BATCH_SIZE` (300 per target, spread over 10 s) and `LOADGEN_SEED`. Durations accept
  `30s`, `10m` and `2h`. The daily phase follows the UTC wall clock (low at 03:00, high at
  15:00, ×0.4 to ×1.6). It is not tied to process start, so restarts keep the phase. The batch
  job also lands on wall-clock multiples of its period.
- **Docker build context is the repo root** (`docker build -f examples/demo/Dockerfile .`),
  because the probe is a path dependency. The image installs the probe as a non-editable wheel,
  pins uv to `ghcr.io/astral-sh/uv:0.8`, and runs as `nobody`. The root `.dockerignore` only
  excludes generic junk (venvs, node_modules, caches, `.git`, web build output), so it won't get
  in the way of later root-context builds.
- No new dependencies beyond the step's list. pydantic comes with FastAPI.

**Verification**

```
$ cd examples/demo && uv sync && uv run pytest -q && uv run ruff check . && uv run ruff format --check .
14 passed, 1 warning in 0.29s          # warning: starlette's httpx→httpx2 deprecation (known, see open questions)
All checks passed!
7 files already formatted

# step verification: two uvicorn stations (:8001 api, :8002 search) + loadgen, after 30 s
$ curl -s localhost:8001/metrics | grep -c '^mars_'
292
# both stations: mars_info, mars_http_request_duration_seconds (5 routes, 2xx + 4xx on items),
# mars_http_requests_in_flight(_limit = 64), mars_process_cpu_seconds_total,
# mars_stage_duration_seconds for ingress/auth/embed/infer/rank/egress
mars_http_request_duration_seconds_count{code_class="2xx",method="POST",...,route="/v1/predict",station="api"} 315.0
mars_http_request_duration_seconds_count{code_class="4xx",method="GET",...,route="/v1/items/{item_id}",station="api"} 3.0
mars_stage_duration_seconds_count{stage="infer",station="api"} 315.0

# chaos on :8001, error_rate 0.2, duration_s 20, counted from /metrics over 10 s windows
baseline 10s: total=210 5xx=0
chaos 10s:    total=212 5xx=42        # mars_signal{signal="chaos_active"} 1.0
after 10s:    total=227 5xx=0         # GET /_chaos → {"active":false}, chaos_active 0.0

# short intervals (batch 15 s, incidents ~8 s, 40 s day): the batch job fired twice, incidents of
# all three kinds hit both targets, and the 10 s totals swung 307 → 690 with the compressed day.

# /v1/predict at 80 rps (ASGI, CPU burn on): p50 17.9 ms, p95 28.2 ms

$ podman build -f examples/demo/Dockerfile -t mars-demo .           # ok
$ DOCKER_HOST=unix://<podman socket> docker build -f examples/demo/Dockerfile .   # ok (legacy builder)
# container run: demo-api + demo-search + loadgen on a podman network, LOADGEN_DAY_SECONDS=600
#   → 293 mars_ lines on each station, loadgen ~50 rps per target, process uid nobody

$ cd probe && uv run pytest -q && uv run ruff check . && uv run ruff format --check .
23 passed · All checks passed! · 17 files already formatted
$ cd web && npm run build && npm run smoke      # (no npm test script exists)
✓ built · smoke: ok
```

**Not verified / needs a person**

- `docker build` against a real Docker Engine with BuildKit. This machine has no Docker daemon,
  only Podman. The build was checked with `podman build` and with the Docker CLI's legacy builder
  over the Podman socket.
- No Prometheus scrape yet (step 03).
- The default 45-minute incident interval and the 5-minute batch job were only run with shortened
  intervals. They are the same code paths with different numbers.

**Notes for later steps**

- Step 03 compose: service names `demo-api` and `demo-search`, both on port 8000, with
  `MARS_STATION` set per service. Loadgen: same image with `command: python -m demo.loadgen` and
  `LOADGEN_TARGETS=http://demo-api:8000,http://demo-search:8000`. The build needs
  `context: ..` (the repo root, seen from `deploy/`) and `dockerfile: examples/demo/Dockerfile`.
  The image has no curl, so use
  `python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')"`
  as the healthcheck.
- The demo stations aren't timed on `/healthz`, so a healthcheck adds no series.
- Station-level P50 under the default mix is roughly 10–20 ms. A latency incident of 40 ms or
  more pushes it past the display's 25 and 35 ms thresholds.
- Step 11: the loadgen already sends `X-Demo-Region` with the simulator's region codes and shares.
  The probe only has to trust that header (in the demo) to fill `region`.
