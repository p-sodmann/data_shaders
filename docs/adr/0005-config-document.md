# ADR-0005: Stations and layout live in one config document

Status: accepted · 2026-11-05 · amended 2026-11-06 (step 06: poll source, `*` binding, legacy URL in the load order; step 07: `endpoints` and `stages` overrides)

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

- **Station** fields other than `id`, `name` and `source` are optional overrides (`thresh`,
  `slo`, `home`). Defaults come from today's `config.js` values. Endpoints, stages, regions
  and nodes are **discovered** for Prometheus stations and taken from the built-in tables for
  `sim` and `poll`.
- Prometheus stations take two more overrides, which other kinds ignore *(added in step 07)*:
  `endpoints: [{ route, slo }]` (P95 SLO in ms for a route, listed even before it has
  traffic; without it a route's SLO is 2 × its observed 4-hour P95, rounded) and
  `stages: ["ingress", …]` (pipeline order; stages not listed follow, ordered by name).
  Entities that appear later fill spare slots ([ADR-0007](0007-runtime-entities.md)).
- **Source kinds:** `{ kind: "sim", hosts, seed?, speed? }`,
  `{ kind: "prometheus", station }` and `{ kind: "poll", url, hosts }`. `poll` is a custom JSON
  endpoint polled once per second (the payload in `web/README.md`), so feeds that don't go
  through Prometheus keep working. *(Added in step 06.)*
- Station ids match `[A-Za-z0-9][\w.-]{0,31}`: they appear in panel bindings and in IndexedDB
  keys.
- **Panel**: `type` is a key in the instrument registry. `station` is required for
  per-station instruments and absent for cross-station ones. `station: "*"` binds an
  instrument with registry scope `either` (the event log, from step 06) to every station at
  once. Positions are on a grid of **12 columns × 8 rows** that fills the deck area. Panels may
  not overlap. Station, page and per-page panel ids are unique. Unknown keys are dropped on
  load, except inside a panel's `options`, which belong to the instrument and are kept.
- **Load order** (first match wins): `?config=<url>`, then the legacy station parameters
  (`?source=`, `?station=`, `?hosts=`, `?speed=`, read as a v0 document), then
  `localStorage["mars.config"]`, then `/config/mars.json` (the Docker volume), then the
  built-in default (today's 5 pages bound to one `sim` station). A source that exists but
  doesn't validate is skipped with a console warning. Documents from the URL are read-only:
  they are not saved to localStorage unless the user saves them.
- Every saved document has `version`. Loaders migrate older versions forward with explicit
  functions in `web/src/config/migrations.js`. A document without `version` is v0: the
  pre-document device, one station described by the legacy fields above.
- Existing URL parameters (`fps`, `dpr`, `finish`, `page`, `cycle`) still work as overrides.
  They apply to the session only and are never written into the document. `page` is not a
  document field.

## Consequences

- The built-in default document is the regression baseline. Until step 07, it must reproduce
  today's five pages.
- Layouts made for one screen aspect ratio may look cramped on another. We accept this for now.
