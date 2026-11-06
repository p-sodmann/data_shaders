# ADR-0006: Layout editing with react-grid-layout

Status: accepted · 2026-11-05 · amended 2026-11-06 (step 08: how react-grid-layout is used)

## Decision

- Pages are rendered as CSS grids from panel `x/y/w/h` ([ADR-0005](0005-config-document.md)).
  View mode doesn't depend on any grid library.
- Edit mode (the "service panel", key `E`) uses **react-grid-layout** for dragging, resizing,
  collision handling and min/max sizes. We style its handles to look like the device.
  Nothing from its default look should show.
- Each instrument's registry entry declares `minW`, `minH`, `defaultSize` and an optional
  `aspect`. The editor enforces them.
- The WebGL engine already supports screens that mount and unmount dynamically
  (`engine.add(el, inst)` returns a disposer). Edit mode may pause instrument updates while
  dragging, to save GPU time.

## How it is used *(added in step 08)*

- **react-grid-layout 2.x** (the v2 API: `gridConfig`, `dragConfig`, `resizeConfig`,
  `compactor`, `positionStrategy`). The grid is `cols: 12`, `maxRows: 8`, no compaction with
  collisions blocked (`getCompactor(null, false, true)`), bounded drag, and a row height
  computed from the deck's height.
- **Absolute positioning (`absoluteStrategy`), never CSS transforms.** A transform makes each
  module a stacking context, which would put its glass overlays under the shared WebGL canvas.
  The same rule as in `style.css` applies: nothing above a `.glass` may create a stacking context.
- **None of react-grid-layout's CSS is loaded.** The slots, the drop placeholder and the
  resize notch (a custom `handleComponent` that keeps the `react-resizable-handle` class, so a
  drag doesn't start from it) are styled in `style.css`.
- **The editor is a lazily loaded chunk** (`React.lazy`), so a display that is never edited
  doesn't download react-grid-layout.
- Edits are pure functions on the document (`web/src/config/edit.js`). The doc store validates
  the result and keeps an undo stack of 50 frozen snapshots.

## Alternatives considered

- gridstack.js: fine, but not React-native.
- dockview / flexlayout: split-pane IDE style, which doesn't fit a fixed device faceplate.
