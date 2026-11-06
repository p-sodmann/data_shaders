# ADR-0002: Prometheus is the data backend

Status: accepted · 2026-11-05

## Context

MARS needs per-second live values, a few hours of history at boot (the tape, the Signal page),
and series it can discover. We don't want to write collectors or storage.

## Decision

- Servers are instrumented with `mars-probe`, which exposes `/metrics` and builds on the
  official `prometheus_client`.
- **Prometheus** scrapes these targets every **1 s** and evaluates the MARS recording rules
  every 1 s ([ADR-0003](0003-metric-contract.md)).
- The browser queries Prometheus's HTTP API directly, through a same-origin reverse proxy at
  `/prom` served by the same Caddy that serves the web app. There is no custom backend server.
  - Live values: `GET /prom/api/v1/query?query={__name__=~"mars:.+"}` once per second.
  - Backfill: `GET /prom/api/v1/query_range` with `step=1s` over the tape span (4 h).
  - Discovery: `GET /prom/api/v1/label/<name>/values?match[]=...`.
  - Sampled requests: `GET /prom/api/v1/query_exemplars`.
- The built-in simulator stays as a station source kind (`sim`), for development and demos
  without Prometheus.
- Retention: 35 days (`--storage.tsdb.retention.time=35d`). This covers the 30-day almanac.

## Consequences

- MARS can also work with any Prometheus-compatible API (VictoriaMetrics, Mimir, Grafana
  Cloud), as long as the recording rules are loaded there.
- 1 s scrapes cost some storage. This is fine for a handful of servers (see open questions).
- Prometheus has no access control. The proxy must not be exposed to untrusted networks
  without auth (see open questions).
- The almanac (page 5) could be computed from Prometheus history instead of browser
  IndexedDB. That is deliberately left for later. IndexedDB stays for now.
