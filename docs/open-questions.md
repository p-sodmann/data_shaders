# Open questions

Add questions as you find them, under a heading for their area. Resolve them by moving them
to **Resolved** with the answer, the date and the step or ADR that settled them.

## Service panel

- **Standard pages and the 9-page cap (step 08).** "Add standard pages for station…" adds five
  pages, so the built-in document (5 pages) has to lose two before it can take a second
  station's set, and the panel refuses with `no room for 5 more pages`. Options: allow it to add
  as many as fit, let it replace the current pages, or raise the cap (keys `1`–`9` would need
  another way to reach pages 10+).
- **A saved `?config=` document still loses to the URL (step 08).** After *Save as local*,
  reloading with the same `?config=` loads the URL's document again (ADR-0005 load order), so a
  kiosk link keeps showing the unedited cartridge. Should a saved copy of a URL document win
  over that URL (for example, keyed by the URL), or is "open it without `?config=`" right?
- **Undo history is in memory only (step 08).** It's lost on reload and covers every document
  change, console edits included. Is that enough, or should the last N snapshots go to
  sessionStorage?

## UI

- **Bank divider rule (step 05):** the old layout drew an engraved rule between the deck and the
  bank below it. Pages are now one 12 × 8 grid, so the rule is gone. Should a page be able to
  carry dividers (for example `dividers: [{ y: 6 }]`, drawn in a grid gap), or is the plain gap
  right? Step 08's editor would need to place them.
- **Portrait and narrow screens overflow sideways (step 05, existed before):** below a 5:4
  aspect ratio, the footer keys and the header tubes make the device wider than the viewport
  (1156 px at 1080 × 1600, the same before and after step 05). The single-column deck fits.
  The footer keys would need to wrap or shrink.

## Config and stations

- **Shared config across displays (`PUT /config/mars.json`), deferred from step 06.** Decided:
  Caddy accepts the PUT only when basic auth is on. Not built yet, because basic auth arrives in
  step 12 and Caddy's `file_server` has no PUT (it needs a WebDAV module in the image or a small
  handler). The web side would call it from the step 08 editor's save. → step 12 (with auth)
  or step 08.
- **Changing a station recreates it (step 06).** Profiles are frozen, so editing thresholds in
  step 08 rebuilds the station, and a sim station re-backfills its 4 h. For Prometheus
  stations (step 07) the backfill comes from Prometheus, so little is lost. Is that acceptable
  for the editor, or should thresholds become live-mutable on the store?
- **Long station names in the System tube (step 06).** With several stations the tube shows
  `DEGRADED · <NAME>` and shrinks its dots to fit (names up to 24 characters). At 24 characters
  the dots get small. Cap displayed names, widen the tube, or scroll?

## Prometheus source

- **Nodes that go away stay offline (step 07).** A node that leaves Prometheus keeps its slot
  and shows as offline, so a scale-down counts as NODES DOWN on the C&W panel until a reload
  ([ADR-0007](adr/0007-runtime-entities.md)). Should a slot retire after some time without
  `mars:node_up` (say 15 min), or should a removed file_sd target count as intentional?
- **Stage order isn't in the metrics (step 07).** Exemplars belong to requests, not stages,
  so "first appearance in a trace" can't be read. Without a `stages` override the order comes
  from the stage names (ingress/auth first, egress last, the rest by name). Should the probe
  export the order, for example `mars_stage_info{stage, order}` (an ADR-0003 change)?
- **External alerts without a `station` label (step 07).** Only firing alerts whose `station`
  label matches light that station's lamp. Should alerts without the label light the device
  lamp?
- **Almanac error rate from Prometheus (step 07).** Minutes read from Prometheus use
  `avg_over_time(mars:error_ratio[1m])`, which isn't weighted by throughput as the live minutes
  are. The difference is small at steady traffic. Is it worth a recording rule for
  `sum(rate(...5xx))` / `sum(rate(...))` over 1 m?
- **Auto SLOs of small, fast routes flap (step 07).** 2 × the observed 4-hour P95 gives
  `/v1/models` in the demo an SLO of 10 ms, and its P95 over a 10 s window comes from about
  20 requests, so it swings between CLOSING and OVER SLO and fills the event log. Should auto
  SLOs have a floor (for example the station's `thresh.warn`), or should endpoint state need a
  minimum request rate?
- **Rhythms can't see the demo's batch job (step 07).** The 5-minute `/v1/rank` batch shows in
  throughput (+20–25 % for ~20 s) but not in P50 latency, and the rhythm search folds latency
  only. On 25 min of continuous real data the latency fold at 300 s had no batch bump, and no
  rhythm was found. Should the analyser also fold throughput (and report which signal a rhythm
  is in), or should the demo's batch job load latency (for example, longer `rank` work per
  batch request)? Step 07's criterion "Rhythms finds the 5-minute batch job" waits on this.

## Resolved

Decided in one review session on 2026-11-06. "→ step N" is where the decision gets built.

- **JSON polling source in the config document:** accept it. ADR-0005 gets a third source kind,
  `{ kind: 'poll', url, hosts }`, next to `sim` and `prometheus`, so custom JSON feeds keep
  working without Prometheus. Built in step 06 (schema and ADR-0005 amended), 2026-11-06.
- **Database layers:** a database (MariaDB, Postgres, via `mysqld_exporter` /
  `postgres_exporter`) shows up as an extra `db` pipeline stage on its station, and the DB host
  gets one lamp in the nodes grid. Label mapping onto ADR-0003 is still to be designed in that
  step. → after step 10.
- **Test client dependency:** switched to `httpx2` on 2026-11-06. The probe's `dev` extra and
  the demo's dev group now carry `httpx2`, and the probe's `dev` extra requires
  `starlette>=1.10`. The runtime minimum stays `starlette>=0.37`.
- **Almanac key:** key the IndexedDB record by the stable station **id**. On first load, copy an
  existing name-keyed record (`${kind}:${source}:${name}`) over once, so current history
  survives. Built in step 06 as `station:<id>:<source kind>` (the kind keeps simulated and
  real pasts apart), 2026-11-06.
- **`?stations=2` debug flag:** remove it once the config document can define several stations,
  since a two-station config replaces it. Removed in step 06, 2026-11-06
  (`?config=/examples/two-stations.json` replaces it).
- **One Prometheus for all servers:** yes, a single `PROMETHEUS_URL`. More servers are scraped by
  that Prometheus, or remote-write into it. No per-station backend field. Built in step 07: every
  Prometheus station uses the document's `prometheus.url`, 2026-11-06.
- **Scrape interval:** 5 s by default, 1 s for the demo jobs so the Signal page stays meaningful.
  Revisit once real series counts are known. → step 03 follow-up.
- **Routes, stages, regions or nodes that appear at runtime:** the telemetry store reserves spare
  slots and fills them as new labels appear, keeping short-term state. It rebuilds only when the
  slots run out, and an overflow lamp shows when that happens. Built in step 07
  ([ADR-0007](adr/0007-runtime-entities.md)); the lamp is the C&W `SLOTS USED` row, 2026-11-06.
- **Node semantics for a single uvicorn process:** per-station instruments stay honest (one
  lamp). The cross-station board shows one lamp per station. Database layers may fill the grid
  later (see "Database layers" above). → step 10.
- **Almanac source:** backfill from Prometheus (`query_range`, `step=60s`, 30 days) on first load
  and after gaps. IndexedDB becomes a cache. Built in step 07: only the minutes IndexedDB
  doesn't hold are read, 2026-11-06.
- **Alert rules:** both. MARS's own caution and warning rules drive the lamps by default, and
  firing Prometheus alerts (`/api/v1/alerts`) also light the warning lamp, labelled as external.
  Built in step 07: alerts with a matching `station` label, polled every 10 s, shown as
  `EXT ALERTS` on the C&W panel and logged as `EXT ALERT … FIRING`, 2026-11-06.
- **Time base:** `S` (×10, ×60) works only for `sim`/demo stations and does nothing on
  Prometheus stations. Built in step 07 (the key reads `Time ×1 live` without sim stations),
  2026-11-06.
- **Exposure:** LAN-only by default. Setting `MARS_BASIC_AUTH` turns on Caddy `basic_auth` for
  everything, `/prom` included. → step 12.
- **Lifecycle API:** keep `--web.enable-lifecycle`. Caddy already refuses `/-/reload` and
  `/-/quit`, and :9090 is loopback-only.
- **Demo targets without the demo:** demo targets move to their own directory, which only the
  `demo` profile mounts or resolves, so a plain stack has no down targets. → step 03 follow-up.
- **Remote servers:** pull. Prometheus scrapes over the network, and the docs cover firewall
  rules and an optional TLS / basic-auth scrape config. → step 12.
- **Pages per server or mixed pages:** both stay allowed. Ship a preset generator ("the 5
  standard pages for station X"). Built in step 06: `standardPages(id, prefix)` in
  `web/src/config/presets.js`, also on `window.__mars`, 2026-11-06.
- **Aspect ratio:** responsive variants. The layout reflows per screen size, not one fixed
  panel per device. → step 05/06.
- **Config persistence across displays:** Caddy accepts `PUT /config/mars.json`, only when basic
  auth is on, otherwise read-only. localStorage stays as a per-display override. Step 06 built
  the read side and localStorage; the PUT is open again under "Config and stations".
- **CI:** step 12 adds a GitHub Actions workflow: probe pytest + ruff, web build + Playwright
  smoke.
- **Daily phase in UTC:** add `LOADGEN_TZ` (IANA name, default UTC). Compose passes
  `${TZ:-UTC}`. → step 02 follow-up.
- **Licence:** MIT. → step 12.
- **Package name:** `mars-probe` is free on PyPI (checked 2026-11-06). Check again just before
  publishing. → step 12.
- **Podman / compose:** `podman-compose -f deploy/compose.yaml --profile demo up -d` brings the
  stack up healthy (build the demo image once first, since podman-compose builds it three times in
  parallel). Real Docker Compose is left to the step 12 CI. 2026-11-06, step 03.
- **Other frameworks:** ASGI only for now. Add Flask/WSGI only if someone asks for it, since
  WSGI needs multiprocess handling (gunicorn workers).

- **Recording-rule edge cases:** no traffic → latency and ratio rules absent, throughput 0;
  `node_up` joins with `mars_info` as the many side so a version change doesn't break it;
  region rules leave out `region="unknown"`. 2026-11-06, step 03.

- **Repo layout:** monorepo ([ADR-0001](adr/0001-monorepo.md)), 2026-11-05.
- **Backend:** Prometheus ([ADR-0002](adr/0002-prometheus-backend.md)), 2026-11-05.
- **Run method:** Docker Compose ([ADR-0004](adr/0004-docker-compose.md)), 2026-11-05.
- **Server runtime:** plain single-process uvicorn, so no prometheus_client multiprocess mode is
  needed, 2026-11-05.
