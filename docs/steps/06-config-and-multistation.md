# Step 06: Config document and multi-station runtime

Status: done
Depends on: 05
Read first: [ADR-0005](../adr/0005-config-document.md) (binding)

## Context

After step 05, pages are data and instruments take a station, but there is still exactly one
station and the pages come from a JS preset.

## Goal

The whole device is driven by the ADR-0005 config document: it is loaded, validated, migrated
and persisted, and it can hold **several stations** running at the same time. Source kinds in
this step are `sim` and `json` (the existing polling source). `prometheus` arrives in step 07.

## Design

- `web/src/config/schema.js`: a zod schema for document v1. Unknown keys are kept (passthrough)
  on panels' `options` only.
- `web/src/config/load.js`: the load order from ADR-0005 (`?config=` → localStorage →
  `/config/mars.json` → default). It returns `{ doc, origin }`. URL params `fps`, `dpr`,
  `finish`, `page` and `cycle` override `doc.device`.
- `web/src/config/migrations.js`: an ordered list `[(docV0) => docV1, …]`. v0 is "no version
  field", and it maps the legacy URL params (`?source=`, `?station=`, `?hosts=`, `?speed=`)
  to a single station, so old kiosk URLs keep working.
- `web/src/config/store.js`: a small external store
  (`getDoc / setDoc(updater) / subscribe`). It saves to localStorage, debounced, unless the
  doc came from `?config=`, which is read-only unless the user saves it.
- `web/src/station/manager.js`: `createStationManager()` keeps a station for each `doc.stations`
  entry. When the doc changes, it diffs by id: new stations are created and started, removed
  ones are stopped and disposed, and stations whose `source` changed are recreated. Profile-only
  changes such as thresholds are applied in place where that's possible, and otherwise by
  recreating the station.
- **Lazy derived data:** `station.signal` (the FFT and epoch-folding work) is computed only while
  at least one mounted panel needs it. A reference count is taken by the page renderer.
  Telemetry ingest always runs.
- **Housing:**
  - The module header shows the station name when the doc has more than one station:
    `14 PROXIMITY · SEARCH-01`.
  - The system lamp shows the **worst** state across all stations. Its readout names the worst
    station (`INCIDENT · SEARCH-01`).
  - The station field in the header shows the single station's name, or `N STATIONS`.
  - The event log is per station (it's a panel). Add `options.station: 'all'` support to the
    `log` instrument, which merges every station's events with a station prefix. This is the
    first instrument that uses the station `'*'`, so mark it `scope: 'either'`.
- **Default document:** one `sim` station `main` and `DEFAULT_PAGES`. This is the same as the
  default after step 05.

## Tasks

1. Schema, migrations, loader and store as above, with unit tests (add **vitest**) for schema
   validation, v0 migration from legacy URL params, and the load order.
2. The station manager, with unit tests for the diff logic (sim sources only, use fake timers).
3. Wire `App.jsx` to the doc store and the station manager. Remove `runtime.js` or reduce it to
   bootstrapping.
4. Add a second sim station (seed 2, with different thresholds) to an example document,
   `web/public/examples/two-stations.json`, laid out with one page mixing panels from both
   stations.
5. A `?config=/examples/two-stations.json` smoke run: add it to `npm run smoke`.
6. Keep the almanac per station (the key includes the station id). Check that two stations don't
   share an IndexedDB store.

## Acceptance criteria

- [x] `npm test` (vitest) and `npm run smoke` pass, including the two-station config.
- [x] An old URL, `?source=/telemetry.json&station=edge-eu-2&hosts=48`, still works through the
      v0 migration.
- [x] With the two-station example, `T` (inject incident) affects the station shown on the
      current page. If there is more than one, a key `Shift+T` cycles which station gets it.
      The lamp shows the worst one.
- [x] Editing the doc in the devtools console (`window.__mars.setDoc(...)`, a debug handle) adds
      or removes a station live without a reload or errors.
- [x] Memory and CPU are reasonable with 4 sim stations on one page. Report the frame time in the
      handoff.

## Out of scope

The Prometheus source (step 07) and the edit UI (steps 08 and 09).

## Handoff

**Built**

- [web/src/config/schema.js](../../web/src/config/schema.js): the zod schema for document v1
  (`docSchema`, `parseDoc(raw) → { ok, doc } | { ok: false, error }`, `VERSION`, `GRID`).
  Sources are `sim`, `poll` and `prometheus`. It requires unique station, page and per-page
  panel ids, panels inside the 12 × 8 grid, and no overlaps. It needs at least 1 station and
  1–9 pages. Unknown keys are dropped except in `panel.options`. Device defaults are filled in.
- [web/src/config/migrations.js](../../web/src/config/migrations.js): `MIGRATIONS[0]` (v0 → v1),
  `migrate(raw)` and `legacyDoc(URLSearchParams)`. v0 is `{ source?, station?, hosts?, speed?,
  device?, pages? }` and becomes one station `main` (name upper-cased, as the old plate did).
- [web/src/config/load.js](../../web/src/config/load.js): `loadDoc({ search, storage, fetch })
  → { doc, origin: 'url' | 'local' | 'server' | 'default', problems }`, `prepare(raw)`
  (migrate and validate, throws), `defaultDoc()`, and `deviceSettings(doc, { search, storage })
  → { fps, dpr, cycle, finish, page }`.
- [web/src/config/store.js](../../web/src/config/store.js): `createDocStore({ doc, origin })` with
  `getDoc / setDoc(docOrUpdater) / subscribe / save()`, plus `origin` and `readOnly`. Every doc
  is validated and deep-frozen. An invalid one throws and the current doc stays. Saving to
  localStorage is debounced (500 ms) unless `readOnly` (origin `url`).
- [web/src/config/presets.js](../../web/src/config/presets.js): `standardPages(stationId, prefix)`
  (the open question's "preset generator"). `DEFAULT_PAGES = standardPages('main')`, unchanged.
- [web/src/station/manager.js](../../web/src/station/manager.js): `createStationManager()` with
  `sync(defs)`, `getSnapshot() → { list, byId }`, `subscribe`, `get`, `list`, `dispose`, and a
  stable live view `device` (`{ get stations() }`). Also exports `worstStation(list)`.
- [web/src/station/station.js](../../web/src/station/station.js): `retainSignal() → release()` and
  `signalRefs`. The analyser is dropped one tick after the last release. The almanac key is
  `station:<id>:<source kind>`, and it copies the old name-keyed record over once.
- [web/src/runtime.js](../../web/src/runtime.js) is now `boot()`: load → store → manager (subscribed
  before React) → `window.__mars = { getDoc, setDoc, save, origin, stations, standardPages }`.
  App adds `stats`. [main.jsx](../../web/src/main.jsx) renders once boot resolves.
- [web/src/App.jsx](../../web/src/App.jsx): pages and stations come from the store and manager.
  It adds the header plate (`N STATIONS`), the worst-state lamp, `T` / `Shift+T` targeting (the
  key reads `Test · SEARCH-01` when a page shows several stations), `S` for all sim stations,
  and a footer with `N stations · total nodes`.
- [web/src/ui/PageView.jsx](../../web/src/ui/PageView.jsx): `PageView({ page, stations, device,
  named, first })`. It binds `'*'` panels to the device, puts `· STATION` in module headers when
  `named`, and holds `retainSignal` for panels that `needs: ['signal']`.
- Instruments: `log` is `scope: 'either'` and merges every station's events, with a dimmed name
  prefix, when built on the device. `createStatus` / `createClock` also take the device.
  Status shows the worst station and names it unless all are nominal, and it shrinks its dots
  to fit the name. The clock follows the first station.
- [web/public/examples/two-stations.json](../../web/public/examples/two-stations.json): `main`
  (INFERENCE-01, seed 1) and `search` (SEARCH-01, seed 2, 24 hosts, warn 20 / crit 30, SLO
  99.9 %). Pages: Twin (mixed, 9 panels incl. the merged log), Sweep (both radars and contact
  lists), and the standard Signal and Almanac pages for `search`.
- Tests: [web/test/](../../web/test/) has 44 vitest tests (schema, migrations, load order, device
  settings, doc store, manager diff with real sim stations on fake timers, worstStation,
  signal ref count). [smoke.mjs](../../web/scripts/smoke.mjs) also runs the two-station doc
  (4 pages, plate, header names, merged log, distinct almanac keys) and the legacy URL
  (stubbed `/telemetry.json`).
- Dependencies: `zod` ^4.6 (ADR-0005), `vitest` ^5.1 (dev, step text). ADR-0005 amended (see
  deviations). READMEs: [web](../../web/README.md) (config document, console handle, keys,
  URL params, architecture) and [deploy](../../deploy/README.md) (`config/mars.json`).

**Deviations**

- **"All stations" is `panel.station: '*'`, not `options.station: 'all'`.** Two fields that
  could disagree seemed worse than one. The schema already has `station` for the binding,
  and step 10's device instruments get the same `device` object. The log's caption reads
  `Teletype · all stations`.
- **Legacy URL parameters come second in the load order** (after `?config=`, before
  localStorage). An explicit URL should win over what a display remembers, and the URL is
  read-only, so it never overwrites the saved copy. ADR-0005 is amended to say so.
- **ADR-0005 amended:** the `poll` source kind (`{ kind, url, hosts }`, resolved earlier in
  open-questions), the `'*'` binding / `scope: 'either'`, the station id pattern, the
  unknown-key rule, the legacy URL step in the load order, and that URL overrides never
  enter the document.
- **`prometheus` sources validate but don't run.** The manager skips them with one warning,
  and their panels show NO SIGNAL. Documents written for step 07 load today.
- **No in-place profile updates.** Any change to a station entry recreates it. Profiles are
  deep-frozen and instruments copy at construction (step 04), so nothing can be patched.
  Cost: a recreated sim station gets a fresh 4 h backfill and loses its live short-term state.
- **`page` is not a `doc.device` field.** It stays a session override (URL, then
  `localStorage["mars.page"]`). **`?finish=` now beats `localStorage["mars.finish"]`**
  (before, localStorage won over the URL).
- **`S` (time base) sets every sim station at once.** It's one setting for the device, and
  the clock follows the first station.
- **Status tube readout:** it names the worst station only when it isn't NOMINAL ("NOMINAL ·
  INFERENCE-01" would suggest the others are worse). Ties go to doc order.
- **Debug handle:** `window.__MARS__` is merged into `window.__mars` (stats included), and the
  smoke test uses `__mars`. `?stations=2` and `CONFIG` are removed. `config.js` keeps only
  constants, so stations can run under node tests. The almanac's `pagehide` listener is now
  optional for the same reason.
- **Almanac key** `station:<id>:<SIMULATED|LIVE>`. The source kind is part of the key so a
  simulated past never shows as real history if a station changes from `sim` to `poll`. The
  old `${kind}:${sim|url}:${name}` record is copied, not moved, so an older build on the same
  origin still finds it.
- **Bundle size:** the JS grows from 265.6 kB (96.4 kB gzip) to 372 kB (127.5 kB gzip), mostly
  zod. The Rollup build prints harmless "annotation cannot be interpreted" warnings from zod's
  sources.
- **Config PUT for shared displays** (resolved "→ step 06" in open-questions) is **not built**.
  It depends on basic auth (step 12), and Caddy's `file_server` has no PUT, so it needs a
  WebDAV module or a small handler. It was moved back to open questions with that note.

**Verification**

```
$ cd web && npm test
 Test Files  4 passed (4)
      Tests  44 passed (44)

$ npm run smoke
✓ page 1  modules 01–07  → snapshots/page-1.png
  … pages 2–5 ✓
✓ two stations page 1  modules 01–09  → snapshots/two-stations-1.png
✓ two stations page 2  modules 10–13  → snapshots/two-stations-2.png
✓ two stations page 3  modules 14–18  → snapshots/two-stations-3.png
✓ two stations page 4  modules 19–23  → snapshots/two-stations-4.png
✓ legacy URL  modules 01–07  → snapshots/legacy-url.png
✓ 50 page switches  GPU objects unchanged (screens 9, textures 53, framebuffers 45, programs 14, buffers 3; peak textures 53)
smoke: ok
  (two-station page 1 also checks: plate "2 STATIONS", headers "… · INFERENCE-01" and
   "… · SEARCH-01", "Teletype · all stations", IndexedDB keys station:main:SIMULATED and
   station:search:SIMULATED. Legacy: plate EDGE-EU-2, footer "Source LIVE · 48 nodes",
   samples arriving from the stubbed /telemetry.json)

$ node check06.mjs   # Playwright script in the session scratchpad, not the repo
✓ T key targets first station on page: "Test · INFERENCE-01"
✓ T → main {"main":1,"search":0}
✓ Shift+T cycles: "Test · SEARCH-01"
✓ T → search {"main":1,"search":1}
✓ Shift+T wraps around
✓ lamp "lamp DEGRADED" = worst of main=DEGRADED search=NOMINAL
✓ one-station page: "Test alarm"
✓ add: plate "3 STATIONS", stations main,search,extra
✓ panel rebound to the new station
✓ remove search: plate "2 STATIONS", 4 empty bays          (its 4 panels → NO SIGNAL)
✓ invalid doc refused: Error: stations: Too small: expected array to have >=1 items
✓ URL document not written to localStorage
✓ no errors ()                                               (both runs)
✓ legacy record copied: {"lat":999,"keys":["SIMULATED:sim:INFERENCE-01","station:main:SIMULATED"]}
  1-station:  fps 17.4, rAF interval mean 57.6 / p95 66.7 ms, engine callback mean 0.1 / p95 0.2 ms, heap 13 MB, 9 screens
  4-stations: fps 14.5, rAF interval mean 68.7 / p95 83.3 ms, engine callback mean 0.2 / p95 0.3 ms, heap 78 MB, 11 screens
check06: ok

$ cd probe && uv run pytest -q                       → 26 passed, 1 skipped
$ uv run ruff check . && uv run ruff format --check . → All checks passed! / 19 files already formatted
$ cd examples/demo && uv run pytest -q               → 14 passed
$ bash probe/scripts/test-rules.sh                    → SUCCESS
$ podman-compose -f deploy/compose.yaml config        → ok (docker compose isn't installed here)
```

**Frame time with 4 sim stations** (one page: 4 tapes, 4 latency readouts and a merged log, all
four stations running; headless Chromium with SwiftShader at 1920 × 1080, dpr 1). The engine's
main-thread work per frame stays below 0.3 ms p95 (0.2 ms with one station). The frame rate is
bound by software rasterisation in the GPU process: 17.4 fps for 9 screens, 14.5 fps for 11.
JS heap goes from 13 to 78 MB. Most of that is per-station data: each station has a 30-day
almanac, 4 h of series, and the replaced default station is still waiting for GC. CDP
`TaskDuration` shows the main thread about 1 % busy in both runs. These are SwiftShader
numbers. On real hardware the GPU side should be far faster, but it hasn't been measured.

Screenshots: `web/snapshots/two-stations-{1..4}.png` and `legacy-url.png` (made by smoke). In
the session scratchpad: `incident-two-stations.png` (lamp amber, System tube
`DEGRADED · INFERENCE-01 00:01`), `setdoc-removed.png`, `perf-1-station.png`,
`perf-4-stations.png`.

**Not verified / needs a person**

- Frame time on real GPU hardware (only SwiftShader was measured).
- The two-station layout and the shrunken System tube text in the ivory finish, and on a
  narrow or portrait screen.
- The `?config=` → `save()` → reload path was only unit-tested, not tried in a browser.
- `/config/mars.json` from the Docker volume was not tried in the running stack. It was
  unit-tested, and the Caddy route is unchanged since step 03.
- The INCIDENT state (not just DEGRADED) on the lamp with two stations: the incident was still
  ramping when the check ran. The code path is the same.

**Notes for later steps**

- Step 07: add `'prometheus'` to `RUNNABLE` in `station/manager.js` and a branch in
  `createStation`. The schema already accepts `{ kind: 'prometheus', station }`, and
  `doc.prometheus.url` defaults to `/prom` once the block exists.
- Step 08: edit through `docStore.setDoc(updater)`. It throws a readable multi-line error on an
  invalid doc (`path: message` per line), so the editor can show it. Docs are frozen, so
  updaters must copy. A doc from the URL is `readOnly` until `save()`. `doc.device.locked`
  is in the schema. Changing a station's thresholds recreates it.
- Step 09: removing a station leaves its panels as NO SIGNAL bays. The manager handles it, and
  the doc stays valid.
- Step 10: `scope: 'device'` instruments get `manager.device` (`{ stations }`, live, stable
  identity), so they don't rebuild when stations change. Read `device.stations` every frame.
  `worstStation()` is in `station/manager.js`.
- Instruments that use `station.signal` must list `'signal'` in `needs`. Otherwise nobody holds
  the analyser and it may be rebuilt from scratch between page visits (correct, just wasted
  work).
- Module numbers in a doc depend on panel order across all pages (firstNumbers), so the
  two-station smoke expectations change if the example's panels are reordered.

