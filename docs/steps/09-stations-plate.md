# Step 09: Stations plate and cartridges

Status: done
Depends on: 07, 08, 08b
Read first: [ADR-0002](../adr/0002-prometheus-backend.md), [ADR-0005](../adr/0005-config-document.md)

## Context

Stations can be Prometheus-backed (step 07), and pages can be edited (step 08), but stations
still have to be added by editing JSON.

## Goal

A **stations plate** in the service panel for adding, configuring and removing stations, with
discovery from Prometheus. Also export and import of the whole document as a cartridge file.

## Design

- **Opening it:** a `STATIONS` key in the service panel opens the plate, an engraved table, one
  row per station:
  lamp (live / stale / no data) · name · source (`PROM api` or `SIM #2`) · nodes · RPS ·
  edit · remove.
- **Discovery:** an "Available" section lists the values of
  `GET {prometheus}/api/v1/label/station/values?match[]=mars_info` that don't have a station
  yet. Each shows a live P50 and RPS readout (a single query) and an `ADD` key. Adding creates
  `{ id, name: VALUE-01 upper-cased, source: { kind: 'prometheus', station } }` and offers
  "also add standard pages".
- **Edit station:**
  - name
  - thresholds (`warn`, `crit`, `errWarn`, `errCrit`, `satWarn`, `satCrit`, scale maximums)
  - SLO (target, days)
  - home location (lat/lon, or pick from the regions table)
  - per-endpoint SLO overrides, listing the discovered routes
  - pipeline stage order, defaulting to the order the probe exports in `mars_stage_info`
    (ADR-0003, amended 2026-11-07)
  Every field shows its default when empty. Fields are validated by the zod schema, and an
  invalid value is shown on the field.
- **Removing a station** that panels still use asks to either remove those panels or rebind
  them to another station.
- **Prometheus URL:** an editable field on the plate (`doc.prometheus.url`) with a connection
  lamp (`/api/v1/status/buildinfo`).
- **Cartridges:**
  - `EXPORT` downloads `mars-<date>.mars.json`.
  - `IMPORT` accepts a file (or drag and drop onto the device), shows a summary (stations and
    pages, plus validation errors), then replaces or merges the current document.
  - `RESET` returns to the default document (with confirmation).
  - Imports run the migrations.

- **Stage order from the probe:** `mars-probe` exports `mars_stage_info{station, stage,
  order}` (gauge = 1). The order comes from `instrument(app, stages=[…])`, else from the order
  in which the process first saw each stage. The Prometheus source orders stages by it, then
  by the station's `stages` override, then by name.

## Tasks

1. The stations plate UI, in the same visual language as step 08.
2. A discovery client (reuse the step 07 Prometheus client).
3. Export, import with merge, and reset.
4. The "remove station still in use" flow.
5. `mars_stage_info` in the probe (with a pytest case and an `instrument(stages=…)` argument),
   and stage ordering by it in the Prometheus source.
6. Smoke test: with a recorded Prometheus fixture served by the preview server (mock the `/prom`
   routes in Playwright), discover `api`, add it with its standard pages, export, reset, import,
   and check the result is the same.

## Acceptance criteria

- [x] Against the live demo stack, both demo stations appear under Available. Adding one shows
      live data within 5 s and a filled tape after the backfill.
- [x] Threshold edits take effect live (the lamp and bar colours change) without losing the
      tape.
- [x] Export, reset, import round-trips to an identical document (deep-equal, checked in vitest).
- [x] Importing an invalid file shows readable errors and changes nothing.
- [x] vitest and smoke pass.

## Out of scope

Prometheus scrape-target management. Adding a server to Prometheus stays a file in
`deploy/prometheus/targets/`. Note in open questions whether MARS should manage that.

## Handoff

**Built**

- **Stations plate:** [StationsPlate.jsx](../../web/src/ui/service/StationsPlate.jsx), opened by the
  `Stations` key on the service panel ([Workbench.jsx](../../web/src/ui/service/Workbench.jsx)).
  - The table: lamp · name · source · nodes · RPS · `✎` · `✕`.
  - The Prometheus URL field with a contact lamp (`status/buildinfo`).
  - *Available on Prometheus*: `label/station/values?match[]=mars_info` over the last hour,
    minus the stations already on the device, each with P50 and RPS from one query. `+ Add`
    creates the station, then offers its 5 standard pages.
  - The remove flow (below) and the cartridge keys.
  - It polls Prometheus every 2 s while it is open: three requests.
- **Station editor:** [StationEditor.jsx](../../web/src/ui/service/StationEditor.jsx).
  - Fields: name; all nine thresholds (fractions edited as %); SLO target and window; home as a
    region code or lat/lon. Prometheus stations also get a P95 SLO per discovered route
    (placeholder = the auto SLO) and the pipeline order (`▲` moves a stage up, *Probe order*
    clears the override).
  - Empty means default, and the default shows faintly in the field. Each value is checked by
    `stationSchema` (exported from [schema.js](../../web/src/config/schema.js)) and against its
    partner (warn < crit ≤ scale). A refusal is written in amber under the field and doesn't go
    in.
  - New control: `Entry` in [controls.jsx](../../web/src/ui/service/controls.jsx).
- **Document edits:** [config/stations.js](../../web/src/config/stations.js).
  - `stationUsage`, `promStation`, `unclaimed`, `addStation`, `patchStation`, `updateStation`,
    `removeStation(doc, id, { rebind })`, `setPrometheusUrl`.
  - Cartridges: `cartridgeName`, `cartridgeText`, `readCartridge` (migrate and validate →
    `{ doc, summary }` or `{ errors }`) and `mergeDocs`.
  - Every change goes through `edit()` and `docStore`, so it is one undo step: an import, a
    reset, or a removal that rebinds panels.
- **Discovery client:** [data/prometheus/stations.js](../../web/src/data/prometheus/stations.js)
  (`stationValues`, `readouts`) and `client.buildinfo()`.
- **Live thresholds:** a change to `thresh` alone now **retunes** the running station instead of
  replacing it.
  - [manager.js](../../web/src/station/manager.js) keeps each entry's `def` and URL;
    `station.retune(def)` is in [station.js](../../web/src/station/station.js).
  - `retune(profile)` swaps the thresholds in the telemetry store, the Prometheus source (node
    states, new routes' SLO floor) and the almanac.
  - The generation goes up by one, so panels rebuild from the same tape.
- **Cartridge import by drop:** dropping a file anywhere on the open device
  ([App.jsx](../../web/src/App.jsx), capture phase, files only) opens the plate with the
  import summary.
- **Probe:** `mars_stage_info{station, stage, order}` and `instrument(…, stages=[…])` in
  [probe.py](../../probe/src/mars_probe/probe.py).
  - Listed stages are exported at start. Others get the next position when they are first
    entered ([stages.py](../../probe/src/mars_probe/stages.py) calls `probe.see_stage` in
    `__enter__`).
  - The demo declares its stages ([app.py](../../examples/demo/demo/app.py)).
- **Stage order on the web side:** [discover.js](../../web/src/data/prometheus/discover.js)
  queries `max by (stage, order) (last_over_time(mars_stage_info{…}[1h]))`, and
  `orderStages(names, override, probe)` orders by the override, then the probe (`probeOrder`
  keeps the lowest position across instances), then the name heuristic.
- **Tests:**
  - [web/test/stations.test.js](../../web/test/stations.test.js) (new, 10 tests): edits,
    removal and rebind, the export → reset → import deep-equal, invalid files, v0 migration,
    merge, and the discovery client on recorded fixtures.
  - [manager.test.js](../../web/test/manager.test.js): the retune test, and the recreate test
    now changes `slo`.
  - [prometheus.test.js](../../web/test/prometheus.test.js): probe ordering.
  - [probe/tests/test_stages.py](../../probe/tests/test_stages.py): declared, first-entered and
    nested order. `mars_stage_info` was added to the exposition contract test.
  - Four fixtures recorded from the live stack: `stage-info`, `labels-station`, `readouts`,
    `buildinfo`.
  - [smoke.mjs](../../web/scripts/smoke.mjs) `checkStationsPlate`: a recorded Prometheus served
    through `context.route('**/prom/**')`.
- **Docs:** [web/README.md](../../web/README.md#stations-and-cartridges),
  [probe/README.md](../../probe/README.md), [deploy/README.md](../../deploy/README.md),
  ADR-0003 and ADR-0005 amended, and [open-questions.md](../open-questions.md).

**Deviations**

- **The `stages` override goes before `mars_stage_info` (ADR-0003 amended).** The step text
  says probe first, then override. But the plate's pipeline editor writes the override, so with
  probe-first its edits would do nothing whenever the probe exports an order.
- **"First saw" means first entered (ADR-0003 amended).** Stages record on exit, so ordering by
  first record put an outer stage after the stages nested in it.
- **Thresholds retune, they don't recreate (ADR-0005 amended).** This replaces the 2026-11-06
  decision "Changing a station recreates it" for `thresh` only. It is what the criterion "take
  effect live without losing the tape" needs: recreating a Prometheus station reloads its tape.
  Every other field still recreates the station (new open question).
- **The plate widens the service column (38 → 72 vmin) and hides the module bay while open.**
  The step 08 note put it in the column, but seven table columns and a 3-wide field grid don't
  fit in 38 vmin. The deck stays in view, so threshold changes are visible as they are made.
- **Merge semantics** weren't specified (now written into ADR-0005):
  - same id and source → the current entry stays;
  - same id, other source → the incoming station gets a free id and its panels follow;
  - pages are appended with free ids;
  - `device` and `prometheus` stay the current document's.
- **Home "pick from the regions table"** is a 3-letter code field (`FRA`), not a list: the
  table has 80 entries.
- **Warn < crit is checked only in the editor,** against the effective values (defaults
  included). The schema can't know the defaults of a partial override, so loaded documents
  aren't held to it.
- **Removing a station no panel uses** takes a second press (as page delete does), not a dialog.
- **Drop-to-import works only while the housing is open,** so a locked wall display can't be
  changed by a stray drag.
- **The demo now passes `stages=` to `instrument()`.** Its first-seen order would put `rank`
  after `egress` whenever `/v1/predict` comes first. One demo test assertion was narrowed to
  the duration series, because declared stages appear in `mars_stage_info` before they run.
- **The smoke test's recorded Prometheus answers range queries with an empty matrix.** The
  smoke checks the plate, not the backfill, which the unit tests cover.
- **Bundle:** Workbench chunk 84.0 → 101.1 kB (32.1 kB gzip), main 408.2 → 410.4 kB. No new
  dependencies.

**Verification**

```
$ cd web && npm run build      → Workbench 101.11 kB, index 410.40 kB, built
$ npm test                     → Test Files 9 passed · Tests 114 passed (102 before)
$ npm run smoke                → 13 checks ✓ … ✓ stations plate  api discovered, added with pages,
                                 live; export → reset → import identical; invalid file refused · smoke: ok
$ cd probe && uv run pytest -q → 28 passed, 1 skipped (26 before)
$ uv run ruff check . && uv run ruff format --check .   → All checks passed! / 19 files already formatted
$ cd examples/demo && uv run pytest -q && ruff …        → 14 passed / clean
$ bash probe/scripts/test-rules.sh                      → SUCCESS
$ podman-compose -f deploy/compose.yaml config          → ok (docker isn't installed here)
```

Live: the demo stack (Podman), the `vite` dev server proxying `/prom` to `:9090`, Playwright with
SwiftShader at 1920 × 1080, a fresh profile (built-in document), and the step 09 probe files
copied into the running demo containers (see "Not verified"):

```
mars_stage_info   api/search: 0 ingress, 1 auth, 2 embed, 3 infer, 4 rank, 5 egress
available         [api P50 19.2 ms 17 rps, search P50 26.4 ms 17 rps]   contact · v3.16.0
add api + pages   phase live with a sample 0.62 s after Add · 10 pages · no console errors
tape              4472 s with data vs 4452 s in Prometheus over the same 4 h span
                  (Prometheus holds only ~32 % of it: the VM sleeps)
refusals          "abc" → "a number" · warn 50 → "must stay below crit (35)" ·
                  err warn −1 → "Too small: expected number to be >=0"; doc thresh unchanged (null)
retune warn 8 / crit 12
                  status NOMINAL → INCIDENT, alarm lamp INCIDENT, table lamp INCIDENT,
                  same station and same store object, generation 1 → 3, tape 4486 s (kept,
                  still growing), tape and readout drawn orange
export            mars-2026-11-07.mars.json, equal to the document
invalid import    "Not loaded · 3 problems" (id, name, panel past column 12), no Replace key,
                  document unchanged
remove main       3 options shown; rebind to api → 0 panels on main, 54 panels; undo restores main
drop a file       on the deck: summary "1 station · SEARCH-01 · 1 page" → Merge → stations main, search
stage order       ▲ on rank → doc stages […, rank, infer, egress], station follows, caption
                  "order set here"; Probe order → override gone, probe order back
```

Screenshots (session scratchpad, not committed): `/private/tmp/claude-501/-Users-philippsodmann-Documents-python-2026-data-shaders/e64c34df-1670-4bd4-af85-357f469fd769/scratchpad/shots/`
`09-plate.png`, `09-offer.png`, `09-added.png`, `09-api-tape-before.png`,
`09-editor-retuned.png`, `09-api-tape-retuned.png`, `09-import-invalid.png`,
`09-remove-in-use.png`, `09-stages.png`. Smoke: `web/snapshots/stations-*.png`.

**Not verified / needs a person**

- **Neither image was rebuilt.**
  - `mars-demo` failed in `uv sync`: the Podman VM had no DNS for PyPI.
  - `mars-web` has the `npm ci` problem from step 07.
  - The live run used the dev server, and the step 09 `probe.py`, `stages.py` and demo
    `app.py` copied into the running demo containers, which were then restarted.
  - Someone with working Docker should run `docker compose -f deploy/compose.yaml --profile demo
    up -d --build` once.
- **Real OS drag and drop of a file.** Only a synthetic `DragEvent` with a `DataTransfer` was
  dispatched. Downloads were checked through Playwright's download event, not a real browser's
  save dialog.
- **Design sign-off for the plate and editor.** I checked the screenshots against the rules
  (lamps are the only colour; refusals in amber like the existing notice; every control a key
  or an engraved field; the file input hidden). Someone who owns the look should judge the
  table density and the widened column, and the ivory finish, which wasn't looked at.
- Real GPU, Firefox and Safari, and touch.
- **The footer runs past the housing with 10 standard pages,** in edit and view mode. This was
  already the case before this step; it is now an open question.

**Notes for later steps**

- `station.retune(def)` exists for a `thresh`-only change. The manager decides with
  `sameBut('thresh', …)`. New threshold readers should read `station.profile` when they are
  built (panels rebuild on the generation bump), or `store.profile` per frame.
- A plate edit to a station goes through `updateStation(doc, id, patch)`; `undefined` in a
  patch removes the override. Use `removeStation(doc, id, { rebind })` for anything that drops
  a station.
- Step 10: cross-station instruments see a retuned station as the same object with a new
  `profile` and generation.
- Step 11: the editor's region field uses `region()` from `data/regions.js`, so new codes show
  up there automatically.
- Step 12: the scrape-target question (open questions) belongs with the config PUT. The plate's
  *Cartridge* group is where a *Save to server* key would go.
