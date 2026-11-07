# Step 08b: Follow-ups to steps 07 and 08

Status: done
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
  every page, wrapping at the ends. `?page=` accepts any page number (it already did).
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
  own key). The panel says *URL cartridge · local copy wins*, and the header's Station plate
  caption reads *Station · local copy*.
- The service panel gets *Revert to URL* (press twice): it deletes the saved copy and its undo
  history, and reloads the page, so the URL's document comes back. It can't be undone.
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
- The Rhythms readout shows AMP in the signal's unit (`1.2MS` for latency, `+9%` of the median
  for throughput), and its last column names the signals (`LAT`, `THRU`, `LAT+THRU`), unless
  the rhythm is NEW. The spectrum's marker label adds the signals when throughput is one of
  them (`5M00S THRU`).
- Throughput rhythms leave out incidents the same way latency ones do (minutes above WARN).
- Criterion: on the demo, Rhythms finds the 5-minute `/v1/rank` batch job within about
  25 minutes of continuous data, which closes step 07.

### Auto SLOs don't flap on small routes

- An auto SLO is `max(2 × observed 4-hour P95, station thresh.warn)`, rounded
  (`defaultSlo` in [discover.js](../../web/src/data/prometheus/discover.js) takes the
  station's thresholds). An `endpoints` override is used as given.
- An endpoint is judged only when it has enough traffic: at least 5 req/s (`MIN_RPS`, that is
  50 requests in the 10 s rate window). Below that it keeps its state and pressure, doesn't
  log state changes, and the radar draws it dim and counts it as `LOW N`. This applies to
  measured endpoints only (Prometheus stations): simulated P95s have no sampling noise.
- `MIN_RPS` is a constant in [telemetry.js](../../web/src/data/telemetry.js), not a document
  field.

### External alerts without a `station` label

- The station manager runs one more `/api/v1/alerts` poll for the device (every 10 s, while
  the document has a Prometheus station) and keeps the alerts without a `station` label.
  Each station keeps its own poll for its labelled alerts, as in step 07.
- Firing alerts without a `station` label light a device-level `EXT` lamp in the header (next
  to Alarm, shown only while there is a Prometheus station) and
  log as `EXT ALERT <NAME> FIRING` / `RESOLVED` without a station name, shown by event logs
  bound to `*`.
- They don't change any station's state or its C&W panel.

### Throughput-weighted almanac minutes

- New recording rule `mars:error_ratio:rate1m` (station): `sum by (station)
  (rate(...{code_class="5xx"}[1m])) / sum by (station) (rate(...[1m]))`, absent without
  traffic, like `mars:error_ratio`. The rule gets a promtool test.
- The almanac backfill reads it with `step=60s`, falling back to
  `avg_over_time(mars:error_ratio[1m])` (`or on (station)`) for minutes recorded before the
  rule existed. ADR-0003 lists the rule.

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

- [x] A document with 15 pages loads and validates. "Add standard pages" works on the
      built-in document. `1`–`9`, `←`/`→`, `[`/`]` and the footer reach every page.
      *(vitest: 15 pages; smoke: 12 pages, nine keys and `▸`, `[` from page 1 lands on 12.)*
- [x] After *Save as local* on `?config=/examples/two-stations.json`, a reload of the same link
      shows the edited document with `LOCAL`. *Revert to URL* brings back the file's version.
      Opening without `?config=` still shows the display's own document.
      *(smoke and vitest; the marker reads "Station · local copy".)*
- [x] Undo after a reload restores the change made before it. A changed server document
      discards the old history. *(smoke: undo and redo of the rebinding after the reload;
      vitest: a different document drops the history.)*
- [x] On the demo stack, Rhythms finds the 5-minute batch job (`· THRU`) within about 25 min.
      Step 07's criterion is ticked and its status is `done`. *(Found from 22 min of data.)*
- [x] `/v1/models` on the demo doesn't change state in the event log for 15 min of steady
      traffic. *(See handoff.)*
- [x] A firing alert without a `station` label lights the header `EXT` lamp and leaves the
      stations' lamps alone. *(Injected into `/api/v1/alerts` in the browser on the demo stack.)*
- [x] promtool, vitest, smoke, probe pytest and ruff pass.

## Out of scope

- `mars_stage_info{stage, order}` (decided 2026-11-07): it goes with the stage-order editor in
  step 09.
- Nodes that leave Prometheus stay offline until reload (decided, no change).
- The shared config PUT (step 12).

## Handoff

**Built**

- Pages: no cap in [schema.js](../../web/src/config/schema.js) and
  [edit.js](../../web/src/config/edit.js) (`MAX_PAGES` is gone). [App.jsx](../../web/src/App.jsx)
  adds `[` / `]` and shows nine page keys around the current page (`pageWindow`), with a
  `.keymore` mark (`◂` / `▸`) on each side where pages are hidden. Clicking the mark steps.
- Saved URL copies: [load.js](../../web/src/config/load.js) checks `mars.config@<url>` before
  fetching a `?config=` link (origin `url-local`) and returns the storage `key` with every
  document. [store.js](../../web/src/config/store.js) saves to that key; `save()` on a URL
  document writes the link's copy; `revert()` removes copy and history. The Workbench shows
  *URL cartridge · local copy wins* and a two-press *Revert to URL* key (`.revert-url`), which
  reloads the page. The header's Station plate caption reads *Station · local copy*.
- Undo history: the store writes `{ head, past, future }` to `mars.undo@<key>` in the same
  debounced save, drops the oldest snapshots above 2 MB, and drops the history if the write
  still fails. On load it is restored only if `head` equals the loaded document.
- Rhythms: [signal.js](../../web/src/data/signal.js) searches latency and throughput
  (`findAllRhythms`), merges rhythms within 2 % (`signals`), and each rhythm carries `signal`.
  The Rhythms panel and the spectrum label show it (`rhythmSignals`).
- Auto SLOs: `defaultSlo(p95, floor)` in [discover.js](../../web/src/data/prometheus/discover.js);
  the floor is `thresh.warn` in [station.js](../../web/src/station/station.js) and for routes
  found later in [source.js](../../web/src/data/prometheus/source.js). `MIN_RPS` and `ep.low` in
  [telemetry.js](../../web/src/data/telemetry.js); the radar dims LOW contacts and counts them,
  and the Contacts table shows `LOW` instead of P95 and LIM.
- Device alerts: [device-alerts.js](../../web/src/data/prometheus/device-alerts.js), run by the
  [station manager](../../web/src/station/manager.js) as `device.alerts` while a Prometheus
  station exists. The header `EXT` lamp (`useDeviceAlerts`) and event logs bound to `*` read it.
- `mars:error_ratio:rate1m` in [mars.rules.yml](../../probe/src/mars_probe/prometheus/mars.rules.yml),
  with a promtool case and the contract test's rule list. The almanac query uses it, falling back
  to the old mean with `or on (station)`.
- Tests: [signal.test.js](../../web/test/signal.test.js) (new),
  [device-alerts.test.js](../../web/test/device-alerts.test.js) (new), saved copies and undo
  history in [load.test.js](../../web/test/load.test.js), the SLO floor and LOW in
  [prometheus.test.js](../../web/test/prometheus.test.js), no cap in
  [edit.test.js](../../web/test/edit.test.js). The smoke test's service-panel run now covers the
  saved copy, undo after reload, *Revert to URL* and 12 pages.

**Deviations from the design**

- **Throughput rhythms needed more than a second fold.** On real demo data the first version
  found nothing. Three causes, all fixed in `findRhythms`:
  1. Trial periods always went up to 60 min. On a short history (the stack had 31 min) every
     top candidate was an hour-long period that can't show four cycles, so the search stopped
     before reaching 5 min. Periods are now capped at the covered span / 3.5 (half a cycle of
     slack, so a full 4 h tape still tries 60 min). This also affected latency.
  2. The demo compresses its day to 10 minutes (`LOADGEN_DAY_SECONDS=600`), a ±60 % traffic
     swing. Folded at 10 min it holds both batch bursts of each cycle, so confirming it first
     erased the batch job. Throughput is now high-passed at 120 s (latency stays at 1200 s):
     that takes off any traffic swing of 10 min or more and leaves bursts of up to about 40 s.
     So the swing is not reported as a rhythm; a burst on top of traffic is.
  3. The amplitude floor was 0.75 × the series' robust spread, which a smooth swing inflates
     (it was 45 % on real data). It is now read from neighbouring-sample differences, and
     measured again after each confirmed rhythm is subtracted.
  Throughput rhythms also need at least 12 % of the median throughput: the simulator's traffic
  noise is correlated over tens of seconds and folds to "significant" rhythms of up to 10 %.
  With these, the simulator's rhythms (seeds 1–3) are exactly what the old analyser found, and
  the demo's batch job is found from 22 min of data.
- **AMP has a unit.** `1.2MS` for latency, `+25%` for throughput, and the last column names the
  signals (`LAT`, `THRU`, `LAT+THRU`) instead of a `5m · THRU` suffix.
- **Device alerts are an extra poll**, not a shared one: each station keeps its own alert poll
  from step 07, and the manager adds one for the device. One more request every 10 s.
- **The low-traffic rule applies to Prometheus stations only** (`caps.endpoints` is set):
  simulated P95s have no sampling noise, and the quietest simulated route dips under 5 req/s.
- **Revert to URL reloads the page**, so it isn't undoable.

**Verification**

```
$ cd web && npx vitest run                              → 102 passed (8 files)
$ npm run smoke                                         → smoke: ok (12 checks)
$ bash probe/scripts/test-rules.sh                      → SUCCESS
$ cd probe && uv run pytest -q                          → 26 passed, 1 skipped
$ uv run ruff check . && uv run ruff format --check .   → All checks passed! / 19 files already formatted
```

On the running demo stack (Podman, `vite` dev server against `:9090`, `deploy/config/mars.json`):

```
rhythms   [{"period":300,"signal":"thru","sig":11.7,"amp":24.7},
           {"period":645,"signal":"lat","sig":7.8,"amp":1.2}]
lamps     before ["Alarm:NOMINAL","Ext:NOMINAL"]  after DiskFull injected ["Alarm:NOMINAL","Ext:DEGRADED"]
          stations api, search: NOMINAL, no external alerts
endpoints /v1/predict:15 /v1/embed:5 /v1/items/{item_id}:LOW /v1/models:LOW /v1/rank:LOW
replay    real data cut at 20 / 22 / 25 / 30 / 40 min → – / 300 thru / 300 / 300 / 300 + 645 lat
```

`/v1/models` over 15 min (06:49–07:04 UTC, one reading a minute): SLO 25 ms (2 × ~5 ms,
floored at `thresh.warn`), 1.1–5.4 req/s, LOW in 14 of 16 readings, state 0 throughout, no
events in the log. So it no longer flaps, mostly because it is held as LOW rather than judged.
The dev server reloaded the page during this run when source files changed. The run ended
with `rhythms [300 thru, 645 lat]` on the current code.

The 645 s latency rhythm is new on real data: the compressed day also moves latency a little
(1.2 ms). It isn't on the 60 s grid, so it isn't rounded to 600.

**Not verified / needs a person**

- The `mars-web` image wasn't rebuilt (same Podman `npm ci` problem as step 07); everything
  above ran against the dev server.
- Pages beyond about 20 in the footer, and touch use of the `◂` / `▸` marks.
- The 2 MB undo cap against a real quota (the quota failure path is unit-tested).

**Notes for later steps**

- Step 09: cartridge import should write through `docStore` so the history check sees the new
  document. A stations plate that rebinds panels is one undo step.
- Step 12: a shared PUT should also clear `mars.undo@mars.config` on other displays, which the
  head check already handles on their next load.

