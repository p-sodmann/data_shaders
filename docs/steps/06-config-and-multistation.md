# Step 06: Config document and multi-station runtime

Status: todo
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

- [ ] `npm test` (vitest) and `npm run smoke` pass, including the two-station config.
- [ ] An old URL, `?source=/telemetry.json&station=edge-eu-2&hosts=48`, still works through the
      v0 migration.
- [ ] With the two-station example, `T` (inject incident) affects the station shown on the
      current page. If there is more than one, a key `Shift+T` cycles which station gets it.
      The lamp shows the worst one.
- [ ] Editing the doc in the devtools console (`window.__mars.setDoc(...)`, a debug handle) adds
      or removes a station live without a reload or errors.
- [ ] Memory and CPU are reasonable with 4 sim stations on one page. Report the frame time in the
      handoff.

## Out of scope

The Prometheus source (step 07) and the edit UI (steps 08 and 09).
