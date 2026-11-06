# deploy: run MARS with Docker Compose

One compose file runs the whole system ([ADR-0004](../docs/adr/0004-docker-compose.md)):

| Service | What | Port |
|---|---|---|
| `mars` | the display, built from [web/Dockerfile](../web/Dockerfile); Caddy serves it and proxies `/prom/*` to Prometheus | `8080` |
| `prometheus` | `prom/prometheus:v3.16.0`, 1 s scrape and rules, exemplars, 35 d retention | `127.0.0.1:9090` |
| `demo-api`, `demo-search` | the [demo service](../examples/demo/README.md) as two stations (profile `demo`) | – |
| `loadgen` | traffic for both, with a 10-minute "day" (profile `demo`) | – |

Commands below run from the repo root. Podman works too if `podman compose` has a compose
provider installed (see Troubleshooting).

## Demo

```bash
docker compose -f deploy/compose.yaml --profile demo up -d --build
```

Open <http://localhost:8080>. After about 15 s the recording rules have data:

```bash
curl -s localhost:8080/prom/api/v1/query --data-urlencode 'query=mars:throughput_rps'
```

The display still runs on its simulator until the Prometheus source lands (step 07); until then
use Prometheus's own UI on <http://localhost:9090> to look at the `mars:*` series.

Things to try:

```bash
docker compose -f deploy/compose.yaml stop demo-search     # mars:node_up{station="search"} → 0
docker compose -f deploy/compose.yaml start demo-search
docker compose -f deploy/compose.yaml exec demo-api python -c "import urllib.request as u; \
  u.urlopen(u.Request('http://localhost:8000/_chaos', b'{\"error_rate\": 0.2}', \
  {'Content-Type': 'application/json'}))"                   # 20 % 5xx on api for 2 minutes
docker compose -f deploy/compose.yaml --profile demo down      # add -v to drop the data too
```

## Monitor your own server

1. Instrument the app with [mars-probe](../probe/README.md) (`instrument(app, station="shop")`)
   and run it as a single uvicorn process. It serves `/metrics`.
2. Add a target file. Prometheus watches the folder, so no restart is needed:

   ```bash
   mars-probe scrape-config --target shop.lan:8000 > deploy/prometheus/targets/shop.yml
   ```

   A file can list several nodes of one station. One file per server keeps it tidy.
3. Make sure the Prometheus container can reach `shop.lan:8000` (DNS, firewall). A server on the
   Docker host itself is `host.docker.internal:8000` (on Linux, add
   `extra_hosts: ["host.docker.internal:host-gateway"]` to the `prometheus` service).
4. Start without the demo: `docker compose -f deploy/compose.yaml up -d --build`, and delete
   [prometheus/targets/demo.yml](prometheus/targets/demo.yml), whose targets are otherwise just
   down.

Check <http://localhost:9090/targets>: the target should be `UP`, and
`mars:node_up{station="shop"}` should be 1.

## Files

- [compose.yaml](compose.yaml): the services above.
- [prometheus/prometheus.yml](prometheus/prometheus.yml): 1 s intervals, job `mars` with
  `honor_labels: true` and file service discovery on `targets/*.yml`.
- [prometheus/targets/](prometheus/targets/): one file_sd file per server.
- The recording rules are **not** in this folder: compose mounts
  [probe/src/mars_probe/prometheus/](../probe/src/mars_probe/prometheus/mars.rules.yml), the
  only copy ([ADR-0003](../docs/adr/0003-metric-contract.md)). After editing them, reload
  without a restart: `curl -X POST localhost:9090/-/reload`.
- [config/](config/): mounted at `/config` in the `mars` container and served at
  `localhost:8080/config/` without caching. Empty for now; the config document arrives in
  step 06. `/config/` itself answers 404 (no listing).

## Ports and exposure

- `8080` (MARS) is published on all interfaces, so a display on the LAN can open it.
- `9090` (Prometheus) is published on loopback only, for `npm run dev` in `web/`.
- **Neither has authentication**, and `/prom/*` on port 8080 is the Prometheus API (read-only
  apart from the lifecycle endpoints, which Caddy refuses with 403 there; they work on
  `localhost:9090`). Keep the stack on a trusted network. Auth and TLS are open questions ([open-questions.md](../docs/open-questions.md)).

## Troubleshooting

- **Podman.** `podman compose` needs a provider (`docker-compose` or `podman-compose`) on the
  `PATH`. The images and containers themselves work under Podman (checked in step 03).
- **No `mars:*` series.** Look at <http://localhost:9090/targets> and
  <http://localhost:9090/rules>. Latency and ratio rules are absent while a station gets no
  requests; throughput reads 0.
- **Rule tests:** `bash probe/scripts/test-rules.sh`.
