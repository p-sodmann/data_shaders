# Open questions

Add questions as you find them, under a heading for their area. Resolve them by moving them
to **Resolved** with the answer, the date and the step or ADR that settled them.

## Config and stations

- **Should MARS manage Prometheus scrape targets? (step 09)** The stations plate lists what
  Prometheus already scrapes, and adding a server is still a file in
  `deploy/prometheus/targets/` (`mars-probe scrape-config`). The plate could write that file
  (an "Add server" field with host:port) through the same upload handler as the step 12 config
  PUT, behind `MARS_BASIC_AUTH`. That gives a browser write access to Prometheus's
  configuration, so it needs a decision on whether that is wanted.
- **Route SLO, stage order, name and home edits restart the station (step 09).** Only
  thresholds retune a running station. The other edits replace it, and a Prometheus station
  reloads its tape (about 3 s of TAPE LOAD) after each committed field. Fine for occasional
  edits; worth a retune path if people tune route SLOs one after another.

## Display

- **The footer runs past the housing with long page names (seen in step 09).** With the five
  standard pages for two stations (10 pages) the key row is wider than the device at
  1920 × 1080, in view mode and more so in edit mode, so the device is cut off at the sides.
  Ten short names (`X7`…) still fit. Not caused by the stations plate; the 08 handoff noted
  the edit-mode key row overflows more. Shorten the
  page keys (number only above N pages?) or let the row scroll.

- **Fleet page frame time, 2 against 16 stations (step 10).** Under SwiftShader the Fleet
  page's frame interval is 12–22 % longer with 16 stations than with 2 (flat from 5 stations
  on). The CPU time per frame is the same. The difference is beam text: the radar names up to 5
  contacts and the strands list up to 5 stations, and 2 stations fill only 2 of each. Needs a
  measurement on a real GPU (`__mars.frames()` and the rAF interval). If it is still over
  10 % there, choose between fewer named stations and cheaper text in the vector painter (one
  instance per glyph dot today).
- **`stationLog` and `log` bound to `*` are the same instrument (step 10).** The step asked for
  the all-stations log in the cross-station bay group, so it is a registry entry of its own,
  while `log` keeps its `*` binding (the Twin page uses it). Keep both, or migrate `log` + `*`
  to `stationLog` and drop scope `either`?

## Probe

- **Country headers are trusted by default (step 11).** `RegionConfig()` reads `CF-IPCountry`
  and `CloudFront-Viewer-Country` unless `country_headers=()`, as the step's resolution order
  lists them. Without one of those CDNs in front, a client can choose its own region by sending
  the header. The damage is bounded (wrong region, never a new label value), but an opt-in
  default would be safer for apps that aren't behind a CDN. Keep it, or default to `()`?
- **Country → region uses the capital (step 11).** Each country maps to the region nearest its
  capital (`probe/scripts/gen_regions.py`). Large countries land on an odd region: RU → KBP,
  KZ → DEL, CA → YUL, CN → PEK for the whole country. GeoIP gives only the country too, so
  there is nothing finer to use without city data (out of scope). Hand-tune a few entries, or
  add regions (MOW, ALA)?

## Deploy

- **Images can't be built in the Podman VM here (steps 07–09).** `npm ci` fails in the
  `mars-web` build (step 07), and in step 09 the `mars-demo` build failed because the VM had no
  DNS (`uv sync` couldn't reach PyPI). Live checks ran on files copied into the running
  containers. A `podman machine` restart or real Docker (the step 12 CI) should settle it.

## Resolved

Decided in review sessions on 2026-11-06 and 2026-11-07. "→ step N" is where the decision
gets built.

- **Standard pages and the 9-page cap (step 08):** drop the cap. The schema has no maximum page
  count, so "Add standard pages for station…" always fits. Keys `1`–`9` still jump to the first
  nine pages, and `[` / `]` step through all of them. ADR-0006 and `MAX_PAGES` in
  `web/src/config/edit.js` change. → step 08b. 2026-11-07.
- **A saved `?config=` document still loses to the URL (step 08):** the saved copy wins. *Save
  as local* stores the document under a key for the `?config=` URL, and that copy overrides the
  URL on that display. The header shows a LOCAL marker, and *Revert to URL* clears the copy.
  ADR-0005 load order changes. → step 08b. 2026-11-07.
- **Undo history is in memory only (step 08):** persist it to localStorage. Keep the last 50
  snapshots under the same key as the document (built-in, or the `?config=` URL). Drop the
  history when its newest snapshot doesn't match the loaded document, for example after a
  shared PUT or a changed URL. → step 08b. 2026-11-07.
- **Nodes that go away stay offline (step 07):** accepted. A node that leaves Prometheus keeps
  its slot and shows as offline until a reload, so a scale-down counts as NODES DOWN
  ([ADR-0007](adr/0007-runtime-entities.md) unchanged). 2026-11-07.
- **Stage order isn't in the metrics (step 07):** the probe exports `mars_stage_info{stage,
  order}`, with the order from `instrument(app, stages=[…])`, else the order in which the
  process first saw each stage (an ADR-0003 change). The web side uses it first, then the `stages` override, then the name heuristic.
  → step 09. 2026-11-07. *Built in step 09 with two changes (ADR-0003 amended): the `stages`
  override goes first, because it is what the stations plate's pipeline editor writes; and
  "first saw" is first entered, so a stage comes before the stages nested in it.*
- **External alerts without a `station` label (step 07):** they light a device-level
  `EXT ALERTS` lamp that isn't tied to a station, and log as `EXT ALERT … FIRING` without a
  station. → step 08b. 2026-11-07.
- **Almanac error rate from Prometheus (step 07):** add a recording rule
  `mars:error_ratio:rate1m` = `sum(rate(...5xx[1m])) / sum(rate(...[1m]))` per station. The
  almanac backfill reads it, so backfilled minutes are throughput-weighted like live ones.
  → step 08b. 2026-11-07.
- **Auto SLOs of small, fast routes flap (step 07):** both fixes. An auto SLO is
  `max(2 × P95, thresh.warn)`. Below a minimum rate (about 5 req/s, or fewer than 50 samples
  in the window) an endpoint keeps its last state and shows LOW N instead of changing state.
  → step 08b. 2026-11-07.
- **Rhythms can't see the demo's batch job (step 07):** the analyser folds throughput as well
  as latency and reports which signal a rhythm is in (for example `5m · THRU`). Step 07's
  criterion "Rhythms finds the 5-minute batch job" waits on this. → step 08b.
  2026-11-07.

- **Bank divider rule (step 05):** keep the plain grid gap. Pages get no `dividers` field, so
  the step 08 editor has nothing extra to place. 2026-11-06.
- **Portrait and narrow screens overflow sideways (step 05):** below 5:4, the footer keys wrap
  onto a second row and the header tubes shrink, so the device fits the viewport. A small CSS
  fix. → follow-up to steps 05/06.
- **Shared config across displays (`PUT /config/mars.json`):** a small upload handler next to
  Caddy, enabled only when `MARS_BASIC_AUTH` is set. Caddy's `file_server` stays read-only.
  The step 08 editor's save calls it once it exists. → step 12.
- **Changing a station recreates it (step 06):** accepted. Any edit to a station entry rebuilds
  the station. Prometheus stations refill from Prometheus, and edits are rare, so thresholds
  stay frozen in the profile. 2026-11-06. *Changed in step 09: a change to `thresh` alone
  retunes the running station and keeps its tape (the step's criterion "threshold edits take
  effect live without losing the tape"). Everything else still recreates it. 2026-11-07.*
- **Long station names in the System tube (step 06):** the tube shows the name cut to about
  12 characters, and module headers keep the full name. The schema limit stays at 24.
  → follow-up to step 06.

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
