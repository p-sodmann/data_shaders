# Step 02: Demo service and load generator

Status: todo
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

- [ ] Run locally: two app instances (`MARS_STATION=api` on :8001, `search` on :8002) plus the
      loadgen. After 30 s, both `/metrics` show all ADR-0003 metrics, non-zero counts on several
      routes, and stage histograms.
- [ ] `POST /_chaos` with `error_rate: 0.2` visibly raises the `code_class="5xx"` counts. After
      `duration_s`, they go back to baseline.
- [ ] `docker build examples/demo` succeeds. Build from the repo root context if the path
      dependency needs it, and document the command.
- [ ] ruff is clean.

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
