# Step 08: Service panel (layout editing)

Status: done
Depends on: 06
Read first: [ADR-0005](../adr/0005-config-document.md), [ADR-0006](../adr/0006-layout-editing.md), the project vision (cassette futurism, Braun/Rams device, colour only as signal)

## Context

Pages are data in a persisted document (step 06). Users should be able to build pages from the
existing instruments without editing JSON.

## Goal

An in-device edit mode, the **service panel**. Pressing `E` "opens the housing": modules become
movable and resizable, an instrument tray appears, and each module has a settings plate.

## Design

- **Entering and leaving:** `E` toggles, `Esc` leaves. A physical key `SERVICE` sits in the key
  row. While `doc.device.locked` is true, `E` does nothing, and unlocking needs a long-press
  (2 s) on the SERVICE key or `?unlock=1`. This keeps a wall display from being changed by
  accident.
- **Look:** in edit mode the deck shows a faint engraved 12 × 8 grid (dots at the intersections).
  Modules get corner screws and a drag handle on the label strip. Resize handles are engraved
  notches at the bottom-right. No default react-grid-layout styling may show. Colour stays signal
  only: the selection highlight is a raised bezel or engraving, not a coloured outline.
- **Grid editing (react-grid-layout):** `cols=12`, a fixed 8 rows (`maxRows=8`,
  `compactType=null`, `preventCollision=true`). Row height is computed from the deck's height so
  the grid fills the deck. Per-panel `minW`/`minH` come from the registry. `aspect` is a hint
  shown while resizing, not a hard lock. Changes are written to the doc store on drop.
- **Instrument tray ("module bay"):** a drawer below or beside the deck that lists the registry
  entries as small engraved faceplates (number, name, a one-line "reads as" description, and the
  `needs` badges). Drag one onto a free spot in the grid, or click it to place it in the first
  free spot that fits `defaultSize`. If the page is full, say so on the bay.
- **Settings plate:** selecting a module opens a plate with:
  - a station selector (lists `doc.stations`, with a live lamp per station)
  - the instrument's options, rendered from its registry `options` schema (types: `enum`,
    `number`, `boolean`, `string`)
  - remove module, duplicate, and "swap instrument" (keeps the position)
- **Pages:** in edit mode the page keys get `+` (new page with the name `PAGE N`), rename (inline
  engraved text field), move left or right, and delete (with confirmation). There is also
  "Add standard pages for station…", which generates today's five pages bound to a chosen station
  from `DEFAULT_PAGES`.
- **Undo:** `Ctrl/Cmd+Z` and `Shift+Ctrl/Cmd+Z` with an undo stack of document snapshots (50
  deep) in the doc store.
- **Performance:** while dragging, instruments may skip `update()`. Screens keep their last
  frame.

## Tasks

1. Add the `react-grid-layout` dependency. Write the `EditableDeck` component, which wraps the
   same `PageView` panel rendering in edit mode.
2. The module bay, the settings plate, page management, and the options schema in every registry
   entry where options make sense (at least: `readout.signal`, `log.station: 'all'`, `tape`
   lines on or off if available).
3. Undo/redo in the doc store, and the lock and unlock behaviour.
4. Smoke test: a scripted session that enters edit mode, adds a radar from the bay, moves it,
   changes its station, leaves edit mode, reloads, and checks that the layout persisted.

## Acceptance criteria

- [x] Every interaction above works with the mouse. Keyboard: `E`, `Esc`, undo/redo, and
      `Delete` removes the selected module.
- [x] Overlapping or out-of-bounds placement is impossible. A full page is reported on the bay.
- [x] The layout persists across reloads, and a `?config=` document is not overwritten until
      "Save as local" is chosen (show that state on the panel).
- [x] Locked mode can't be entered by accident (`E` ignored). Long-press unlock works.
- [x] The screenshots in the handoff (edit mode, bay open, settings plate) fit the device's
      visual language. No generic web UI controls are visible without styling.
- [x] vitest and smoke pass.

## Out of scope

Station management (step 09).

## Handoff

**Built**

- [web/src/ui/service/EditableDeck.jsx](../../web/src/ui/service/EditableDeck.jsx): the deck in
  edit mode. react-grid-layout 2.x wraps the same `Panel` that `PageView` renders (now exported
  from [PageView.jsx](../../web/src/ui/PageView.jsx) with a caller-supplied `style`). `cols 12`,
  `maxRows 8`, `getCompactor(null, false, true)` (no compaction, collisions blocked), bounded drag,
  `absoluteStrategy`. The row height comes from the deck's height (ResizeObserver), and the gaps
  from the view-mode CSS (2.4 / 1.8 vmin). It draws engraved dots at the gap crossings, a mounting
  plate with three screws per module, a grip on the label strip (the drag handle) and a notch at
  the bottom-right (the resize handle). While a module is resized it shows `W × H` (plus
  `aspect` when the registry has one). Writes go to the document on drop or resize-stop only.
- [web/src/ui/service/ModuleBay.jsx](../../web/src/ui/service/ModuleBay.jsx): all 25 registry
  entries as faceplates (number, name, default size, a "reads as" line, `needs` badges and
  *All stations* for scope `either`). Click places the instrument at its default size, or the
  largest size down to its minimum that fits. HTML5 drag drops it on the deck. A faceplate that
  can't fit reads `NO ROOM`, and the bay says `PAGE FULL` when none can. Otherwise it shows
  `N FREE CELLS`.
- [web/src/ui/service/SettingsPlate.jsx](../../web/src/ui/service/SettingsPlate.jsx): the
  station selector (one row per `doc.stations` entry with a live lamp from `store.status`, plus
  *All stations* (`'*'`) for scope `either`), the option controls rendered from the registry
  schema ([controls.jsx](../../web/src/ui/service/controls.jsx): `enum` → latching keys,
  `boolean` → one latching key, `number` → `−` window `+`, `string` → engraved field), and
  Remove / Duplicate / Swap.
- [web/src/ui/service/Workbench.jsx](../../web/src/ui/service/Workbench.jsx): the deck and the
  service column (cartridge state, *Save as local*, Undo, Redo, Lock, refusal notice, the
  settings plate or the standard-pages chooser, the bay). `Delete` / `Backspace` removes the
  selected module. The whole folder is a lazy chunk (83.6 kB, 26.8 kB gzip). The main bundle
  went from 391.7 kB to 403.4 kB (+11.7 kB).
- [web/src/config/edit.js](../../web/src/config/edit.js): pure document edits (`fits`,
  `findSpot`, `placeFor`, `freeId`, `addPanel`, `placePanels`, `updatePanel`, `removePanel`,
  `duplicatePanel`, `swapPanel`, `addPage`, `renamePage`, `movePage`, `deletePage`,
  `addStandardPages`, `setLocked`, `MAX_PAGES`). The store validates every result.
- [web/src/config/store.js](../../web/src/config/store.js): `undo()`, `redo()`, `canUndo`,
  `canRedo` (50 frozen snapshots; a refused `setDoc` isn't recorded; a new change drops the redo
  branch), and `getMeta() → { origin, readOnly, canUndo, canRedo }`, a snapshot with stable
  identity for `useSyncExternalStore`. The first write to localStorage now switches `origin` to
  `'local'`.
- [web/src/gl/engine.js](../../web/src/gl/engine.js): `engine.hold(on)`. While held, screens
  skip the instrument and post passes and composite their last frame at the glass's current
  rectangle (stretched while resizing). The deck holds during drag and resize, and releases on
  stop and on unmount.
- [web/src/App.jsx](../../web/src/App.jsx): the `SERVICE` key (`E`, latching; on a locked device
  it reads `Service · hold`, and a 2 s press fills a bar under the cap and opens the panel),
  `E` / `Esc`, `Ctrl/Cmd+Z`, `Shift+Ctrl/Cmd+Z`, `Ctrl+Y`. In edit mode the key row swaps A/F/T/S/B
  for the page keys: `+` New page, `◀` / `▶`, `✎` Rename (inline engraved field on the page key),
  `✕` Delete (*Press again* within 3 s), and `▦` Std pages. Auto-cycle pauses while the housing
  is open. `Key` moved to [device.jsx](../../web/src/ui/device.jsx) (it gained `disabled`,
  `className` and pass-through props).
- Registry: a `reads` line on every entry, and `tape.options.limits` (boolean, default on) that
  hides the warn/crit lines in the shader ([tape.js](../../web/src/instruments/tape.js),
  `uLimits`) and their labels in the overlay.
- Tests: [web/test/edit.test.js](../../web/test/edit.test.js) (17 tests: placement, panel and
  page edits, standard pages, undo depth and branches, meta snapshot, URL document until
  `save()`). [smoke.mjs](../../web/scripts/smoke.mjs) has the scripted session from task 4, plus
  the lock check.
- Docs: [web/README.md](../../web/README.md) (service panel section, keys, `?unlock=1`,
  architecture, the registry example). [ADR-0006](../adr/0006-layout-editing.md) amended with
  how react-grid-layout is used (see deviations).

**Deviations**

- **react-grid-layout 2.3 (the v2 API)**, not the v1 props named in the step
  (`maxRows`, `compactType=null`, `preventCollision`). The same behaviour comes from
  `gridConfig.maxRows`, `getCompactor(null, false, true)` and `dragConfig.bounded`.
  `legacy` (1.5.4) was the other choice, but v2 is the maintained line.
- **Absolute positioning, no RGL CSS.** CSS transforms (RGL's default) make each module a
  stacking context, which would put the glass overlays under the WebGL canvas (the rule at the
  top of `style.css`). This is written into ADR-0006 as an amendment. It doesn't change a contract.
- **The editor is lazy-loaded**, so wall displays don't download it. On the first `E` the deck
  shows empty for one frame while the chunk loads.
- **The long-press unlock is per session and ends when the housing closes.** `?unlock=1` lasts
  for the page's lifetime. Leaving the service panel locks a locked device again, so a wall
  display can't be left open by accident. The `Lock` latch on the panel sets
  `doc.device.locked`, and it is undoable like any other edit.
- **"All stations" for the event log is the `'*'` binding** from step 06, offered as a row in
  the station selector. No `options.station` was added (step 06 had already decided this).
  The tape option is called `limits` ("Limit lines": warn and crit lines plus labels).
- **Swap drops the old options** (they belong to the old instrument) and grows the panel to the
  new instrument's minimum if the cells next to it are free. Otherwise it is refused with
  `<type> needs W × H cells here`. Swapping to an instrument without scope `either` turns a
  `'*'` binding into the first station.
- **Clicking a bay faceplate** uses the default size, or shrinks to the largest size down to the
  minimum that fits (the step only names `defaultSize`). A drop uses the default size at the
  drop point, then the minimum size there, then refuses with a notice.
- **"Add standard pages" is refused when it would pass 9 pages** (the schema's cap). On the
  built-in document (5 pages) it says `no room for 5 more pages (5 of 9 used)` until two pages
  are deleted. See open questions.
- **Undo covers every accepted document change,** console `setDoc` and Lock included, not just
  panel edits. The history lives in memory only.
- **Delete confirmation** is a second press within 3 s, with the key's label reading
  *Press again*. There's no dialog, because a dialog would be a generic web UI control.
- New page ids are `page-N` (the name is `PAGE N`). Standard page ids are `<station>-tape`
  and so on, or `<station>2-…` when those ids are taken.
- `web/README.md` still said `window.__MARS__.stats()` in one place. Fixed to `__mars`.

**Verification**

```
$ cd web && npm run build
dist/assets/Workbench-Bswu1pDo.js   83.65 kB │ gzip:  26.82 kB
dist/assets/index-BhE2VckQ.js      403.42 kB │ gzip: 140.18 kB      (was 391.71 kB before the step)

$ npm test
 Test Files  6 passed (6)
      Tests  82 passed (82)          (65 before; 17 new in test/edit.test.js)

$ npm run smoke
✓ page 1 … page 5, two stations page 1–4, legacy URL           (unchanged)
✓ 50 page switches  GPU objects unchanged (screens 9, textures 53, framebuffers 45, programs 14, buffers 3; peak textures 53)
✓ service panel  page added, radar placed, moved, rebound, saved, reloaded; locked E ignored  → snapshots/service-*.png
smoke: ok

$ cd probe && uv run pytest -q                        → 26 passed, 1 skipped
$ uv run ruff check . && uv run ruff format --check . → All checks passed! / 19 files already formatted
$ cd examples/demo && uv run pytest -q                → 14 passed
$ bash probe/scripts/test-rules.sh                    → SUCCESS
$ podman-compose -f deploy/compose.yaml config        → ok (docker compose isn't installed here)
```

These Playwright scripts are in the session scratchpad, not the repo. They ran against
`vite preview` with SwiftShader at 1920 × 1080, with no console errors in any run.

```
flow (?config=two-stations):
  cartridge: URL cartridge · not saved | save key: true
  pages Twin,Sweep,Signal,Almanac,PAGE 5
  after add    radar 0,0 5×6 station main
  after drag   radar 3,0 5×6                       (by the label strip)
  sizeplate: 4 × 4  → after resize radar 3,0 4×4   (by the notch)
  station search | header "Proximity · SEARCH-01"
  after drop   readout 0,5 2×2                     (HTML5 drag from the bay)
  Ctrl+Z → 1 panel, Ctrl+Shift+Z → 2 panels
  Save as local → "Saved on this display"; Esc closes; reload without ?config= → origin local, layout intact
lock / pages (default doc):
  locked: E ignored, click ignored, 1 s press ignored, 2.2 s press opens; closing re-locks; ?unlock=1 opens
  full page: click on a faceplate changes nothing, bay "Page full"
  swap readout → log refused "log needs 3 × 2 cells here"; → budget ok (options dropped)
  tape limits off → options {"limits":false}, WARN/CRIT labels gone
  duplicate tape refused "no free 8 × 6 spot on this page"; Delete removes tape; Cmd+Z restores it
  std pages refused at 5+5 > 9; after deleting 2 pages → main-tape … main-almanac appended, view on page 4
  ◀ moves the page and the view follows; ✕ needs two presses
collisions (page 1, full): drag latency onto throughput, drag log below the deck, resize load past
  the right edge, resize tape into the readouts → document unchanged in all four
GPU: stats before and after 20 E toggles both {"screens":9,"textures":53,"framebuffers":45,"programs":14,"buffers":3}
```

Screenshots: `web/snapshots/service-edit.png` (edit mode with the bay open, two-station example
page 1) and `web/snapshots/service-settings.png` (a radar on a new page, its settings plate,
bay with `NO ROOM` on the tape), both made by smoke. In the session scratchpad:
`edit-selected.png` (graphite, page 1 full, readout selected with its signal keys, `PAGE FULL`),
`ivory-settings.png` (ivory, tape selected with its *Limit lines* key), `flow-resizing.png`
(the size plate), `lock-holding.png` (the hold bar under `SERVICE`) and `narrow-edit.png`.

**Not verified / needs a person**

- Design sign-off. I compared the screenshots against the design rules: no coloured selection,
  no default RGL look, every control styled, and colour only on lamps and the amber refusal
  notice. Someone who owns the look should still judge the screws, grip, notch and dot grid at
  real size.
- Real-GPU frame time while dragging (SwiftShader only). With `hold()` on, a drag costs one
  composite per screen per frame.
- Touch input. RGL v2 supports touch drag, but the HTML5 drag from the bay doesn't work on
  touch screens (clicking a faceplate does). Not tried on a touch device.
- Firefox and Safari. Only Chromium was tested. The HTML5 drop sets `text/plain` data for Firefox.
- The `number` and `string` option controls. No registry entry uses them yet, so they were only
  built, not seen.
- Portrait and narrow screens: the service column moves under the deck, but the device is still
  wider than the viewport. That was true before this step (open question resolved as a CSS
  follow-up to steps 05/06). In edit mode the key row is longer, so it overflows more.

**Notes for later steps**

- Step 09: the stations plate belongs in the service column of
  [Workbench.jsx](../../web/src/ui/service/Workbench.jsx), next to the standard-pages chooser.
  Use `edit(fn)` for changes: it returns `false` and shows the store's first error line on the
  panel. `StationLamp` and `Field` / `Stepper` / `Row` in
  [controls.jsx](../../web/src/ui/service/controls.jsx) are reusable for station fields.
  Station edits recreate the station (unchanged), and they are on the undo stack too.
- Step 12 (config PUT): the panel's *Save as local* is the place to add a *Save to server*
  key. `docStore.getMeta()` is where a "server" origin state would show.
- Anything above a `.glass` must not create a stacking context. In edit mode that includes the
  RGL item and its placeholder. Keep `absoluteStrategy`.
- New registry entries need `reads` (bay faceplate) and real `minW` / `minH` / `defaultSize`.
  The editor enforces them.
- `engine.hold()` is global: everything held freezes, including the header tubes.
