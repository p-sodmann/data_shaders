# Step 08: Service panel (layout editing)

Status: todo
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

- [ ] Every interaction above works with the mouse. Keyboard: `E`, `Esc`, undo/redo, and
      `Delete` removes the selected module.
- [ ] Overlapping or out-of-bounds placement is impossible. A full page is reported on the bay.
- [ ] The layout persists across reloads, and a `?config=` document is not overwritten until
      "Save as local" is chosen (show that state on the panel).
- [ ] Locked mode can't be entered by accident (`E` ignored). Long-press unlock works.
- [ ] The screenshots in the handoff (edit mode, bay open, settings plate) fit the device's
      visual language. No generic web UI controls are visible without styling.
- [ ] vitest and smoke pass.

## Out of scope

Station management (step 09).
