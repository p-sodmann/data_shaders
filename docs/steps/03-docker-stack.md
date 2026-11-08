# Step 03: Docker stack and recording rules

Status: done
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
5. **`web/Dockerfile`:** a `node:26.13.0-alpine` build stage (`npm ci && npm run build`), then
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

- [x] The promtool tests pass.
- [x] `docker compose -f deploy/compose.yaml --profile demo up -d --build` brings everything up
      healthy within 60 s.
- [x] Within 60 s, `curl localhost:8080/prom/api/v1/query --data-urlencode
      'query={__name__=~"mars:.+"}'` returns every station-level rule for both `api` and
      `search`, plus the endpoint and stage series.
- [x] `query_exemplars` for `mars_http_request_duration_seconds_bucket` returns exemplars.
- [x] `docker compose stop demo-search` → `mars:node_up{station="search"}` becomes 0 (not
      absent) within 10 s.
- [x] `localhost:8080` serves MARS (still the simulator), and `/config/` gives 404 or a listing
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

## Handoff

**Status was `partial` until 2026-11-06.** When this step was built, the machine had no compose
provider (Podman only), so criteria 3–6 were checked by starting the same images with plain
`podman run`. On 2026-11-06 criterion 2 was closed with `podman-compose` 1.x
(`uv tool install podman-compose`):
`podman-compose -f deploy/compose.yaml --profile demo up -d` brought all five containers up, and
the four with healthchecks were healthy within ~16 s. Both targets were up, each station had 28
`mars:` series, and `:8080` returned 200. Two caveats: `--build` under podman-compose builds the
shared `mars-demo:local` image three times in parallel, so the image was built once with
`podman build` first. And the Podman VM's DNS had broken (uv downloads failed with "dns error"),
which a `podman machine stop/start` fixed. Real Docker Compose with BuildKit still hasn't been
run.

**Built**

- [mars.rules.yml](../../probe/src/mars_probe/prometheus/mars.rules.yml): group `mars`,
  `interval: 1s`, all 14 ADR-0003 rules. The only copy.
- [mars.rules.test.yml](../../probe/tests/prometheus/mars.rules.test.yml): promtool tests for
  normal traffic, zero errors (incl. 4xx not counting), all errors, no traffic, a node going down
  (incl. a version change on a live node), per-route, per-stage, per-region, and saturation with
  a limit, without one and clamped. Wrapper [test_rules.py](../../probe/tests/prometheus/test_rules.py)
  (skips without promtool), script [test-rules.sh](../../probe/scripts/test-rules.sh) (local
  promtool, else docker, else podman; `CONTAINER_ENGINE` overrides).
- [cli.py](../../probe/src/mars_probe/cli.py): `mars-probe rules`, `mars-probe scrape-config
  --target host:port` (repeatable). [test_cli.py](../../probe/tests/test_cli.py) also checks that
  the rules file defines exactly the ADR's rule names.
- [deploy/compose.yaml](../../deploy/compose.yaml),
  [prometheus.yml](../../deploy/prometheus/prometheus.yml),
  [targets/demo.yml](../../deploy/prometheus/targets/demo.yml), [deploy/config/](../../deploy/config/)
  (empty, `.gitkeep`), [deploy/README.md](../../deploy/README.md).
- [web/Dockerfile](../../web/Dockerfile), [web/Caddyfile](../../web/Caddyfile),
  [web/.dockerignore](../../web/.dockerignore).
- README updates: root (quick start), [probe/README.md](../../probe/README.md) (Prometheus
  section, rule tests), [web/README.md](../../web/README.md) (production image).

**Deviations and decisions**

- **`mars:node_up` is joined the other way round from the ADR sketch:**
  `max by (station, instance) (last_over_time(mars_info[1h]) * on (job, instance) group_left up)`.
  With `up` as the many side, a node that restarts with a new `version` has two `mars_info`
  series for an hour and the `group_left` fails ("many-to-many"), dropping every node. Tested.
  The ADR calls its column a sketch, so the ADR is unchanged.
- **Latency rules (`latency_p50_ms`, `node_latency_p50_ms`, `endpoint_p95_ms`) and
  `stage_mean_ms` are absent while there is no traffic,** like `error_ratio`, instead of NaN.
  Throughput rules (`throughput_rps`, `endpoint_rps`, `region_rps`) read 0.
- **`mars:saturation_ratio` is per node, then max:** `max(in_flight / limit)` over nodes and
  `max(cpu rate)` over nodes; the busiest node decides.
- **`region_error_ratio` and `region_rtt_ms` also exclude `region="unknown"`** (the ADR only says
  so for `region_rps`), so the three region rules cover the same regions. Until step 11 all
  region rules are empty.
- **`<unmatched>` is kept as a route** in the endpoint rules.
- **Image pins:** `prom/prometheus:v3.16.0` (latest at the time). It is written in two places,
  `deploy/compose.yaml` and `probe/scripts/test-rules.sh`; both carry a comment. Caddy is
  `caddy:2-alpine` and Node `node:26.13.0-alpine` pinned to the same release used by CI and `.nvmrc`.
- **Extras in scope of the files the step creates:** `scrape_timeout: 1s` (must not exceed the
  interval), `refresh_interval: 10s` on file_sd (fsnotify doesn't always fire on bind mounts),
  Prometheus published on `127.0.0.1:9090` only, `restart: unless-stopped`, Caddy `admin off` and
  `auto_https off`, and **Caddy answers 403 for `/prom/-/reload` and `/prom/-/quit`** so the
  lifecycle API the step asks for isn't reachable from the LAN through port 8080.
- `demo-search` runs with `DEMO_LATENCY_SCALE=1.6` so the stations differ (P50 ~17 vs ~25 ms).
- The `/config` mount is a bind mount of `deploy/config/` (not a named volume), so dropping a
  `mars.json` there is the whole workflow for step 06.
- A missing `/assets/*` file is a real 404 (no SPA fallback, no immutable header); only existing
  assets get the year-long cache.
- The demo image is built by each of the three demo services (same `build` + `image:
  mars-demo:local`), so any of them can start alone; the build cache makes the repeats free.
- No new Python or npm dependencies.

**Verification**

```
$ bash probe/scripts/test-rules.sh                 # via podman, prom/prometheus:v3.16.0
Processing test file: tests/prometheus/mars.rules.test.yml
  SUCCESS
# mutation check: removing the `or (… * 0)`, the last_over_time, or the `> 0` on the limit each
# makes the suite fail (error_ratio / node_up at 25s / saturation sat-nolimit = 1).

$ promtool check config deploy/prometheus/prometheus.yml   → SUCCESS (valid)
$ promtool check rules mars.rules.yml                      → SUCCESS: 14 rules found
$ caddy validate --config web/Caddyfile                    → Valid configuration

$ cd probe && uv run pytest -q && uv run ruff check . && uv run ruff format --check .
26 passed, 1 skipped (promtool not on PATH) · All checks passed! · 19 files already formatted
$ uv build --wheel → wheel contains mars_probe/prometheus/mars.rules.yml;
  installed into a fresh venv, `mars-probe rules | wc -l` → 141
$ cd examples/demo && uv run pytest -q   → 14 passed; ruff clean
$ cd web && npm run build && npm run smoke  → built · smoke: ok

# stack via podman run (same images/mounts/flags/healthchecks as compose.yaml)
all four healthchecked containers (healthy) after 6 s
t=46s: count by (__name__)({__name__=~"mars:.+"}) through localhost:8080/prom
  endpoint_error_ratio 10, endpoint_p95_ms 10, endpoint_rps 10, error_ratio 2,
  latency_p50_ms 2, node_latency_p50_ms 2, node_load_ratio 2, node_up 2,
  saturation_ratio 2, stage_mean_ms 12, throughput_rps 2      (region_* empty: region=unknown)
  api: 56 rps, p50 17.3 ms, error 0, load 0.077 · search: 60 rps, p50 25.4 ms, load 0.078
query_exemplars mars_http_request_duration_seconds_bucket (last 30 s) → 21 series, 58 exemplars,
  e.g. {status: "200"} 0.0033 on /v1/models le=0.005
stop demo-search → mars:node_up{station="search"} 0 on the first poll after the stop returned
  (stop itself ~2 s); still 0 after 15 s; 1 again ~6 s after start. Loadgen recovers by itself.
Prometheus log: 0 error/warn lines.
localhost:8080 /, /some/spa/path → 200 index.html, no-cache · /assets/<hash>.js → 200 immutable
  /assets/nope.js → 404 · /config/ → 404 · /config/x.json (temp file) → 200 no-cache
  /prom/-/ready → 200 · POST /prom/-/quit, /prom/-/reload → 403
Playwright on localhost:8080: no console errors, simulator renders (page 1)
```

Screenshot: `/private/tmp/claude-501/-Users-philippsodmann-Documents-python-2026-data-shaders/9a1e40e2-22b6-4cf9-8192-a8f6fe3b6d0e/scratchpad/mars-container.png`
(scratch, not committed).

**Not verified / needs a person**

- **`docker compose -f deploy/compose.yaml config` and `… --profile demo up -d --build`** (no
  compose provider here). In particular: YAML anchors/merge keys, `depends_on` with
  `service_healthy`, profiles, and the relative bind mounts as compose resolves them.
- `docker build` with BuildKit for `web/` (built with `podman build` only).
- The pytest wrapper actually running promtool (no native promtool; the same test file passes
  through the script).
- Running without `--profile demo` (MARS + Prometheus only), and adding a real external target.

**Notes for later steps**

- Step 07: `{__name__=~"mars:.+"}` returns ~56 series for the demo. Latency/ratio rules can be
  absent for a station with no traffic; treat absent as "no reading", not as 0. `mars:node_up`
  keeps a dead node at 0 for an hour after its last `mars_info`, and drops it when the target
  leaves file_sd.
- Step 06: `deploy/config/` is served at `/config/` with `Cache-Control: no-cache`; there is no
  listing, so the app must know the file name (`/config/mars.json`).
- Step 11: region rules start producing data as soon as `region != "unknown"`; the `region_rtt_ms`
  rule is already in place for `mars_client_rtt_seconds`.
- If the Prometheus image is bumped, change it in `deploy/compose.yaml` and
  `probe/scripts/test-rules.sh`.
