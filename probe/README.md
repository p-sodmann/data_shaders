# mars-probe

Prometheus instrumentation for FastAPI and Starlette apps, shaped for the
[MARS](../README.md) display. One call adds a pure ASGI middleware and serves `/metrics`.

## Install

Not on PyPI yet. Install from a path or from git:

```bash
uv add ./probe                                                    # path (inside this repo)
uv add "mars-probe @ git+https://<repo-url>#subdirectory=probe"   # git
pip install -e ./probe                                            # plain pip
```

Python ≥ 3.11. Dependencies: `prometheus-client`, `starlette`.

## Use

```python
from fastapi import FastAPI
from mars_probe import instrument, stage

app = FastAPI()
probe = instrument(app, station="api", max_inflight=64)  # serves /metrics


@app.get("/items/{item_id}")
async def item(item_id: int):
    with stage("lookup"):  # → mars_stage_duration_seconds{stage="lookup"}
        ...
    probe.gauge("queue_depth").set(12)  # → mars_signal{signal="queue_depth"}
    return {"id": item_id}
```

`instrument(app, station, *, max_inflight=None, metrics_path="/metrics", exemplar_rate=1.0,
exclude_paths=("/metrics",))`:

- `station` must match `^[a-z][a-z0-9-]{0,31}$`. It is the `station` label on every series.
- `max_inflight` feeds the saturation rule (`mars_http_requests_in_flight_limit`, 0 if unset).
- `metrics_path=None` doesn't serve metrics. Mount `probe.metrics_app` (an ASGI app) yourself.
- `exemplar_rate` is exemplars per second (about); 0 disables them. Exemplars only appear in
  the OpenMetrics format, which Prometheus requests by default.
- `exclude_paths` are exact paths (after `root_path`) that aren't timed.

`stage(name)` works as `with`, `async with` and as a decorator on sync and async functions.
Inside a request it records to the app serving that request; outside one, to the most
recently instrumented app; with no probe at all it does nothing. `probe.stage(name)` always
records to that probe.

Call `instrument()` before the app starts serving (it uses `app.add_middleware`).

## Metrics

The metric names, labels and buckets are a contract with the Prometheus recording rules and
the display: see [ADR-0003](../docs/adr/0003-metric-contract.md). In short: `mars_info`,
`mars_http_request_duration_seconds`, `mars_http_requests_in_flight`,
`mars_http_requests_in_flight_limit`, `mars_process_cpu_seconds_total`,
`mars_stage_duration_seconds` and `mars_signal`. `route` is always the route template
(mount prefixes included), or `<unmatched>`; `region` is `unknown` until step 11.

## Develop

```bash
cd probe
uv sync --extra dev
uv run pytest -q                  # -m "not slow" skips the overhead benchmark
uv run ruff check . && uv run ruff format --check .
uv run mars-probe version
```
