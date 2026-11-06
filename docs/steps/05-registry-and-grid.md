# Step 05: Instrument registry and grid pages

Status: done
Depends on: 04
Read first: [ADR-0005](../adr/0005-config-document.md), [ADR-0006](../adr/0006-layout-editing.md)

## Context

The pages are hardcoded JSX blocks (`{page === n && …}` in `App.jsx`) with per-page CSS grids
(`.deck.pN` / `.bank.pN` in `style.css`). To let users compose pages, the page structure has
to be data.

## Goal

An **instrument registry**, and a **page renderer** that lays out panels on a 12 × 8 grid from
a page definition. The five current pages are re-expressed as data and look as close to today
as possible.

## Design

```js
// web/src/instruments/registry.js
export const REGISTRY = {
  tape: {
    name: 'Tape archive',        // module header text
    scope: 'station',            // 'station' | 'device' (cross-station instruments come in step 10)
    create: (station, options) => createTape(station, options),
    overlay: TapeOverlay,        // optional React component rendered inside the glass
    needs: [],                   // e.g. ['endpoints'], ['stages'], ['regions'], ['almanac']
    minW: 4, minH: 3, defaultSize: [8, 5], aspect: null,
    options: {},                 // option schema, used by step 08: { key: { type, default, label } }
  },
  // … one entry per instrument currently mounted in App.jsx (status and clock are part of the
  // housing, not panels)
};
```

- The three readouts (latency, throughput, errors) become **one** registry type, `readout`,
  with `options.signal: 'latency' | 'throughput' | 'errors'`. The `createReadout` presets move
  into the registry.
- **Instances:** the page renderer creates instrument instances with `useMemo` keyed by
  `(panel.id, panel.type, panel.station, JSON.stringify(panel.options))`. Instances for
  panels that aren't mounted are dropped. Screens unmount through the existing `engine.add`
  disposer. Check that instruments with GPU resources release them, and add a `dispose()`
  hook to the instrument interface if needed.
- **Module numbering:** module numbers (`01`…) are assigned in panel order across pages, so
  they stay stable for a given document.
- **Grid:** `.deck` becomes a CSS grid with `grid-template-columns: repeat(12, minmax(0,1fr));
  grid-template-rows: repeat(8, minmax(0,1fr))`. Each panel is placed with
  `grid-column: x+1 / span w; grid-row: y+1 / span h`. Gaps and bezels stay as they are. The
  current narrow-screen media query can collapse to a single column stacked in panel order.
- **Preset:** `web/src/config/presets.js` exports `DEFAULT_PAGES`, today's five pages as
  `[{ id, name, panels: [{ id, type, station: 'main', x, y, w, h, options }] }]`. Choose
  coordinates that match today's proportions as closely as the 12 × 8 grid allows.
- Page keys `1`–`9`, `←`/`→` and auto-cycle work from `pages.length`.

## Tasks

1. Build the registry for all ~27 instruments. Move the overlays out of `App.jsx` into
   `web/src/instruments/overlays/` (one file each, or grouped).
2. Build `PageView({ page, stations })` using the existing `Module` and `Screen` components.
3. Write `DEFAULT_PAGES`, replace the hardcoded page JSX, and delete the `.deck.pN` /
   `.bank.pN` / `.stack` / `.side` rules that are no longer used.
4. Unknown panel types or missing stations render as an empty module with the engraved text
   `NO MODULE` / `NO SIGNAL`. They must not crash.
5. Update the "Adding an instrument" section of `web/README.md`.

## Acceptance criteria

- [x] `npm run build` and `npm run smoke` pass. The smoke test's module header check still
      finds all module names.
- [x] Screenshots are visually close to step 04's. List any noticeable proportion changes in
      the handoff.
- [x] `App.jsx` has no `page === n` branches and imports no instrument factories directly.
- [x] Switching pages 50 times (scripted in the smoke test or by hand) doesn't grow the GPU
      resource count. Expose a debug counter from the engine (screens, textures, framebuffers)
      and check it.
- [x] A panel with `type: 'nope'` shows `NO MODULE` and logs one warning.

## Out of scope

Loading pages from a document or storage (step 06), editing (step 08).

## Handoff

**Built**

- [web/src/instruments/registry.js](../../web/src/instruments/registry.js): `REGISTRY`, 25 panel
  types. The three readouts are one `readout` type with `options.signal: 'latency' |
  'throughput' | 'errors'`, and their presets (scales from `profile.thresh`) live here. Each entry
  has `name`, `meta`, `scope`, `create`, `overlay`, `needs`, `minW`, `minH`, `defaultSize`,
  `aspect` and `options`. Also exported: `HOUSING` (the status and clock tubes, which are not
  panels), `resolveOptions(def, options)` (fills in schema defaults), `panelName` and `panelMeta`.
- [web/src/instruments/overlays/](../../web/src/instruments/overlays/): `TapeOverlay`,
  `WaterfallOverlay`, `DialOverlay`, `HeatOverlay`, one file each, moved out of `App.jsx`. Props
  are `{ inst, station, snap, options }`.
- [web/src/ui/device.jsx](../../web/src/ui/device.jsx): `EngineContext`, `Screen` and `Module`,
  moved out of `App.jsx` unchanged. `Module` now also passes a `style` through.
- [web/src/ui/PageView.jsx](../../web/src/ui/PageView.jsx): `PageView({ page, stations, first })`
  and `firstNumbers(pages)`. Each panel builds its instrument with `useMemo` keyed by
  `(panel.id, panel.type, station, JSON.stringify(options))` and subscribes to its own station's
  snapshot for live captions and overlays. Unknown type, or a `create()` that throws: `NO MODULE`.
  Missing station: `NO SIGNAL`. Each problem logs one `console.warn('[MARS] …')` per session.
- [web/src/config/presets.js](../../web/src/config/presets.js): `DEFAULT_PAGES`, the five pages
  as data, all bound to station `main`.
- [web/src/gl/engine.js](../../web/src/gl/engine.js): `engine.stats()` returns `{ screens,
  textures, framebuffers, programs, buffers }`, counted by wrapping the context's create and
  delete calls, so the vector painter's and instruments' objects are included. `App` exposes it as
  `window.__MARS__.stats()`.
- [web/src/App.jsx](../../web/src/App.jsx): the housing only. `PAGES = DEFAULT_PAGES`,
  `STATIONS = { main: station }`, one `<PageView key={page.id} …/>`. Page keys `1`–`9`, `←`/`→`
  and auto-cycle use `PAGES.length`.
- [web/src/style.css](../../web/src/style.css): `.deck` is the 12 × 8 grid (row gap 1.8vmin,
  column gap 2.4vmin, the old gaps). A panel is placed through `--gc` / `--gr`. `.bank`, `.side`,
  `.stack`, `.deck.pN`, `.bank.pN` and `.m-log` are deleted. Below 5:4 the deck is one column in
  panel order, and each panel spans `--h` rows, so heights keep their shares.
- [web/scripts/smoke.mjs](../../web/scripts/smoke.mjs): after the five page checks, it presses
  `→` 50 times (150 ms apart) and fails if any `stats()` count differs from before.
- [web/README.md](../../web/README.md): architecture tree, pages-as-data paragraph, and a new
  "Adding an instrument" subsection (registry entry, preset panel, `dispose`).

**Grid coordinates and proportion changes** (compared at 1920 × 1080 with screenshots of the
step 04 build, which has the same bundle hash `index-Dms-B9E5.js` as step 04's handoff)

Rows 0–5 are the old deck and rows 6–7 the old bank, on every page. The other possible split,
5 + 3, would have made the bank about 50 % taller.

- **All pages:** the engraved rule and padding between the deck and the bank are gone. Only the
  normal row gap is left (see open questions). Bank tubes are about 20 px shorter and deck tubes
  about 20 px taller.
- **Page 1:** tape 8 / side 4 columns (was 7.7 / 4.3). Readouts 2 + 2 + 2, log 6 (was about
  2.3 each, log 5.2), so the log is a little wider.
- **Page 2:** orbit 7 / side 5 (was 6.8 / 5.2). Pipeline 5, caution 4, trace 3 (was 5.0 / 3.5 /
  3.5), so trace is visibly narrower than caution. Before, they were the same width.
- **Page 3:** proximity 5 / ground track 7 (was 4.7 / 7.3). Contacts and origins 6 / 6 (same).
- **Page 4:** spectrum and waterfall 7 / X‑Y 5 (was 7.2 / 4.8). Spectrum and waterfall split 3 / 3
  rows (was 1 : 1.3), so the waterfall is shorter and the spectrum taller.
- **Page 5:** dial 4 / habits 8 (was 4.4 / 7.6). Budget 3, burn 5, logbook 4 (was 2.8 / 4.6 /
  4.6), so the logbook is narrower than burn rate.

**Deviations**

- **Registry fields beyond the step's sketch:** `meta` (header caption), and `name` may be a
  function of options. The readout's name and caption depend on `signal`, and three captions are
  live (`Nodes` counts, `Contacts` closing count, `Error budget` SLO days). `meta` functions get
  `{ station, snap, options }`.
- **25 registry types, not about 27:** three readouts became one type, and status and clock are
  `HOUSING`, not panels.
- **Instruments are built when their page mounts,** not all at start-up as before. So
  `station.signal` (page 4 analysis) is now created on the first visit to page 4. It is derived
  entirely from the store's 4 h history, so nothing is lost. No instrument keeps history in its
  own closure (checked: they all read `station.store`, `station.signal` or `station.almanac`).
- **No `dispose()` hook needed.** The engine already called `inst.dispose?.(gl, state)`, and all
  six instruments that allocate textures in `init` (tape, matrix, waterfall, week dial, heatmap,
  dot-matrix panels) free them there. The counter confirms it.
- **A `create()` that throws** (for example `readout` with an unknown `signal`) also shows
  `NO MODULE`, so a bad option can't take the page down.
- **Page ids are strings** (`tape`, `orbit`, `sweep`, `signal`, `almanac`). The `page` state,
  `?page=` and `localStorage["mars.page"]` stay 1-based indices, so saved values still work.
- **The empty bay** is a bezel with no glass and the text engraved in `--ink-faint` with a
  light and dark edge. It isn't registered with the engine, so it costs no GPU time.
- `npm test` doesn't exist in `web/` (only `build` and `smoke`), so it wasn't run.

**Verification**

```
$ cd web && npm run smoke
✓ built in 395ms
✓ page 1  modules 01–07  → snapshots/page-1.png
✓ page 2  modules 08–13  → snapshots/page-2.png
✓ page 3  modules 14–17  → snapshots/page-3.png
✓ page 4  modules 18–22  → snapshots/page-4.png
✓ page 5  modules 23–27  → snapshots/page-5.png
✓ 50 page switches  GPU objects unchanged (screens 9, textures 53, framebuffers 45, programs 14, buffers 3; peak textures 53)
smoke: ok

$ grep -n "page === [0-9]" web/src/App.jsx          → nothing
$ grep -n "^import" web/src/App.jsx                  → react, config, runtime, gl/engine,
    instruments/registry (HOUSING), config/presets, ui/device, ui/PageView; no create* factories

# NO MODULE / NO SIGNAL: throwaway build (outside the repo) with page 1's log narrowed to 3
# columns plus { type: 'fleet', station: 'nowhere' } and { type: 'nope' }; preset restored after
engraved: [ 'NO SIGNAL', 'NO MODULE' ]
nums: 01,02,03,04,05,06,07,08,09         page2 nums: 10,11,12,13,14,15   (numbering runs on)
stats p1 {"screens":9,"textures":53,...}  p2 {"screens":8,"textures":44,...}   (counter follows the page)
warnings after 10 switches: [ '[MARS] panel "ghost": no station "nowhere"',
                              '[MARS] panel "nope": unknown type "nope"' ]   (one each)
errors: []

$ cd probe && uv run pytest -q   → 26 passed, 1 skipped
$ uv run ruff check . && uv run ruff format --check .   → All checks passed! / 19 files already formatted
$ cd examples/demo && uv run pytest -q   → 14 passed
$ bash probe/scripts/test-rules.sh   → SUCCESS
$ podman-compose -f deploy/compose.yaml config   → ok (docker compose isn't installed here)
```

Screenshots: `web/snapshots/page-{1..5}.png` (new, made by smoke). In the session scratchpad,
not the repo: `old-page-{2..5}.png` (step 04 build), `nope-page-1.png` (the empty bays) and
`narrow-page-2.png` (1080 × 1600, single column). I compared pages 1, 2 and 5 side by side by
eye. The housing, captions, overlays (tape times and thresholds, dial labels, habits labels) and
module numbers all match. The differences are the proportion changes listed above.

**Not verified / needs a person**

- No pixel diff. The sim is time-seeded, so live content always differs.
- Pages 3 and 4 were only checked through the smoke run's screenshots, not side by side with the
  old build.
- The empty-bay engraving was only seen in the graphite finish, not ivory.
- Portrait and narrow screens: the deck stacks correctly, but the device is wider than the
  viewport. This was already true before the step (measured: 1156 px at 1080 px in both builds).
  It is in open questions.

**Notes for later steps**

- Step 06: replace `PAGES` / `STATIONS` in `App.jsx` with the document's `pages` and a
  `{ id: station }` map. `PageView` is keyed by `page.id` and panels by `panel.id`, so ids must be
  unique within a page. Module numbers come from `firstNumbers(pages)`, which counts every panel,
  empty bays included.
- Panel instances are rebuilt when `panel.id`, `type`, the station object or the options' JSON
  change. A new station object for the same id rebuilds every panel bound to it.
- Step 08: `minW`, `minH`, `defaultSize` and `options` are in every entry (`aspect` is `null`
  everywhere). The option schema so far is only `readout.signal` (`{ type: 'enum', values,
  default, label }`).
- Step 07: `needs` lists the station tables each instrument reads (`endpoints`, `stages`,
  `regions`, `almanac`).
- A leak shows up in `window.__MARS__.stats()`. The smoke test enforces equality after 50 switches.
- Instruments read `station.store` directly every frame. Only captions and overlays go through
  React (one `useSyncExternalStore` per panel, same rate as before).
