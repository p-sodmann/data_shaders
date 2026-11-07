# Step 10: Cross-station instruments

Status: partial
Depends on: 07 (08 recommended, so they can be placed from the bay)
Read first: [ADR-0005](../adr/0005-config-document.md), `web/README.md` (instrument authoring)

## Context

With single-process uvicorn servers, each station has one node, so the per-station nodes grid
and fleet strands are nearly empty. Across several stations, the interesting view is the set of
servers.

## Goal

Instruments with `scope: 'device'` that show every station at once. They're built on the
existing shaders and vector painter, with no new rendering pipeline.

## Instruments

| Type | Based on | Reads as |
|---|---|---|
| `stationBoard` | the nodes lamp shader (`matrix.js`) | One large lamp per station, engraved with its name. The fill is saturation, the colour is the system state. STALE stations are dark and struck through. Optional small numerals for P50 and RPS. |
| `stationRadar` | `radar.js` | One contact per station. The bearing is fixed by station order, and the range is headroom (worst of P50 vs crit, error rate vs errCrit, saturation vs satCrit). |
| `stationStrands` | `fleet.js` | One latency strand per station over the last 3 min, each normalised to its own crit threshold, so stations with different scales are comparable. |
| `stationLog` | `log` with `station: 'all'` (step 06) | Already exists. Register it in the bay under this group. |

## Tasks

1. Registry support for `scope: 'device'`: these instruments receive the station manager (or a
   read-only list of stations) instead of one station, and they re-render when stations are
   added or removed.
2. Implement the three new instruments. Keep their per-frame cost bounded for at least 16
   stations.
3. Add a page "Fleet" to the Docker default document (`deploy/config/mars.json`) that uses them.
4. Document them in the `web/README.md` instrument tables.

## Acceptance criteria

- [x] With the demo stack, the Fleet page shows both stations. Chaos on one turns its lamp and
      contact amber or orange. Stopping one turns it dark (STALE).
- [ ] With 16 sim stations (an example config), the frame time stays within 10 % of the
      2-station case. Report the numbers.
- [x] Adding or removing a station in the stations plate updates these instruments live.
- [x] vitest and smoke pass.

## Out of scope

Per-station instrument changes.

## Handoff

**Status `partial`:** one criterion is not met as measured here. With 16 stations the frame
time is within 10 % of the 2-station case in CPU time, but not in frame interval under
SwiftShader (software WebGL): it is +12 to +22 %. Between 5 and 16 stations it is flat
(+3 to +6 %), so the cost is bounded; what remains is that 2 stations fill fewer label rows than
the caps allow. Numbers below. It needs a run on a real GPU.

**Built**

- **Device scope (task 1).** The registry and `PageView` already handed `scope: 'device'`
  panels the manager's `device`. Added:
  - `device.subscribe` and `device.getSnapshot` in
    [manager.js](../../web/src/station/manager.js). `LivePanel` in
    [PageView.jsx](../../web/src/ui/PageView.jsx) subscribes to them, so a caption that counts
    stations follows the list.
  - The instruments are built once on the device. Each frame they read `device.stations` and
    every station's `store` (thresholds through `store.profile.thresh`), so added, removed,
    rebuilt (ADR-0007) and retuned (step 09) stations show up on the next frame without
    rebuilding anything.
  - The shared readings are in [instruments/stations.js](../../web/src/instruments/stations.js):
    `stationCode` (lamp code; a loading station reads as STALE), `pressureOf` (worst of
    P50/crit, err/errCrit, sat/satCrit), `numerals` and `stationCount`.
- **`stationBoard`** ([board.js](../../web/src/instruments/board.js)): the `matrix.js` lamp
  shader with one lamp per station.
  - Lamps come from `gridFor` (now exported, with a target lamp aspect of 1.5).
  - The name and the `P50 MS  RPS` line are dot-font text in a second R8 texture, lit on a dark
    plate that the fill doesn't light. Narrow lamps fall back to shorter numerals.
  - The label texture is redrawn and uploaded only when a label or the face size changes.
  - Option `numerals` (boolean, default on).
- **`stationRadar`** ([stationradar.js](../../web/src/instruments/stationradar.js)): one contact
  per station.
  - The scope (rings, bearing scale, beam) moved out of `radar.js` into
    `drawScope(v, f, labels)`; the radar's own behaviour is unchanged.
  - The rings are labelled `CRIT` instead of `SLO`.
  - A stale contact keeps its last range, crossed out and named `… STALE`.
- **`stationStrands`** ([strands.js](../../web/src/instruments/strands.js)): one strand per
  station, P50 / crit over 3 min, each ending at its own station's clock.
- **`stationLog`**: a registry entry that reuses `createLog` on the device. It is the same as a
  `log` bound to `*`.
- **Bay:** the device instruments come last, under an engraved rule *All stations at once*
  ([ModuleBay.jsx](../../web/src/ui/service/ModuleBay.jsx), `.bay-group` in
  [style.css](../../web/src/style.css)), and carry the *All stations* badge.
- **Fleet page:** page 7 of [deploy/config/mars.json](../../deploy/config/mars.json): board 7×4,
  radar 5×6, strands 7×4, log 5×2. There is also a new example,
  [public/examples/sixteen-stations.json](../../web/public/examples/sixteen-stations.json)
  (16 sim stations on three threshold scales, a Fleet page and a Twin page).
- **Frame timing:** `engine.frames()` → `window.__mars.frames()` gives the mean and p95 CPU ms
  per frame over 240 frames ([engine.js](../../web/src/gl/engine.js)). It is separate from
  `stats()`, so the smoke test's GPU comparison is untouched.
- **Tests:** [test/cross-station.test.js](../../web/test/cross-station.test.js) has 10 tests:
  readings, retune through the store, the board layout, the registry entries, device
  subscription, radar and strands picking up stations added and removed after they were built,
  bounded strand segments, and board uploads (one texel per station, no label upload without a
  change, STALE goes dark).
- **Smoke:** a new check, *sixteen stations, Fleet*: modules 01–04, three captions
  `16 stations`, then a station removed with `setDoc` and the captions read `15 stations`.
- **Docs:** [web/README.md](../../web/README.md) (a *Cross-station instruments* table, authoring
  notes for device instruments, `frames()`), [README.md](../../README.md),
  [deploy/README.md](../../deploy/README.md).

**Deviations and decisions**

- **Labels are capped, because beam text is expensive.** In the vector painter every glyph dot
  is one instance. The first version at 16 stations drew ~3,500 text dots per instrument and
  doubled the page's frame interval (68 → 134 ms). Now:
  - the radar names at most 5 contacts (worst state, then least headroom), and every contact is
    still drawn;
  - the strands list shows the 5 stations nearest crit plus `+N MORE`;
  - at most 5 strand tips are named.
- **Strands share a segment budget (400 segments).** With more stations a segment spans several
  seconds and is drawn at the highest P50 among them, so a short spike still shows (16 stations:
  6 s per segment).
- **The board's text is lit on a dark plate**, not engraved into the fill. Cut-out dots inside
  the striped fill weren't legible at 1× (screenshots `16-board-crop.png`).
- **"Saturation" is the station sample's `saturation`.** It is `mars:saturation_ratio` for
  Prometheus stations, and near 0 on the demo, so the demo's lamps are nearly empty. That is
  honest; the 16-station sim example shows real fills.
- **Colour follows `store.status`** (the lamp's rule from step 07) on the board and the radar.
  The radar's range is pressure, so a contact can be inside the amber ring and still mint until
  the station's hysteresis changes state.
- **The radar's ring labels changed for the device version only** (`CRIT`). `drawScope` takes the
  labels.
- **No ADR change.** The schema already allowed panels without `station`.
- **Bundle:** main 410.4 → 421.9 kB (147.5 kB gzip). No new dependencies.

**Verification**

```
$ cd web && npm run build                 → index 421.94 kB │ gzip 147.52 kB, built
$ npm test                                → Test Files 10 passed · Tests 124 passed (114 before)
$ npm run smoke                           → 14 checks ✓ … ✓ sixteen stations, Fleet modules 01–04 … smoke: ok
$ cd probe && uv run pytest -q            → 28 passed, 1 skipped
$ uv run ruff check . && uv run ruff format --check .  → All checks passed! / 19 files already formatted
$ cd examples/demo && uv run pytest -q    → 14 passed
$ bash probe/scripts/test-rules.sh        → SUCCESS
$ podman-compose -f deploy/compose.yaml config → ok (no docker here)
```

**Live, on the demo stack.** Podman stack; the `vite` dev server proxying `/prom` to `:9090`;
the Docker document served as `?config=` (identical file); Playwright with SwiftShader at
1920 × 1080; page 7.

```
+8 s    api:live:NOMINAL search:live:NOMINAL · captions "2 stations · …" ×3
chaos   POST /_chaos {latency_ms: 60, stage: infer, duration_s: 90} on demo-api
+12 s   api DEGRADED (lamp breathing amber) → +20 s INCIDENT: lamp, contact, strand and list
        entry orange, radar "NEAREST API-01 OVER 106%", strand list "API-01 215%"
stop    podman stop mars_demo-search_1 → search STALE after 12 s: lamp dark and struck through
        with "STALE", contact crossed out "SEARCH-01 STALE", list "STALE", log "SOURCE STALE NO DATA"
start   search NOMINAL again 8 s after start
plate   ✕ on SEARCH-01, drop its panels → all three captions "1 station", board one lamp;
        + Add "search" from Available on Prometheus → "2 stations" again, without a reload
errors  none (console and page)
```

**Frame time.** Fleet page, 16 stations against 2 (the same document cut to its first 2
stations); `?config=` through `page.route`, SwiftShader, 1920 × 1080, dpr 1. Each value is the
mean of 6 readings. `cpu` is `__mars.frames().mean`; `raf` is the measured
requestAnimationFrame interval, which includes SwiftShader's rasterisation.

```
                        2 stations          5 stations          16 stations
before the caps         cpu 9.0–11.7 ms     –                   cpu 10.1–11.6 ms
                        raf 68.7 ms                             raf 134.4 ms (+96 %)
final                   cpu 8.7–13.9 ms     cpu 9.3 ms          cpu 10.3–11.1 ms
                        raf 67.5–73.9 ms    raf 79.7 ms         raf 80.3–89.3 ms (+12 to +22 % vs 2,
                                                                                  +3 to +6 % vs 5)
Twin page (no device instruments): raf 75.0 / 74.7 ms at 2, 75.3 / 75.5 ms at 16
        → running 16 simulators costs nothing measurable; the difference is drawing
each instrument alone, final, raf 2 → 16:  board 16.6 → 16.6 · log 16.6 → 16.6
        · radar 41.8 → 46.7 · strands 24.9 → 31.9 (strands with a 1-row list: 24.6 → 24.7)
GPU objects, 20 switches Fleet ↔ Twin on 16 stations: unchanged (screens 6, textures 35, fbos 30)
```

The CPU time per frame is within noise, and below 16.7 ms in both cases. The frame interval
under software rendering grows with the number of labels drawn, which stops growing at 5
stations.

Screenshots (session scratchpad, not committed): `/private/tmp/claude-501/-Users-philippsodmann-Documents-python-2026-data-shaders/dd574dcc-b049-4070-b6eb-88d712ce8ecb/scratchpad/shots/`
`16-fleet.png`, `16-fleet-2x.png`, `16-board-crop.png`, `10-live-fleet.png`,
`10-live-chaos.png`, `10-live-stale.png`, `10-live-removed.png`, `10-live-added.png`,
`10-bay.png`. Smoke: `web/snapshots/sixteen-fleet.png`.

**Not verified / needs a person**

- **The 10 % frame-time criterion on a real GPU.** On SwiftShader it fails 2 → 16 (above). On
  hardware the extra ~2,000 beam instances should be negligible, but that is not measured. If
  it still matters, the levers are `NAMED` / `LISTED` in the two instrument files (5 now), or
  cheaper painter text (a shared concern, outside this step).
- **The `mars-web` image wasn't rebuilt** (the Podman `npm ci` problem from steps 07–09). The
  live run used the dev server against the stack's Prometheus.
- **Design sign-off.** I checked the screenshots against the rules: colour only for state, CRT
  on every screen, the bay group engraved like the other captions. Someone who owns the look
  should judge the plates behind the lamp text, the 16-lamp density and the ivory finish (not
  looked at).
- Real GPU, Firefox, Safari, dpr 2 on a physical display (only a 2× headless screenshot).

**Notes for later steps**

- Device instruments: build once, read `device.stations` and `s.store` per frame, and never
  copy thresholds (use `store.profile.thresh`). Use `stationCode` for the lamp code, so loading
  and STALE look the same everywhere.
- Text in vector instruments is one instance per glyph dot. Cap labels per station count.
- `drawScope(v, f, labels)` in `radar.js` is the shared PPI scope.
- `__mars.frames()` is there for perf checks. Step 12's CI could record it on the Fleet page.
- Step 11 (regions): a cross-station ground track would fit this group; not in scope here.
- "Database layers" (open questions) were going to fill the board later; the board shows
  stations, not nodes.
