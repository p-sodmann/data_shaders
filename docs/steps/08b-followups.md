# Step 08b: Follow-ups to steps 07 and 08

Status: todo
Depends on: 07, 08
Read first: [ADR-0005](../adr/0005-config-document.md), [ADR-0006](../adr/0006-layout-editing.md), [open-questions.md](../open-questions.md) (the 2026-11-07 decisions)

## Context

The review on 2026-11-07 settled the open questions that steps 07 and 08 left. Most of them
change code that step 09 builds on (adding pages, the document's origin, cartridges), and
step 07 is `partial` until Rhythms finds the demo's batch job. This step builds those
decisions before step 09 starts.

## Goal

Step 07 is done. The service panel has no page cap, a saved copy of a `?config=` document
wins on its display, and undo survives a reload.

## Design

### Pages without a cap

- The schema drops `.max(9)` on `pages` ([schema.js](../../web/src/config/schema.js)), and
  `MAX_PAGES` goes from [edit.js](../../web/src/config/edit.js). "New page" and "Add standard
  pages for station…" always fit.
- Keys `1`–`9` jump to the first nine pages. `←` / `→` (as today) and `[` / `]` step through
  every page, wrapping at the ends. `?page=` accepts any page number.
- The footer shows at most nine page keys: a window around the current page, with an
  engraved `◂` / `▸` mark on the side where more pages are hidden. The keys show their real
  page number, so `12` is visible as `12`, but only `1`–`9` have a keyboard shortcut.
- Auto-cycle (`A`) goes through every page.

### A saved copy of a `?config=` document wins

- *Save as local* on a URL document stores it under `mars.config@<url>` (the `?config=` value
  as given), not under `mars.config`. The plain `mars.config` stays the display's own
  document for loads without `?config=`.
- Load order (ADR-0005): with `?config=<url>`, `localStorage["mars.config@<url>"]` comes
  first, then the URL itself. Without `?config=` nothing changes.
- A document loaded this way has origin `url-local`: it saves like a local document (to its
  own key), and the header shows a `LOCAL` marker next to the cartridge state.
- The service panel gets *Revert to URL*: it deletes the saved copy and its undo history, and
  loads the URL's document again. It is undoable only until the reload.
- The legacy station parameters (`?source=` …) stay read-only and get no saved copy.

### Undo history in localStorage

- The doc store writes its undo and redo stacks next to the document, under
  `mars.undo@<document key>` (`mars.undo@mars.config` or `mars.undo@mars.config@<url>`), in
  the same debounced save.
- At most 50 snapshots (as today). If the stored history is over about 2 MB, the oldest
  snapshots are dropped until it fits. If the write still fails (quota), the history is
  dropped and the document is saved anyway.
- On load the history is used only if its newest snapshot equals the loaded document
  (compared by its JSON). Otherwise it is discarded, for example after the server file
  changed, a shared PUT (step 12), or a different URL.
- A read-only URL document (not saved) keeps its undo in memory only, as now.

### Rhythms fold throughput as well

- The rhythm search in [signal.js](../../web/src/data/signal.js) folds P50 latency and
  throughput. Each found rhythm carries the signal it was found in (`lat` or `thru`). If both
  find the same period, the stronger one counts and the other is noted as `+`.
- The Rhythms readout shows the signal, for example `5m · THRU` or `5m · LAT+THRU`.
- Throughput rhythms leave out incidents the same way latency ones do (minutes above WARN).
- Criterion: on the demo, Rhythms finds the 5-minute `/v1/rank` batch job within about
  25 minutes of continuous data, which closes step 07.

### Auto SLOs don't flap on small routes

- An auto SLO is `max(2 × observed 4-hour P95, station thresh.warn)`, rounded
  (`defaultSlo` in [discover.js](../../web/src/data/prometheus/discover.js) takes the
  station's thresholds). An `endpoints` override is used as given.
- An endpoint is judged only when it has enough traffic: at least 5 req/s, or at least 50
  requests in the 10 s window. Below that it keeps its state, doesn't log state changes, and
  the radar shows it as `LOW N` (dim, not a colour).
- Both thresholds are constants in [telemetry.js](../../web/src/data/telemetry.js), not
  document fields.

### External alerts without a `station` label

- The Prometheus client polls `/api/v1/alerts` once per device (not once per station) every
  10 s and shares the result. Alerts with a `station` label go to that station, as now.
- Firing alerts without a `station` label light a device-level `EXT` lamp in the header and
  log as `EXT ALERT <NAME> FIRING` / `RESOLVED` without a station name, shown by event logs
  bound to `*`.
- They don't change any station's state or its C&W panel.

### Throughput-weighted almanac minutes

- New recording rule `mars:error_ratio:rate1m` (station): `sum by (station)
  (rate(...{code_class="5xx"}[1m])) / sum by (station) (rate(...[1m]))`, absent without
  traffic, like `mars:error_ratio`. The rule gets a promtool test.
- The almanac backfill reads it with `step=60s` instead of
  `avg_over_time(mars:error_ratio[1m])`. ADR-0003 lists the rule.

## Tasks

1. Pages: schema, `edit.js`, App key handling and the footer window, `?page=`, auto-cycle.
   Update the vitest cases that expect the cap.
2. URL copies: `load.js` and the doc store (key per origin, `url-local`, *Revert to URL*),
   and the `LOCAL` marker.
3. Undo persistence in the doc store, with tests for: reload keeps undo, mismatching history
   is dropped, quota failure keeps the document.
4. Rhythms: throughput fold, the signal on each rhythm, the readout. A vitest case with a
   synthetic throughput-only rhythm.
5. Auto SLO floor and the minimum-traffic rule, with a test on the `/v1/models` fixture case.
6. Device-level alerts: shared alert poll, header lamp, device log line.
7. The `mars:error_ratio:rate1m` rule, its promtool test, and the almanac query.
8. Update ADR-0003, ADR-0005, ADR-0006, [web/README.md](../../web/README.md) (keys) and step 07's
   status.

## Acceptance criteria

- [ ] A document with 15 pages loads and validates. "Add standard pages" works on the
      built-in document. `1`–`9`, `←`/`→`, `[`/`]` and the footer reach every page.
- [ ] After *Save as local* on `?config=/examples/two-stations.json`, a reload of the same link
      shows the edited document with `LOCAL`. *Revert to URL* brings back the file's version.
      Opening without `?config=` still shows the display's own document.
- [ ] Undo after a reload restores the change made before it. A changed server document
      discards the old history.
- [ ] On the demo stack, Rhythms finds the 5-minute batch job (`· THRU`) within about 25 min.
      Step 07's criterion is ticked and its status is `done`.
- [ ] `/v1/models` on the demo doesn't change state in the event log for 15 min of steady
      traffic.
- [ ] A firing alert without a `station` label lights the header `EXT` lamp and leaves the
      stations' lamps alone.
- [ ] promtool, vitest, smoke, probe pytest and ruff pass.

## Out of scope

- `mars_stage_info{stage, order}` (decided 2026-11-07): it goes with the stage-order editor in
  step 09.
- Nodes that leave Prometheus stay offline until reload (decided, no change).
- The shared config PUT (step 12).
