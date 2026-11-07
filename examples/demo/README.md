# MARS demo service and load generator

A FastAPI app that pretends to be an ML API, instrumented with [mars-probe](../../probe/README.md),
and a load generator that drives it with realistic traffic. Together they produce real metrics for
MARS without any real servers. One app runs as several stations: the station name comes from
`MARS_STATION`.

## Run locally (no Docker)

```bash
cd examples/demo
uv sync
MARS_STATION=api    uv run uvicorn demo.app:app --port 8001 &
MARS_STATION=search uv run uvicorn demo.app:app --port 8002 &
LOADGEN_TARGETS=http://localhost:8001,http://localhost:8002 uv run python -m demo.loadgen
```

Each station serves `/metrics` (`curl localhost:8001/metrics`). The loadgen prints per-target
status counts every 10 s, plus every batch job and incident it fires.

## The app

| Route | Stages |
|---|---|
| `POST /v1/predict` | ingress, auth, embed, infer, egress |
| `POST /v1/embed` | ingress, auth, embed (×2.2), egress |
| `POST /v1/rank` | ingress, auth, embed, rank (×2), egress |
| `GET /v1/models` | ingress, egress |
| `GET /v1/items/{item_id}` | ingress, auth, egress. Ids ≥ 9000 return 404. |
| `GET /healthz` | none. Not timed. |

The handlers sleep through their stages with log-normal latencies (`/v1/predict` has a P50 of
about 18 ms) and burn a little CPU in `infer`, so the node load moves with traffic. The app
trusts two request headers, standing in for a proxy at the edge:
`RegionConfig(header="X-Demo-Region", rtt_header="X-Demo-RTT", country_headers=())`. So
`X-Demo-Region: NRT` puts the request in region `NRT` (a code outside the probe's table counts
as `unknown`), and `X-Demo-RTT` (µs) feeds `mars_client_rtt_seconds`. `X-Demo-Region` comes
back unchanged on the response.

| Variable | Default | |
|---|---|---|
| `MARS_STATION` | `api` | station label, `^[a-z][a-z0-9-]{0,31}$` |
| `DEMO_LATENCY_SCALE` | `1` | multiplies every stage median, so stations can differ |
| `DEMO_CPU_MS` | `0.4` | busy CPU per `infer` stage, in ms |
| `DEMO_MAX_INFLIGHT` | `64` | `max_inflight` for the saturation rule |

## Chaos API

`/_chaos` injects one incident at a time. It isn't timed, and neither is `/healthz`. While an
incident is active, `mars_signal{signal="chaos_active"}` is 1.

```bash
# slow down the infer stage by 40 ms and fail 5 % of the requests that pass through it, for 2 min
curl -X POST localhost:8001/_chaos -H 'content-type: application/json' \
     -d '{"latency_ms": 40, "error_rate": 0.05, "stage": "infer", "duration_s": 120}'
curl localhost:8001/_chaos             # current incident and remaining_s, or {"active": false}
curl -X DELETE localhost:8001/_chaos   # end it now
```

| Field | Default | |
|---|---|---|
| `latency_ms` | `0` | extra latency, 0–10000 |
| `error_rate` | `0` | fraction of requests that return 500, 0–1 |
| `stage` | none | one of `ingress auth embed infer rank egress` |
| `duration_s` | `120` | the incident ends by itself after this |

With a `stage`, the latency is spent inside that stage and the errors are raised from it, so only
routes that pass through it are affected and the stage breakdown shows the cause. Without a
stage, the latency is added to the whole request outside any stage, and the errors hit every
route. A new `POST` replaces the current incident.

## Load generator

Arrivals are open loop (Poisson), so an injected slowdown raises latency and in-flight requests
instead of lowering throughput. Durations take seconds or a `30s` / `10m` / `2h` suffix.

| Variable | Default | |
|---|---|---|
| `LOADGEN_TARGETS` | `http://localhost:8000` | comma-separated base URLs |
| `LOADGEN_RPS` | `40` | base requests per second per target |
| `LOADGEN_DAY_SECONDS` | `24h` | period of the daily sine (×0.4 to ×1.6, low at 03:00 and high at 15:00 UTC). `600` gives a 10-minute day. |
| `LOADGEN_BATCH_EVERY` | `5m` | a batch job of `/v1/rank` on the wall-clock mark. `0` turns it off. |
| `LOADGEN_BATCH_SIZE` | `300` | requests per target per batch, spread over 10 s |
| `LOADGEN_INCIDENT_EVERY` | `45m` | mean time between random incidents on a random target. `0` turns them off. |
| `LOADGEN_HOME` | `50.1,8.7` | `lat,lon` of the stations, for the client RTT. The default is the display's default station `home` (Frankfurt); set both together. |
| `LOADGEN_DEGRADE_EVERY` | `15m` | mean time between degraded routes. `0` turns them off. |
| `LOADGEN_SEED` | random | makes the traffic and the incidents reproducible |

The route mix (predict 50 %, embed 20 %, rank 12 %, items 10 %, models 8 %) and the region
shares follow the simulator in `web/src/config.js`. Like the simulator, each region's share is
scaled by its local daylight over the (possibly compressed) day, so the centre of traffic on
the display's ground track drifts west.

Each request carries `X-Demo-Region` and `X-Demo-RTT`: 3 ms plus 1 ms per 95 km between the
region and `LOADGEN_HOME` (the simulator's model; about 10 ms from London, 70 ms from Virginia,
175 ms from Sydney), with 8 % log-normal jitter. Now and then one region's route degrades to
×1.6 or ×2.5 of its RTT for 2–7 minutes, which the display shows as `ROUTE … DEGRADED` or
`LOST`. The loadgen prints each one.

## Docker

The probe is a path dependency, so build from the **repo root**:

```bash
docker build -f examples/demo/Dockerfile -t mars-demo .
docker run --rm -p 8001:8000 -e MARS_STATION=api mars-demo                  # a station
docker run --rm -e LOADGEN_TARGETS=http://host.docker.internal:8001 \
       mars-demo python -m demo.loadgen                                     # the loadgen
```

Podman works the same way (`podman build -f examples/demo/Dockerfile -t mars-demo .`).
[deploy/compose.yaml](../../deploy/compose.yaml) (profile `demo`) runs both stations and the
loadgen. Released images for amd64 and arm64: `ghcr.io/p-sodmann/mars-demo:<version>`
(`scripts/build-images.sh`).

## Develop

```bash
uv sync
uv run pytest -q
uv run ruff check . && uv run ruff format --check .
```
