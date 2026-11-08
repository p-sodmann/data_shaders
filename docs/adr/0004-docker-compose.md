# ADR-0004: Docker Compose is the way to run MARS

Status: accepted · 2026-11-05

## Decision

`deploy/compose.yaml` runs the whole system with one command:

| Service | Image | Port | Notes |
|---|---|---|---|
| `mars` | built from `web/Dockerfile`: a `node:26.13.0-alpine` build stage, then `caddy:2-alpine` | 8080 | Serves `dist/`, proxies `/prom/*` to Prometheus, serves `/config/mars.json` from a mounted volume |
| `prometheus` | `prom/prometheus` (pinned) | 9090 (optional) | 1 s scrape and rule interval, exemplar storage, 35 d retention, named data volume |
| `demo-api`, `demo-search` | built from `examples/demo/Dockerfile` | – | compose profile `demo` |
| `loadgen` | same image, different command | – | compose profile `demo` |

- Scrape targets come from **file service discovery**: `deploy/prometheus/targets/*.yml`.
  Adding one of your own servers means dropping in a file with
  `targets: ["host:8000"]`. No Prometheus restart is needed.
- `docker compose -f deploy/compose.yaml --profile demo up` starts the full demo.
  Without `--profile demo`, only MARS and Prometheus start, for your own servers.

## Consequences

- MARS itself is static files. The container just bundles Caddy so the Prometheus proxy is
  same-origin, which means no CORS setup.
- *Step 12:* `deploy/compose.prod.yaml` runs the released images for your own servers, with
  targets in `deploy/site/targets/` and Prometheus unpublished; `/healthz` and
  `MARS_BASIC_AUTH` were added to the image ([ADR-0008](0008-release-and-exposure.md)).
- `npm run dev` stays the inner loop. Vite's dev server proxies `/prom` to `localhost:9090`.
