# MARS / PULSE

An experimental React + Canvas 2D instrument for visualizing remote-system telemetry as a living particle field.

## Run

```bash
npm install
npm run dev
```

Open the URL printed by Vite.

## Features

- Particle field animated with `requestAnimationFrame` (410 independently moving points).
- Fake telemetry sampled on an independent timer. Visual motion continues when the source is paused.
- Control simulated-source pause, motion amplitude, CRT scanline intensity, and phosphor palette.
- Click the central instrument to inspect its mappings. Fullscreen mode.
- Responsive instrument layout; high-DPI canvas resize via `ResizeObserver`.

## Connecting real data

Replace `createFakeSource()` in `src/main.jsx` with an adapter that supplies:

```ts
type Telemetry = {
  timestamp: number;
  latency: number; // milliseconds
  throughput: number; // requests per second
  error: number; // percent
  heat: number; // normalized 0-1; optional anomaly score
  incident: boolean;
};
```

For example, ingest JSON data via a WebSocket and assign it to `targetRef.current`. Interpolation happens in the animation loop. The graphical waveform and particle agitation are *artistic mappings* of numerical telemetry, not a literal time-series plot. For diagnostic applications, add a separate true time-series instrument.

## Known deliberate constraints

This is a visual prototype, not production observability: no persistence, time-range queries, or trusted backend. Pausing holds the instrument input while subtle ambient movement continues. The readouts and particle field receive the same sampled source.
