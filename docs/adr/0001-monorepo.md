# ADR-0001: Monorepo layout and tooling

Status: accepted · 2026-11-05

## Context

MARS grows from one Vite app into three parts that change together: the display, a Python
instrumentation package, and a deployment stack. The metric contract
([ADR-0003](0003-metric-contract.md)) spans all three.

## Decision

One git repository:

| Path | Contents | Tooling |
|---|---|---|
| `web/` | MARS display | Node 22, npm, Vite |
| `probe/` | `mars-probe` Python package, import name `mars_probe` | uv, hatchling, ruff, pytest, Python ≥ 3.11 |
| `examples/demo/` | demo FastAPI service and load generator | uv, and depends on `../../probe` as a path dependency |
| `deploy/` | `compose.yaml`, Prometheus config, Caddyfile | Docker Compose v2 |
| `docs/` | steps, ADRs, open questions | – |

Each part has its own README. The root README explains the whole system and the one-command
start (`docker compose -f deploy/compose.yaml up`).

## Consequences

- A change to a metric or rule can update the probe, the rules and the web source in one commit.
- No JS workspace tooling is needed (there is only one JS package). Python packages are linked
  by path, not published, until step 12.
