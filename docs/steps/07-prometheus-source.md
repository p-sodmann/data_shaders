# Step 07: Prometheus source

Status: done
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

- [x] With the demo stack up, `localhost:8080` shows both demo stations live. After a reload the
      tape is full for the time the stack has been running (up to 4 h).
      *(The tape matched Prometheus second for second. Prometheus itself had gaps here because the
      VM slept; see handoff.)*
- [x] Pages 1–5 for `api` all show real data. Rhythms finds the 5-minute batch job within about
      20 minutes. Pipeline shows the demo stages. The radar shows the demo routes.
      *(Rhythms closed in step 08b, 2026-11-07: the analyser folds throughput too, and finds
      the job as `5M00S +25% THRU`. Replaying the real data, it is found from 22 min on; see
      [step 08b](08b-followups.md).)*
- [x] `POST /_chaos` on demo-api with `latency_ms: 60, stage: infer` makes the tape ridge, the
      lamp go to DEGRADED or INCIDENT, and the pipeline name INFER as the bottleneck.
- [x] `docker compose stop demo-search`: within 10 s its node lamp is offline, and the station
      goes STALE. After `start`, it recovers without a reload.
      *(Node lamp < 8 s. STALE 10 s after the last sample, ~16 s after `stop`, per the design's
      10 s rule; see handoff.)*
- [x] Stopping Prometheus doesn't crash the app. Every Prometheus station goes STALE, and the sim
      stations keep running.
- [x] vitest and smoke pass. The smoke test doesn't need Prometheus (it uses sim configs).

## Out of scope

Edit UI, station discovery UI (step 09), GeoIP (step 11).

## Handoff

**Status was `partial`** for one criterion until 2026-11-07: Rhythms didn't find the demo's
5-minute batch job, because the analyser folded P50 latency only and the job shows in
throughput. Step 08b added the throughput search and closed it. Still open: the `mars-web`
image couldn't be rebuilt here, because `npm ci` fails inside the Podman VM (see "Not
verified").

**Built**

- [web/src/data/prometheus/client.js](../../web/src/data/prometheus/client.js): the Prometheus
  HTTP API client (`query`, `queryRange`, `series`, `labelValues`, `exemplars`, `alerts`,
  `time`). Each call has a timeout and throws on any failure. Also `chunks()` (ranges under the
  11,000-point cap), `pool()` (at most N tasks in flight) and `sel()` (escaped
  `{station="…"}`).
- [web/src/data/prometheus/discover.js](../../web/src/data/prometheus/discover.js): finds
  nodes (`mars:node_up` series, last 1 h), routes, stages and regions (label values, last 4 h).
  A route's SLO comes from the doc override, else `defaultSlo` = 2 × the observed 4 h P95 from
  the raw histogram, rounded. Stages are ordered by `orderStages`, and their shares come from
  `avg_over_time(mars:stage_mean_ms[4h])`. Regions are joined against
  [web/src/data/regions.js](../../web/src/data/regions.js) (80 IATA-style codes; the old
  profile table now reads from it), and an unknown code is warned about once.
- [web/src/data/prometheus/source.js](../../web/src/data/prometheus/source.js): the live side
  and the backfill.
  - **Live:** one `query {__name__=~"mars:.+",station="X"}` per second, mapped as ADR-0003 says.
    Exemplars every 5 s become `requests`, and `/api/v1/alerts` every 10 s becomes
    `store.setExternal`. A second without a system sample pushes no sample but still updates
    the nodes (`store.pushHosts`), and 10 s without data sets `store.setStale(true)`.
  - **Clock:** time is Prometheus's. `sync()` measures the offset first, and every live answer
    keeps it current.
  - **Backfill:** station-level series at 1 s over the tape span, plus node series for the last
    10 min. All chunks run through one pool of 4. `history()` gives the almanac per-minute
    records at 60 s steps.
- [web/src/station/station.js](../../web/src/station/station.js):
  - `start()` is async: discovery (Prometheus only, retried with NO CONTACT), then clock sync,
    backfill and live.
  - Status `{ phase: 'load'|'live', progress, problem, generation }` with `getStatus()` and
    `subscribe()`. `profile`, `source` and `store` are getters, because a rebuild swaps them.
  - Rebuild on slot overflow (ADR-0007). The almanac is restored from IndexedDB, then filled
    from Prometheus for the missing minutes.
- [web/src/station/manager.js](../../web/src/station/manager.js): runs `prometheus` stations and
  passes `{ prometheus }` (`doc.prometheus.url`, default `/prom`) to them. A Prometheus station
  is also recreated when that URL changes. The snapshot is renewed when a station changes phase
  or generation. `worstStation` ranks by `store.status`
  (NOMINAL < STALE < DEGRADED < INCIDENT).
- [web/src/data/telemetry.js](../../web/src/data/telemetry.js):
  - Spare slots: `caps`, `addNode` / `addEndpoint` / `addStage` / `addRegion`, `overflow`,
    `rebuilds`, and the node stride `hostCap`.
  - Partial updates: `pushHosts`, and samples without node data (`hostStates: null`).
  - Status: `stale` / `setStale`, `external` / `setExternal`, and
    `status` = STALE | at least DEGRADED while an external alert fires | state.
  - Region samples may lack RTT, and endpoint log lines use `routeLabel` (`{id}` → `*`).
- UI:
  - [PageView.jsx](../../web/src/ui/PageView.jsx): a loading station's panels show the CRT
    TAPE LOAD screen (`createTapeLoad` in
    [panels.js](../../web/src/instruments/panels.js)), and instruments rebuild per generation.
  - [App.jsx](../../web/src/App.jsx): the lamp uses `status` and goes dark for STALE
    ([style.css](../../web/src/style.css)). `S` reads `Time ×1 live` without sim stations. `T`
    only targets sim stations, and the node count comes from the store.
  - The System tube shows STALE dim.
  - The C&W panel shows STALE on `SOURCE AGE`, and Prometheus stations also get `EXT ALERTS`
    and `SLOTS USED` (the overflow lamp).
  - Contacts mark auto SLOs `61A`. Radar, pipeline and ground track read their tables every
    frame.
- [web/src/data/signal.js](../../web/src/data/signal.js): the rhythm search and the
  spectrum's 10 min live trace run once 20 min of data exist. Only the 4 h reference waits for
  half the window, and the spectrum says `4H REFERENCE AFTER 2H OF DATA` until then.
- Config: [schema.js](../../web/src/config/schema.js) accepts the station overrides
  `endpoints: [{route, slo}]` and `stages: [...]`.
  [deploy/config/mars.json](../../deploy/config/mars.json) is the Docker default: `api`
  (overrides as an example) and `search` (warn 40 / crit 55), the 5 standard pages for `api`,
  and page 6 "Twin" for both. The compose mount already existed (step 03).
- Docs: [ADR-0007](../adr/0007-runtime-entities.md) (new), ADR-0005 amended,
  [web/README.md](../../web/README.md) "Connecting real data" rewritten (keys too), and
  [README.md](../../README.md) and [deploy/README.md](../../deploy/README.md) updated.
- Tests: [web/test/prometheus.test.js](../../web/test/prometheus.test.js) has 19 tests on the
  fixtures in
  [web/src/data/prometheus/__fixtures__/](../../web/src/data/prometheus/__fixtures__/README.md),
  recorded from the step 03 stack (`alerts-firing.json` is hand-written). The manager tests
  were updated for the async start.

**Deviations and decisions**

- **Entities that change at runtime use spare slots, not a 5-minute rediscovery** (the open
  question resolved on 2026-11-06 overrides the step's suggestion, ADR-0007):
  - The live query already contains new labels, so there is no periodic rediscovery.
  - On overflow the station rebuilds with twice the spare slots, and after 4 rebuilds it stops
    and asks for a reload. That guard exists because the first version looped when the live
    answer had labels discovery couldn't see.
- **Implemented from resolved open questions, beyond the step text:**
  - The almanac is backfilled from Prometheus (60 s steps, up to 30 days, missing minutes only).
  - External Prometheus alerts light the lamp.
  - `S` is disabled on live stations.
- **Stage order:** the metrics carry no order. Exemplars belong to requests, not stages, so
  "first appearance in a trace" can't be read. Without an override, stages are ordered by name
  meaning (ingress/auth … egress), then alphabetically (open question).
- **Backfill coverage:** station-level series at 1 s for the whole tape, node series for the
  last 10 min only (what Fleet and Slices show). Endpoints, stages and regions are not
  backfilled, because their instruments only keep short-term state.
- **"No data" for a second:** no `throughput_rps` (target down or unknown), no
  `latency_p50_ms` (no traffic), or every node `node_up = 0`. The last case catches the
  ~10 s in which the rate rules still yield values from a dead target's last scrapes.
- **Time base is Prometheus's clock.** Not in the step; added after the Podman VM stalled for
  ~45 min and the browser asked for seconds Prometheus didn't have. A skew over 2 s is logged
  (`CLOCK SKEW …`).
- **A Prometheus station's topology is one service (the station).** Prometheus knows nodes,
  not service links, so Orbit shows one solid with its nodes as satellites, and page 4 has one
  load signal named after the station.
- **Rhythms on a short history.** The analyser used to need half of the 4 h window before it
  ran, which a live station only reaches after 2 h. The rhythm search now runs from 20 min of
  data. It finds a 5-minute job reliably from about 35 min of data in the unit test (sometimes
  at 25), so it is slower than the criterion's "about 20 minutes". Sim stations always have the
  full window, so their results are unchanged.
- **Rhythms and the demo batch job (criterion not met).** On 25 min of continuous real data,
  the folds at 300 s were:
  - throughput: a bump at phase 0–20 s (41.7 and 44.4 rps against ~35);
  - P50 latency: no batch bump. Its fold is dominated by incidents, which the analyser leaves
    out above the warn threshold.

  The rhythm search folds latency only, so it reports no rhythm. Left as an open question
  (fold throughput too, or make the demo's batch job load latency), not changed here.
- **The station-STALE criterion:** the step's design says STALE after 10 s without data.
  Measured: node lamp offline in < 8 s after `stop`, last sample ~5.6 s after `stop` (uvicorn
  shuts down gracefully), STALE ~16 s after `stop` (10 s after the last sample). I read
  "within 10 s" as applying to the node lamp. STALE follows the design's 10 s rule.
- **Display tweaks:** route templates are drawn with `*` (`/v1/items/*`), because the dot font
  has no braces. The `T` key only targets sim stations, since live stations can't take a test
  incident.
- **`/v1/models` flaps** between CLOSING and OVER SLO under its auto SLO of 10 ms (open
  question). The rule is the one the step specifies.
- **Bundle:** 372 → 391 kB (135.5 kB gzip). No new dependencies.

**Verification**

```
$ cd web && npm test                 → Test Files 5 passed · Tests 65 passed
$ npm run smoke                      → pages 1–5, two stations 1–4, legacy URL ✓ ·
                                       50 page switches, GPU objects unchanged · smoke: ok
$ cd probe && uv run pytest -q       → 26 passed, 1 skipped
$ uv run ruff check . / ruff format --check .  → All checks passed! / 19 files already formatted
$ cd examples/demo && uv run pytest -q → 14 passed
$ bash probe/scripts/test-rules.sh   → SUCCESS
$ podman-compose -f deploy/compose.yaml config → ok
```

Against the running demo stack (podman-compose; new bundle copied into the running Caddy
container, see "Not verified"), Playwright + SwiftShader at 1920 × 1080:

```
boot:   both stations live 3 s after load, NOMINAL, lamp mint, no console errors;
        routes "/v1/predict:live:40", "/v1/embed:live:44A", … ; stages ingress…egress
tape vs Prometheus over the tape span: api 4401/4401 s, search 4401/4401 s, nothing missing
        and nothing extra (Prometheus itself has only ~30 % of the last 4 h: the VM slept)
chaos   POST /_chaos {latency_ms: 60, stage: infer} on demo-api:
        +20 s state INCIDENT, lamp INCIDENT, infer ratio 2.15 (> 1.8) → "BOTTLENECK INFER X2.1"
stop demo-search: node lamp offline at +8 s; last data +5.6 s; STALE at +15.6…18 s; lamp dark
start demo-search: NOMINAL again ~7 s after start, without a reload
stop prometheus (doc with api, search and a sim station): api and search STALE at ~+15 s,
        sim keeps running (sample age ≤ 1 s), no page errors (the console shows the proxy's
        502s for the failed polls); boot with Prometheus down: NO CONTACT · RETRYING on the
        Prometheus screens, sim live; all live 4.2 s after Prometheus starts
```

Screenshots (session scratchpad, not committed):
`/private/tmp/claude-501/-Users-philippsodmann-Documents-python-2026-data-shaders/12b54c31-2e98-4553-8eb7-ef9cea9436e3/scratchpad/`
`07-page-{1..6}.png`, `07-twin.png`, `07-chaos-page-{1,2}.png`, `07-search-stop.png`,
`07-prom-stop.png`, `07-no-contact.png`, `07-after-contact.png`, `07-page-4-rhythms.png`.

**Not verified / needs a person**

- **The `mars-web` image wasn't rebuilt.** `podman build web/` failed twice in `RUN npm ci`
  ("npm error Exit handler never called!"), and the first attempt stalled the Podman VM for
  ~45 min.
  - The step doesn't touch the files that layer sees (`package.json` and `package-lock.json`,
    last changed in step 06). The same `npm ci` on a copy succeeds locally ("added 42
    packages").
  - The running image is from 07:00 today, before step 06, so it hasn't been rebuilt since the
    lockfile changed. This is an npm-in-Podman-VM problem, not a step 07 change.
  - The live checks ran on the new `dist/` copied into the running Caddy container (same
    Caddyfile, `/prom` proxy and `/config` mount).
  - Someone should run `docker compose -f deploy/compose.yaml --profile demo up -d --build`
    once with real Docker (or after a `podman machine` restart).
- **A full 4 h tape on a machine that stays awake.** Here Prometheus only had ~30 % of the
  last 4 h (VM stalls). The tape matched Prometheus exactly, but not a continuous 4 h.
- **Clock-skew handling live:** unit-tested (24 min skew). Live, the VM's clock had caught up
  by the time it was fixed.
- **Slot overflow and rebuild live** (no way to add routes to the demo without editing it):
  unit-tested only.
- **External alerts live:** the demo has no alerting rules. Unit-tested with a hand-written
  `/api/v1/alerts` fixture.
- **Region discovery live:** the demo's region label is `unknown` until step 11. Unit-tested.
- Real GPU frame time, and the ivory finish with the new screens.

**Notes for later steps**

- Source contract: `backfill(fromT, progress?, store?) → Promise<samples[]>`,
  `start(push, store?)`, optional `sync()` and `history(fromMin, toMin)`. A sample's
  `hostStates` may be `null` (no node data in that second).
- `station.store` / `profile` / `source` may change on a rebuild. Read them through the
  station, or rebuild on `getStatus().generation`. Panels already do. Device instruments
  (step 10) should read `s.store` each frame.
- Lamps should use `store.status`, not `store.state`: status includes STALE and external
  alerts, while `state` stays MARS's own hysteresis (the almanac records it).
- Step 08: station edits recreate the station (unchanged). Prometheus stations reload their
  tape from Prometheus, which takes ~3 s against the demo.
- Step 09: `station.getStatus()` gives phase and problem (NO CONTACT) for the stations plate.
- Step 11: regions need codes in `data/regions.js`. `region_rtt_ms` is optional, and a region
  is live on `region_rps` alone.
