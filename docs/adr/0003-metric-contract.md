# ADR-0003: Metric and recording-rule contract

Status: accepted · 2026-11-05 · amended 2026-11-07 (`mars_stage_info`, built in step 09; `mars:error_ratio:rate1m`, built in step 08b)

This is the interface between `mars-probe` (step 01), the Prometheus rules (step 03) and the
MARS Prometheus source (step 07). Change it only by editing this ADR in the same commit.

## Identity

- **station**: one monitored service, for example `api` or `search`. It is set by the probe
  (`instrument(app, station="api")`) as a label on **every** `mars_*` series. Pattern
  `^[a-z][a-z0-9-]{0,31}$`.
- **node**: one process of a station. This is Prometheus's `instance` label. A plain uvicorn
  server is one node.

## Raw metrics (exposed by the probe)

| Name | Type | Labels | Meaning |
|---|---|---|---|
| `mars_info` | gauge (=1) | `station`, `version` | Identity and liveness. Used to join `up` to a station. |
| `mars_http_request_duration_seconds` | histogram | `station`, `route`, `method`, `code_class`, `region` | One observation per HTTP request. |
| `mars_http_requests_in_flight` | gauge | `station` | Requests currently being handled. |
| `mars_http_requests_in_flight_limit` | gauge | `station` | `max_inflight` from the probe config. 0 means unset. |
| `mars_process_cpu_seconds_total` | counter | `station` | `time.process_time()` of the process. |
| `mars_stage_duration_seconds` | histogram | `station`, `stage` | Time spent inside `with stage("name")`. |
| `mars_stage_info` | gauge (=1) | `station`, `stage`, `order` | Pipeline position of a stage, from `instrument(app, stages=[…])`, else the order in which the process first saw each stage. *(Step 09.)* |
| `mars_client_rtt_seconds` | histogram | `station`, `region` | Optional (step 11). Client RTT taken from a trusted proxy header. |
| `mars_signal` | gauge | `station`, `signal` | Optional custom signals (`probe.gauge("queue_depth")`). |

Label rules:
- `route` is the **route template** (`/items/{item_id}`), never the raw path. Unmatched
  requests get `route="<unmatched>"`.
- `code_class` is one of `2xx`, `3xx`, `4xx`, `5xx`. An unhandled exception counts as `5xx`.
  **Only `5xx` counts as an error.**
- `region` is a region code such as `FRA`, or `unknown` (until step 11 it is always `unknown`).
- `method` is upper case.

Latency buckets (seconds):
`0.001, 0.0025, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.025, 0.03, 0.04, 0.05, 0.075, 0.1, 0.15, 0.25, 0.5, 1, 2.5, 5, 10`.
Stage buckets: the same.

Exemplars: on `mars_http_request_duration_seconds`, about 1 request per second per node,
with exemplar labels `{status: "<http status>"}` (route and node come from the series labels).
They are exposed in OpenMetrics format, and Prometheus runs with `--enable-feature=exemplar-storage`.

## Recording rules (evaluated by Prometheus, read by MARS)

One rule group `mars`, `interval: 1s`. Rate windows are `[10s]`. MARS applies its own
smoothing on top. Units are already the ones MARS displays.

| Rule | Labels | Definition (sketch; the shipped file is the real one) |
|---|---|---|
| `mars:latency_p50_ms` | station | `histogram_quantile(0.5, sum by (station, le) (rate(mars_http_request_duration_seconds_bucket[10s]))) * 1000` |
| `mars:throughput_rps` | station | `sum by (station) (rate(mars_http_request_duration_seconds_count[10s]))` |
| `mars:error_ratio` | station | 5xx rate ÷ total rate. `0` when there is traffic but no errors, absent when there is no traffic. |
| `mars:error_ratio:rate1m` | station | as `error_ratio` over `[1m]`. The almanac reads it, so backfilled minutes are weighted by throughput. *(Step 08b.)* |
| `mars:saturation_ratio` | station | max of (in_flight ÷ limit, where limit > 0) and max node CPU load, clamped to 0..1 |
| `mars:node_up` | station, instance | `max by (station, instance) (up * on (job, instance) group_left (station) last_over_time(mars_info[1h]))` |
| `mars:node_load_ratio` | station, instance | `clamp_max(rate(mars_process_cpu_seconds_total[10s]), 1)` |
| `mars:node_latency_p50_ms` | station, instance | as latency_p50, grouped by instance as well |
| `mars:endpoint_rps` | station, route | per-route throughput |
| `mars:endpoint_p95_ms` | station, route | per-route P95 |
| `mars:endpoint_error_ratio` | station, route | per-route 5xx ratio |
| `mars:stage_mean_ms` | station, stage | `rate(sum) ÷ rate(count) * 1000` |
| `mars:region_rps` | station, region | per-region throughput (excluding `unknown`) |
| `mars:region_error_ratio` | station, region | per-region 5xx ratio |
| `mars:region_rtt_ms` | station, region | mean of `mars_client_rtt_seconds` (step 11) |

The rules file lives in **one place**:
`probe/src/mars_probe/prometheus/mars.rules.yml`. It is shipped inside the package, printed
by `mars-probe rules`, and mounted directly by `deploy/compose.yaml`. It is covered by
`promtool test rules` unit tests (`probe/tests/prometheus/`).

## Mapping to the MARS frame

| Frame field | Source |
|---|---|
| `latency`, `throughput`, `errorRate`, `saturation` | the station-level rules |
| `hosts[i].load / state / latency` | `node_load_ratio`, `node_up` (0 means offline), `node_latency_p50_ms`. Warn and crit come from MARS thresholds on load. |
| `stages` | `stage_mean_ms`, ordered by `mars_stage_info` (from step 09), then the station's `stages` override, then by name |
| `endpoints` | `endpoint_*` by route |
| `regions` | `region_*` by region |
| `requests` | exemplars |
