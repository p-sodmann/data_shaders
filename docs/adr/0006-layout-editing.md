# ADR-0006: Layout editing with react-grid-layout

Status: accepted · 2026-11-05

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

## Alternatives considered

- gridstack.js: fine, but not React-native.
- dockview / flexlayout: split-pane IDE style, which doesn't fit a fixed device faceplate.
