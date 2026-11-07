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

Python ≥ 3.11. Dependencies: `prometheus-client`, `starlette`. GeoIP region lookup needs the
`geo` extra (`uv add "./probe[geo]"`, which adds `geoip2`).

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
exclude_paths=("/metrics",), stages=(), regions=None)`:

- `station` must match `^[a-z][a-z0-9-]{0,31}$`. It is the `station` label on every series.
- `max_inflight` feeds the saturation rule (`mars_http_requests_in_flight_limit`, 0 if unset).
- `metrics_path=None` doesn't serve metrics. Mount `probe.metrics_app` (an ASGI app) yourself.
- `exemplar_rate` is exemplars per second (about); 0 disables them. Exemplars only appear in
  the OpenMetrics format, which Prometheus requests by default.
- `exclude_paths` are exact paths (after `root_path`) that aren't timed.
- `stages` is the pipeline order of your `stage()` names, for example
  `stages=["ingress", "auth", "infer", "egress"]`. It is exported as `mars_stage_info` and the
  display draws the pipeline in that order. Stages not listed follow in the order the process
  first enters them.
- `regions` is a `RegionConfig` (see [Client regions](#client-regions)). Without it every
  request is `region="unknown"`.

`stage(name)` works as `with`, `async with` and as a decorator on sync and async functions.
Inside a request it records to the app serving that request; outside one, to the most
recently instrumented app; with no probe at all it does nothing. `probe.stage(name)` always
records to that probe.

Call `instrument()` before the app starts serving (it uses `app.add_middleware`).

## Client regions

The `region` label says where a request came from, as a code from a fixed table of about 80
regions ([regions.json](src/mars_probe/regions.json), the same table the display's world map
uses). The display draws traffic arcs from each region to the station, an origins table and the
moving centre of traffic. Nothing finer than a region is recorded: no cities, no IPs.

```python
from mars_probe import RegionConfig, instrument

regions = RegionConfig(
    header="X-Region",  # 1. a region code your edge sets ("FRA")
    # 2. country_headers, by default CF-IPCountry and CloudFront-Viewer-Country
    geoip="/data/GeoLite2-Country.mmdb",  # 3. GeoIP on the client IP (mars-probe[geo])
    trusted_proxies=["10.0.0.0/8"],  # proxies whose X-Forwarded-For is believed
    rtt_header="X-Client-RTT",  # client RTT → mars_client_rtt_seconds
)
instrument(app, station="api", regions=regions)
```

The first source that gives an answer wins, and `unknown` is left when none does:

1. **`header`**: a header holding a region code from the table, in any case. A code that isn't
   in the table is ignored and the next source decides.
2. **`country_headers`**: an ISO country code, set by Cloudflare (`CF-IPCountry`) or CloudFront
   (`CloudFront-Viewer-Country`). It is mapped to the region nearest the country's capital.
3. **`geoip`**: a GeoLite2 or GeoIP2 *Country* database (free from MaxMind, with an account) or
   any object with a geoip2-style `country(ip)` method. Lookups are cached per IP
   (`geoip_cache=4096`). Private addresses are always `unknown`.
4. `unknown`.

Headers are believed as they are, so only name headers that your proxy sets **and overwrites**.
Both country headers are on by default; if neither Cloudflare nor CloudFront is in front of the
app, pass `country_headers=()`, or clients can pick their region. A wrong region only costs
accuracy: the label never takes a value outside the table, so the number of series stays
bounded (at most the table size + 1 per route, method and code class).

**Client IP for GeoIP.** The socket peer is the client, unless the peer is in
`trusted_proxies` (addresses or networks). Then `X-Forwarded-For` is read from the right and
the first address that isn't a trusted proxy is the client, so entries a client wrote itself
are never used. A direct client's `X-Forwarded-For` is ignored.

**Client RTT.** With `rtt_header`, each request that carries the header is also observed in
`mars_client_rtt_seconds{station, region}`, and the display's origins table shows the mean per
region. `rtt_unit` converts the header to seconds (default `1e-6`, for µs). nginx can pass the
TCP round-trip time it measured to the client connection:

```nginx
location / {
    proxy_pass http://app:8000;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Client-RTT    $tcpinfo_rtt;   # µs; rtt_unit=1e-6 (the default)
    proxy_set_header X-Region        "";             # clients can't set it; an edge map could
}
```

With headers, resolution costs well under a µs per request (the test limit is 20 µs).

**The table.** `regions.json` holds `regions` (code → name, lat, lon) and `countries` (ISO
code → region). To add a region, add it to `regions`, run
`uv run python scripts/gen_regions.py` (recomputes `countries`) and copy the file to
`web/src/data/regions.json`; tests in both packages fail while the two copies differ. Names
are upper case and at most 10 characters (the display's origins column).

## Metrics

The metric names, labels and buckets are a contract with the Prometheus recording rules and
the display: see [ADR-0003](../docs/adr/0003-metric-contract.md). In short: `mars_info`,
`mars_http_request_duration_seconds`, `mars_http_requests_in_flight`,
`mars_http_requests_in_flight_limit`, `mars_process_cpu_seconds_total`,
`mars_stage_duration_seconds`, `mars_stage_info` (a stage's pipeline position, `order`) and
`mars_signal`, plus `mars_client_rtt_seconds` with an `rtt_header`. `route` is always the route
template (mount prefixes included), or `<unmatched>`; `region` is a code from the table, or
`unknown`.

## Prometheus

The recording rules MARS reads ship inside the package. Load them into your Prometheus, or use
the compose stack in [deploy/](../deploy/README.md), which mounts them directly:

```bash
mars-probe rules > mars.rules.yml                       # the mars:* recording rules (ADR-0003)
mars-probe scrape-config --target myhost:8000           # a file_sd target snippet
```

Scrape every 1 s with `honor_labels: true`, evaluate rules every 1 s, and run Prometheus with
`--enable-feature=exemplar-storage` for exemplars. See
[deploy/prometheus/prometheus.yml](../deploy/prometheus/prometheus.yml).

## Develop

```bash
cd probe
uv sync --extra dev
uv run pytest -q                  # -m "not slow" skips the overhead benchmark
uv run ruff check . && uv run ruff format --check .
uv run mars-probe version
bash scripts/test-rules.sh        # promtool tests for the rules (local promtool, docker or podman)
```

`uv run pytest` also runs the rule tests when `promtool` is on `PATH`, and skips them otherwise.
