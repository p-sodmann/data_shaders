# Step 03: Docker stack and recording rules

Status: todo
Depends on: 02
Read first: [ADR-0002](../adr/0002-prometheus-backend.md), [ADR-0003](../adr/0003-metric-contract.md), [ADR-0004](../adr/0004-docker-compose.md)

## Context

Running MARS should be one command. The recording rules are the contract MARS reads (ADR-0003)
and must be tested.

## Goal

`docker compose -f deploy/compose.yaml --profile demo up` starts Prometheus, two demo stations,
the loadgen and the MARS web container. The `mars:*` recording rules are live and tested.

## Tasks

1. **Recording rules** in `probe/src/mars_probe/prometheus/mars.rules.yml`, the only copy.
   Implement every rule in ADR-0003. Pay attention to:
   - `mars:error_ratio` is `0`, not absent, when there is traffic but no 5xx. Use the
     `or (… * 0)` pattern.
   - `mars:node_up` survives the target going down, through
     `last_over_time(mars_info[1h])`.
   - `mars:saturation_ratio` ignores the in-flight term when the limit is 0.
2. **promtool unit tests** in `probe/tests/prometheus/mars.rules.test.yml` covering: normal
   traffic, zero errors, all errors, a target going down (node_up 0), no traffic, the
   per-route, per-stage and per-region rules, and saturation with and without a limit. A pytest
   wrapper runs `promtool test rules` when `promtool` is on PATH and otherwise skips. Also add a
   `make`-free script `probe/scripts/test-rules.sh` that runs promtool in the
   `prom/prometheus` image.
3. Ship the rules in the wheel (hatch include). Add a CLI command `mars-probe rules` that prints
   the file, and `mars-probe scrape-config --target host:8000` that prints a file_sd snippet.
4. **`deploy/prometheus/prometheus.yml`:** global `scrape_interval: 1s`,
   `evaluation_interval: 1s`, and a job `mars` with `file_sd_configs` on
   `/etc/prometheus/targets/*.yml` and `honor_labels: true`. Rule files are mounted from the
   probe path. `deploy/prometheus/targets/demo.yml` lists the demo targets.
5. **`web/Dockerfile`:** a `node:22-alpine` build stage (`npm ci && npm run build`), then
   `caddy:2-alpine`. **`web/Caddyfile`:** serve `/srv`, `handle_path /prom/*` →
   `reverse_proxy {$PROMETHEUS_URL:prometheus:9090}`, and serve `/config/*` from
   `/config` (a volume, may be empty). SPA fallback to `index.html`. Long cache for
   `/assets/*`, no cache for `index.html` and `/config/*`.
6. **`deploy/compose.yaml`** as in ADR-0004. Pin the Prometheus image version. Prometheus
   flags: `--enable-feature=exemplar-storage --storage.tsdb.retention.time=35d
   --web.enable-lifecycle`. Add healthchecks for Prometheus and MARS. The demo services and
   loadgen are in profile `demo`, with `LOADGEN_DAY_SECONDS=600` so a demo has visible daily
   swings.
7. Docs: `deploy/README.md` covers the demo, adding your own server (install the probe, add
   `targets/<name>.yml`, make sure Prometheus can reach the server), and ports. Update the root
   README quick start.

## Acceptance criteria

- [ ] The promtool tests pass.
- [ ] `docker compose -f deploy/compose.yaml --profile demo up -d --build` brings everything up
      healthy within 60 s.
- [ ] Within 60 s, `curl localhost:8080/prom/api/v1/query --data-urlencode
      'query={__name__=~"mars:.+"}'` returns every station-level rule for both `api` and
      `search`, plus the endpoint and stage series.
- [ ] `query_exemplars` for `mars_http_request_duration_seconds_bucket` returns exemplars.
- [ ] `docker compose stop demo-search` → `mars:node_up{station="search"}` becomes 0 (not
      absent) within 10 s.
- [ ] `localhost:8080` serves MARS (still the simulator), and `/config/` gives 404 or a listing
      without breaking anything.

## Verification

```bash
bash probe/scripts/test-rules.sh
docker compose -f deploy/compose.yaml --profile demo up -d --build
sleep 45
curl -s localhost:8080/prom/api/v1/query --data-urlencode 'query=count by (__name__)({__name__=~"mars:.+"})' | python3 -m json.tool
```

## Out of scope

Changes to the MARS app (it still uses the simulator), auth, TLS.
