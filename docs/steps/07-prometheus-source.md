# Step 07: Prometheus source

Status: todo
Depends on: 03, 06
Read first: [ADR-0002](../adr/0002-prometheus-backend.md), [ADR-0003](../adr/0003-metric-contract.md) (binding), [ADR-0005](../adr/0005-config-document.md)

## Context

Both tracks join here. The demo stack (step 03) produces `mars:*` series, and MARS (step 06) has
stations with pluggable sources. This step adds the source kind
`{ kind: 'prometheus', station: '<label value>' }`.

## Goal

A station bound to a Prometheus `station` label shows live data, starts with a 4-hour tape
already filled, and discovers its nodes, endpoints, stages and regions.

## Design

- **Async startup.** Change the source interface so that `backfill(fromT)` returns a
  `Promise<samples[]>`. The sim source just resolves. `station.start()` becomes async, and the
  housing shows a power-on/"TAPE LOAD" state on that station's screens until the backfill has
  been ingested. One sim station and one slow Prometheus station must not block each other.
- **Discovery (`web/src/data/prometheus/discover.js`),** run before the store is created,
  because the store allocates its arrays per entity:
  - nodes: `/api/v1/series?match[]=mars:node_up{station="X"}` over the last 1 h → a sorted list
    of instances
  - endpoints: label values of `route` for `mars:endpoint_rps{station="X"}`, merged with the
    station's optional `endpoints` override (for SLOs). The default P95 SLO for an unknown route
    is 2 × its observed 4-hour P95, rounded. This is documented, and visible in the contacts
    table.
  - stages: label values of `stage`. The order comes from the station override, or else from
    first appearance in a trace (or alphabetical as a fallback). `stageShare` is learned from
    the 4-hour mean.
  - regions: label values of `region`, joined against a built-in code → `{name, lat, lon}` table
    (move today's `REGIONS` table into `web/src/data/regions.js` and extend it with common
    IATA-style codes). Unknown codes are skipped and logged once.
  - Record the decision about entities that **change at runtime** (open question) in an ADR.
    The suggested approach: rediscover every 5 minutes, and if the sets changed, rebuild the
    station while keeping the tape by re-running the backfill.
- **Live (`source.js`):** once per second, a single
  `query?query={__name__=~"mars:.+",station="X"}`, mapped to the frame per the ADR-0003 table.
  Nodes go through the discovered index. Host state is `offline` if `node_up == 0`, otherwise
  warn or crit from load against `profile.thresh.satWarn` / `satCrit`. Requests come from
  `query_exemplars` every 5 s for the last 5 s.
- **Backfill:** `query_range` with `step=1s` for the station-level series over
  `ROWS*ROW_SECONDS`. Prometheus caps a response at 11,000 points, so split the range into
  chunks. Run the chunks in parallel, at most 4 at a time. Per-node, endpoint and region
  backfill can be coarser or skipped. Say which in the handoff.
- **Gaps and staleness:** if a poll fails or returns no data, push nothing for that second, so
  the tape shows a gap. After 10 s without data, the station is `STALE`: its lamp is dark and the
  C&W rule shows STALE. Recovery is automatic.
- **Time base:** `S` is disabled for Prometheus stations (show `×1 LIVE`).
- **Dev proxy:** Vite already proxies `/prom` (step 00). The doc's `prometheus.url` is the base
  URL.
- **Default doc in Docker:** `deploy/config/mars.json` (mounted at `/config/mars.json`) has the
  two demo stations, with a sensible mixed layout plus the five standard pages for `api`.

## Tasks

1. Async backfill refactor across the source interface, the station and the housing.
2. `data/prometheus/{client,discover,source}.js`, with unit tests that use recorded Prometheus
   JSON fixtures (record them from the step 03 stack into `web/src/data/prometheus/__fixtures__/`).
3. The regions table move and its extension.
4. The ADR for runtime entity changes.
5. The `deploy/config/mars.json` default and its compose volume mount.
6. Update the "Connecting real data" section in `web/README.md`.

## Acceptance criteria

- [ ] With the demo stack up, `localhost:8080` shows both demo stations live. After a reload the
      tape is full for the time the stack has been running (up to 4 h).
- [ ] Pages 1–5 for `api` all show real data. Rhythms finds the 5-minute batch job within about
      20 minutes. Pipeline shows the demo stages. The radar shows the demo routes.
- [ ] `POST /_chaos` on demo-api with `latency_ms: 60, stage: infer` makes the tape ridge, the
      lamp go to DEGRADED or INCIDENT, and the pipeline name INFER as the bottleneck.
- [ ] `docker compose stop demo-search`: within 10 s its node lamp is offline, and the station
      goes STALE. After `start`, it recovers without a reload.
- [ ] Stopping Prometheus doesn't crash the app. Every Prometheus station goes STALE, and the sim
      stations keep running.
- [ ] vitest and smoke pass. The smoke test doesn't need Prometheus (it uses sim configs).

## Out of scope

Edit UI, station discovery UI (step 09), GeoIP (step 11).
