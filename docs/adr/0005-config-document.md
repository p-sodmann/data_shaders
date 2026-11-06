# ADR-0005: Stations and layout live in one config document

Status: accepted · 2026-11-05

## Context

Users should be able to monitor several servers and arrange pages from the existing
instruments. Today the station settings are globals in `src/config.js`, and the pages are
hardcoded JSX.

## Decision

One JSON document (a "cartridge") describes the device. It is validated with **zod**.

```json
{
  "version": 1,
  "device": { "finish": "graphite", "fps": 60, "dpr": 2, "cycle": 0, "locked": false },
  "prometheus": { "url": "/prom" },
  "stations": [
    {
      "id": "api",
      "name": "API-01",
      "source": { "kind": "prometheus", "station": "api" },
      "thresh": { "warn": 25, "crit": 35 },
      "slo": { "target": 0.995, "days": 30 },
      "home": { "lat": 50.1, "lon": 8.7 }
    },
    { "id": "sim", "name": "INFERENCE-01", "source": { "kind": "sim", "hosts": 32, "seed": 1 } }
  ],
  "pages": [
    {
      "id": "tape",
      "name": "Tape",
      "panels": [
        { "id": "p1", "type": "tape", "station": "api", "x": 0, "y": 0, "w": 8, "h": 5, "options": {} }
      ]
    }
  ]
}
```

- **Station** fields other than `id`, `name` and `source` are optional overrides. Defaults
  come from today's `config.js` values. Endpoints, stages, regions and nodes are
  **discovered** for Prometheus stations and taken from the built-in tables for `sim`.
- **Panel**: `type` is a key in the instrument registry. `station` is required for
  per-station instruments and absent for cross-station ones. Positions are on a grid of
  **12 columns × 8 rows** that fills the deck area. Panels may not overlap.
- **Load order** (first match wins): `?config=<url>`, then `localStorage["mars.config"]`, then
  `/config/mars.json` (the Docker volume), then the built-in default (today's 5 pages bound to
  one `sim` station).
- Every saved document has `version`. Loaders migrate older versions forward with explicit
  functions in `web/src/config/migrations.js`.
- Existing URL parameters (`fps`, `dpr`, `finish`, `page`, `cycle`) still work as overrides.

## Consequences

- The built-in default document is the regression baseline. Until step 07, it must reproduce
  today's five pages.
- Layouts made for one screen aspect ratio may look cramped on another. We accept this for now.
