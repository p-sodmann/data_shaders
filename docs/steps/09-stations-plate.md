# Step 09: Stations plate and cartridges

Status: todo
Depends on: 07, 08
Read first: [ADR-0002](../adr/0002-prometheus-backend.md), [ADR-0005](../adr/0005-config-document.md)

## Context

Stations can be Prometheus-backed (step 07), and pages can be edited (step 08), but stations
still have to be added by editing JSON.

## Goal

A **stations plate** in the service panel for adding, configuring and removing stations, with
discovery from Prometheus. Also export and import of the whole document as a cartridge file.

## Design

- **Opening it:** a `STATIONS` key in the service panel opens the plate, an engraved table, one
  row per station:
  lamp (live / stale / no data) · name · source (`PROM api` or `SIM #2`) · nodes · RPS ·
  edit · remove.
- **Discovery:** an "Available" section lists the values of
  `GET {prometheus}/api/v1/label/station/values?match[]=mars_info` that don't have a station
  yet. Each shows a live P50 and RPS readout (a single query) and an `ADD` key. Adding creates
  `{ id, name: VALUE-01 upper-cased, source: { kind: 'prometheus', station } }` and offers
  "also add standard pages".
- **Edit station:**
  - name
  - thresholds (`warn`, `crit`, `errWarn`, `errCrit`, `satWarn`, `satCrit`, scale maximums)
  - SLO (target, days)
  - home location (lat/lon, or pick from the regions table)
  - per-endpoint SLO overrides, listing the discovered routes
  - pipeline stage order
  Every field shows its default when empty. Fields are validated by the zod schema, and an
  invalid value is shown on the field.
- **Removing a station** that panels still use asks to either remove those panels or rebind
  them to another station.
- **Prometheus URL:** an editable field on the plate (`doc.prometheus.url`) with a connection
  lamp (`/api/v1/status/buildinfo`).
- **Cartridges:**
  - `EXPORT` downloads `mars-<date>.mars.json`.
  - `IMPORT` accepts a file (or drag and drop onto the device), shows a summary (stations and
    pages, plus validation errors), then replaces or merges the current document.
  - `RESET` returns to the default document (with confirmation).
  - Imports run the migrations.

## Tasks

1. The stations plate UI, in the same visual language as step 08.
2. A discovery client (reuse the step 07 Prometheus client).
3. Export, import with merge, and reset.
4. The "remove station still in use" flow.
5. Smoke test: with a recorded Prometheus fixture served by the preview server (mock the `/prom`
   routes in Playwright), discover `api`, add it with its standard pages, export, reset, import,
   and check the result is the same.

## Acceptance criteria

- [ ] Against the live demo stack, both demo stations appear under Available. Adding one shows
      live data within 5 s and a filled tape after the backfill.
- [ ] Threshold edits take effect live (the lamp and bar colours change) without losing the
      tape.
- [ ] Export, reset, import round-trips to an identical document (deep-equal, checked in vitest).
- [ ] Importing an invalid file shows readable errors and changes nothing.
- [ ] vitest and smoke pass.

## Out of scope

Prometheus scrape-target management. Adding a server to Prometheus stays a file in
`deploy/prometheus/targets/`. Note in open questions whether MARS should manage that.
