# Step 05: Instrument registry and grid pages

Status: todo
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

- [ ] `npm run build` and `npm run smoke` pass. The smoke test's module header check still
      finds all module names.
- [ ] Screenshots are visually close to step 04's. List any noticeable proportion changes in
      the handoff.
- [ ] `App.jsx` has no `page === n` branches and imports no instrument factories directly.
- [ ] Switching pages 50 times (scripted in the smoke test or by hand) doesn't grow the GPU
      resource count. Expose a debug counter from the engine (screens, textures, framebuffers)
      and check it.
- [ ] A panel with `type: 'nope'` shows `NO MODULE` and logs one warning.

## Out of scope

Loading pages from a document or storage (step 06), editing (step 08).
