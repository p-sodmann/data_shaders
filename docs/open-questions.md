# Open questions

Add questions as you find them, under a heading for their area. Resolve them by moving them
to **Resolved** with the answer, the date and the step or ADR that settled them.

## Config and stations

- **Shared config across displays: `PUT /config/mars.json` (deferred in step 12).** Decided on
  2026-11-06: a small upload handler next to Caddy, enabled only when basic auth is on, and the
  step 08 editor's save calls it; Caddy's `file_server` stays read-only. Step 12 built the auth
  half (`MARS_BASIC_AUTH`, ADR-0008) but deferred the handler (user's decision, 2026-11-07):
  Caddy can't write files without a plugin, so it needs a small write server in the `mars`
  image (or a custom Caddy build with WebDAV), a writable config volume, and a *Save to server*
  key on the Workbench. Until then a display's edits stay in its localStorage, and sharing means
  exporting a cartridge and saving it as `deploy/site/config/mars.json`.
- **Should MARS manage Prometheus scrape targets? (step 09)** The stations plate lists what
  Prometheus already scrapes, and adding a server is still a file in
  `deploy/site/targets/` (`mars-probe scrape-config`). The plate could write that file
  (an "Add server" field with host:port) through the same upload handler as the deferred config
  PUT above, behind `MARS_BASIC_AUTH`. That gives a browser write access to Prometheus's
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

- **`stationLog` and `log` bound to `*` are the same instrument (step 10).** The step asked for
  the all-stations log in the cross-station bay group, so it is a registry entry of its own,
  while `log` keeps its `*` binding (the Twin page uses it). Keep both, or migrate `log` + `*`
  to `stationLog` and drop scope `either`?

- **Narrow and portrait screens (decided in step 05, never built).** The decision was: below
  5:4, wrap the footer keys onto a second row and shrink the header tubes so the device fits the
  viewport. The step 12 sweep found only the original one-column `max-aspect-ratio: 5/4` rule
  from step 00 in `web/src/style.css`. Related to the footer entry above.
- **Long station names (decided in step 06, never confirmed built).** The decision was: the
  System tube cuts a name to about 12 characters, module headers keep the full name, the schema
  limit stays 24. The System tube now shows the device status rather than a station name, so
  this may be moot; check module headers and the station board with a 24-character name.

- **A fresh prod display logs a 404 (step 12).** With `deploy/site/config/` empty,
  `/config/mars.json` answers 404 and the loader falls back to the built-in document, as
  designed (ADR-0005), but Chromium prints the 404 as a console error. Harmless; Caddy could
  answer 204 for a missing `mars.json`, or the loader could ask with `HEAD` first.

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

Three follow-ups from steps 02 and 03 were decided on 2026-11-06 but never built (found in the
step 12 sweep; user's decision to reopen rather than build them in step 12):

- **`LOADGEN_TZ` for the daily phase.** Add `LOADGEN_TZ` (IANA name, default UTC) so the
  loadgen's daily sine peaks in local afternoon; compose passes `${TZ:-UTC}`. Today the phase
  is UTC (low at 03:00, high at 15:00).
- **Demo targets in their own directory.** `deploy/prometheus/targets/demo.yml` is mounted
  without the `demo` profile too, so a plain `compose.yaml` stack has two down targets. The
  decision was a directory that only the demo resolves. `compose.prod.yaml` (step 12) mounts
  `deploy/site/targets/` instead, so this only affects the demo file.
- **Scrape interval 5 s by default, 1 s for demo jobs.** `prometheus.yml` still scrapes
  everything every 1 s. Revisit once real series counts are known; the rules' `[1m]` windows
  work with either.

## Resolved

Decided in review sessions on 2026-11-06 and 2026-11-07. "→ step N" is where the decision
gets built.

- **Images couldn't be built in the Podman VM (steps 07–09).** Resolved 2026-11-07, before
  step 12. The cause was DNS, not npm: in the VM, IPv6 (AAAA) lookups timed out after 8 s
  (IPv4 took 0.04 s), because its resolver set-up was captured on another network and never
  refreshed. `npm ci` then crashed with "Exit handler never called!", and `uv sync` couldn't
  reach PyPI. `podman machine stop && podman machine start` fixed it (both lookups 0.03 s);
  `podman-compose --profile demo build` then built both images (`npm ci`: 51 packages in 2 s),
  and the rebuilt `mars-web` serves the Fleet page live. Worth a line in the deploy docs: after
  a network change, restart the Podman machine. *In deploy/README.md since step 12.*
- **Fleet page frame time, 2 against 16 stations (step 10).** Resolved 2026-11-07, before
  step 12. On a real GPU (Apple M4 Pro, ANGLE Metal, 60 Hz vsync) the frame interval is
  16.83 / 16.67 / 16.67 ms at 2 / 5 / 16 stations (−1.0 %), with no dropped frames. "Frame time"
  means the frame interval, as in step 10's measurement (user's decision). The CPU time per
  frame grows 0.98 → 1.76 ms, still ~10 % of the budget. A Raspberry Pi 5 is unmeasured; the
  levers are `NAMED` / `LISTED` and painter text cost. → step 10 handoff.
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
- **Changing a station recreates it (step 06):** accepted. Any edit to a station entry rebuilds
  the station. Prometheus stations refill from Prometheus, and edits are rare, so thresholds
  stay frozen in the profile. 2026-11-06. *Changed in step 09: a change to `thresh` alone
  retunes the running station and keeps its tape (the step's criterion "threshold edits take
  effect live without losing the tape"). Everything else still recreates it. 2026-11-07.*

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
  everything, `/prom` included. *Built in step 12: everything but `/healthz`, through the
  image's entrypoint ([ADR-0008](adr/0008-release-and-exposure.md)), 2026-11-07.*
- **Lifecycle API:** keep `--web.enable-lifecycle`. Caddy already refuses `/-/reload` and
  `/-/quit`, and :9090 is loopback-only.
- **Remote servers:** pull. Prometheus scrapes over the network, and the docs cover firewall
  rules and an optional TLS / basic-auth scrape config. *Written in step 12
  (deploy/README.md, Remote servers), 2026-11-07.*
- **Pages per server or mixed pages:** both stay allowed. Ship a preset generator ("the 5
  standard pages for station X"). Built in step 06: `standardPages(id, prefix)` in
  `web/src/config/presets.js`, also on `window.__mars`, 2026-11-06.
- **Aspect ratio:** responsive variants. The layout reflows per screen size, not one fixed
  panel per device. → step 05/06.
- **CI:** step 12 adds a GitHub Actions workflow: probe pytest + ruff, web build + Playwright
  smoke. *Built in step 12: `.github/workflows/check.yml` runs `scripts/check.sh` and brings the
  demo stack up under Docker Compose; `release.yml` builds the images on a `v*` tag. Not run on
  GitHub yet (nothing pushed), 2026-11-07.*
- **Licence:** MIT. *Added in step 12 (`LICENSE`, probe metadata), 2026-11-07.*
- **Package name:** `mars-probe` is free on PyPI (checked 2026-11-06, and again 2026-11-07 in
  step 12). Kept; not published to PyPI yet (ADR-0008).
- **Podman / compose:** `podman-compose -f deploy/compose.yaml --profile demo up -d` brings the
  stack up healthy (build the demo image once first, since podman-compose builds it three times in
  parallel). Real Docker Compose is left to the step 12 CI (the `stack` job; not run yet). 2026-11-06,
  step 03.
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
