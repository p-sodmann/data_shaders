# MARS · Monitor Any Remote System

Model M-01, a tape archive terminal for a spare monitor. Half instrument, half
artwork, in a cassette-futurist housing: a Braun-style device whose screens are
all CRT phosphor shaders.

```bash
npm install
npm run dev      # then open the printed URL, press F for fullscreen
npm test         # unit tests (vitest): config schema, migrations, load order, station manager
npm run smoke    # build, open every page headless (default doc, two-station example, old URL),
                 # fail on errors, write snapshots/*.png
```

This is the `web/` part of the MARS monorepo; see the [root README](../README.md) for the
whole system. The dev server proxies `/prom` to Prometheus on `localhost:9090`, which is where
the compose stack in [deploy/](../deploy/README.md) publishes it. The production image
([Dockerfile](Dockerfile), [Caddyfile](Caddyfile)) serves the build with Caddy on port 8080 and
proxies `/prom/*` the same way.

## What's on the panel

### Page 1: Tape

| # | Instrument | Reads as |
|---|---|---|
| 01 | **Tape archive** | P50 latency. The front row is the current 10-minute window, written by the beam. When it fills, the tape steps back and the row joins a 4-hour ridgeline archive. All rows share the same time axis, so periodic behaviour shows up as vertical seams and incidents leave ridges you can still see hours later. Error rate shows as static under the line. |
| 02 | **Load** | Moving-coil meter for cluster saturation, with spring physics, a peak-hold tick and a red zone. |
| 03 | **Nodes** | One lamp per host. The fill level is load; the colour is state. Warn lamps breathe, crit lamps blink, offline lamps go dark and get struck through. |
| 04–06 | **Readouts** | Dot-matrix numerals with segmented bars. Segment colour marks where the thresholds are. |
| 07 | **Event log** | Teletype showing node state changes, system state changes and archived rows. |
| — | **System / alarm lamp** | NOMINAL, DEGRADED or INCIDENT, with time in state. The lamp is the only physical colour on the housing. |

### Page 2: Orbit

| # | Instrument | Reads as |
|---|---|---|
| 08 | **Orbit** | Service topology as a slowly turning constellation of wireframe solids. Size is load, colour is the worst host state, hosts orbit as satellites, and packets travel the call links at a density set by throughput. |
| 09 | **Fleet** | Every node's latency over the last three minutes as one strand. A healthy fleet is a tight bundle; a sick node peels away in amber. Includes the P50 strand and the current distribution with P50, P99 and spread. |
| 10 | **Pipeline** | Requests flow through the serving stages as particles. A stage taking more than its normal share of latency slows them, builds a visible queue, and is named as the bottleneck. Failed requests drop out in orange. |
| 11 | **Slices** | Fleet fingerprints at T-10m, -5m, -2m, -60s, -10s and now, stacked like film frames (angle = node, radius = latency), above a 10-minute event timeline. |
| 12 | **Caution & warning** | The six rules behind the alarm lamp, each with value, limit and NOM / WARN / CRIT / STALE. |
| 13 | **Trace** | Sampled requests: route, status, latency, node. |

### Page 3: Sweep

| # | Instrument | Reads as |
|---|---|---|
| 14 | **Proximity** | Radar scope with one contact per endpoint. Each endpoint has a fixed bearing, and its range is its headroom. A contact at the rim is idle. A contact on the amber ring is at 75 % of its limit, and one on the orange ring is at its SLO (P95 latency or error budget, whichever is closer). The beam paints each contact as it passes, and the fading echoes behind a contact show which way it is moving. On a Prometheus station, a route with under 5 req/s is too sparse to judge: it is drawn dim, keeps its last range and state, and is counted as `LOW`. |
| 15 | **Ground track** | World map of where traffic comes from. Land is shown as a dot screen, lit on the day side of the terminator. Each client region sends packets along its great-circle arc to the station, at a density set by its request rate, in its route colour. The cursor is the request-weighted centre of all traffic. Its trail over the last 4 hours is the ground track, which circles the globe westward once a day as the working day moves around the planet. |
| 16 | **Contacts** | The radar contacts as a table: bearing, RPS, P95, SLO, percentage of limit, closing ▲ / opening ▼. |
| 17 | **Origins** | Client regions by share of traffic, with RTT, error rate and route state. A route is DEG at 1.4× its learned RTT baseline and LOST at 2×, or when its error rate crosses the error thresholds. |

### Page 4: Signal

Treats the telemetry as a signal and looks at its shape rather than its current value. It needs no extra data: everything is derived from a 4-hour, 1-second history of every signal ([src/data/signal.js](src/data/signal.js)).

| # | Instrument | Reads as |
|---|---|---|
| 18 | **Spectrum** | Amplitude spectrum of P50 latency on a period axis. The dim trace is the 4-hour reference. The bright trace is the last 10 minutes (periods up to 200 s), redrawn by a sweeping cursor every 3.5 s. It is scaled to the reference's noise floor, so where it rises above the reference there is more activity now. A scheduled job is a short pulse, so it appears as a comb. Each confirmed rhythm gets a marker at its period, plus ticks at its harmonics, so the comb reads as one thing. Amber means the rhythm began inside the window. |
| 19 | **Waterfall** | Spectrogram: one row per 30 s, each the spectrum of the 30 minutes before it, newest at the top, 4 hours deep. The top row is live: it is recomputed every 5 s and fixed at the next 30 s boundary. Each row is shown relative to its own noise floor, so a steady rhythm draws a vertical line, a job that starts or stops makes a line begin or end, and an incident is a bright horizontal smear. |
| 20 | **X‑Y scope** | Latency (log scale) against saturation, like a scope in X‑Y mode. Load runs 0–100 %; the latency axis ranges itself over the cloud, the curve and the live beam, so an incident stays on the face. The cloud is the last 4 hours. The dotted line is the healthy operating curve (median latency at each load, learned only from samples below WARN), with its 90th-percentile edge above. The beam traces the last 3 minutes. If the beam lifts off the curve, something other than load is slowing requests down: OFF CURVE, in amber or orange. The knee is where the curve reaches 1.5× its unloaded latency. |
| 21 | **Correlator** | Pearson correlation of every pair of signals (latency, errors, throughput, saturation and each service's load) over the last 10 minutes. A filled dot means positive correlation, a ring means negative. A pair turns amber when it departs strongly from its habit, which is the median of the 24 ten-minute windows in the last 4 hours. |
| 22 | **Rhythms** | Periodic behaviour found by epoch folding, as in a pulsar search. Latency and throughput are both searched, since a batch job often shows as load before it shows as latency. For each rhythm it shows the period, its amplitude (`MS` for latency, `%` of the median for throughput), the folded one-cycle profile with the current phase, the next peak, a countdown, and the signals it was found in (`LAT`, `THRU` or `LAT+THRU`). NEW, in place of the signals, marks a rhythm that started inside the window. Incidents (latency above WARN) are left out of the search, and multiples or aliases of a rhythm are not reported separately. |

### Page 5: Almanac

The device's long memory. One record per minute (latency, errors, throughput, load and worst state) is kept for 30 days and saved in the browser's IndexedDB, so the history survives reloads ([src/data/almanac.js](src/data/almanac.js)). It is stored separately for each source and station. A simulated device also generates a deterministic 30-day past for any minute it never saw, so the page is full on first boot.

| # | Instrument | Reads as |
|---|---|---|
| 23 | **Week dial** | Seven days of P50 on a 24-hour clock face: midnight at the top, today on the outer ring under the hand, the oldest day by the hub. Daily habits line up as spokes; an unusual day stands out as a ring. Amber or orange where at least half of a 5-minute bin was degraded, or a third was in an incident. |
| 24 | **Habits** | The typical P50 (median over about four weeks) for every weekday and hour, scaled between the 10th and 90th percentile of the cells. An orange mark grows with how often that slot was in an incident. Strips on the right and below give the weekday and hour averages; the framed cell is now. |
| 25 | **Error budget** | The availability SLO's error budget as a fuel tank: full is the whole budget for the rolling 30 days, the level is what's left. Bubbles rise while it burns faster than 1×. The readout projects when it runs dry at the 6-hour burn rate. |
| 26 | **Burn rate** | How fast the budget is being spent, as multiples of the rate that would use it up exactly over the window. 6 h, 1 h and 5 min traces over 24 h. FAST BURN (14.4×, 1 h and 5 min) and SLOW BURN (6×, 6 h and 30 min) light only when both of their windows are over the rate. |
| 27 | **Logbook** | Every incident in the almanac, newest first: start, duration, peak latency and error rate, and the share of the error budget it cost. The header shows the time since the last incident, counts for 24 h and 7 d, MTTR and MTBF. |

The SLO target, window and alert rates are the station profile's `slo` and `burnAlerts` ([src/station/profile.js](src/station/profile.js)).

### Cross-station instruments

These show every station of the document at once (registry scope `device`), so a panel
carries no `station`. They follow stations that are added, removed, rebuilt or retuned
without being rebuilt. The Docker document has them on page 7, *Fleet*; the module bay lists
them last, under *All stations at once*.

| Type | Instrument | Reads as |
|---|---|---|
| `stationBoard` | **Station board** | The nodes lamp bank with one large lamp per station, carrying its name and, below it, P50 and RPS (option *P50 and RPS*). The fill is saturation and the colour is the station's state (warn breathes, crit blinks). A STALE station, or one still loading its tape, is dark and struck through. |
| `stationRadar` | **Station radar** | The proximity scope with one contact per station. Its bearing is fixed by the station's place in the document; its range is headroom: the worst of P50 against `crit`, error rate against `errCrit` and saturation against `satCrit`, so the orange ring means "at a crit limit". Colour is the station's state. A STALE station keeps its last position, crossed out. At most five contacts are named (worst state first, then least headroom). |
| `stationStrands` | **Station strands** | One P50 strand per station over the last 3 minutes, divided by the station's own `crit`, so stations on different scales are comparable; the orange line is crit for all of them. Strands over their warn line are named at the tip. On the right, the five stations nearest crit with their current share of it. With many stations a segment spans several seconds and shows their highest P50. |
| `stationLog` | **Station log** | The event log of every station on one teletype, each line with its station's name. The same as a `log` panel bound to `*`. |

[public/examples/sixteen-stations.json](public/examples/sixteen-stations.json) runs the Fleet
page on 16 simulated stations (`?config=/examples/sixteen-stations.json`).

Colour is a signal, never decoration: mint is nominal, amber is warn, orange is critical.

## Keys

`1`–`9` jump to the first nine pages, `←` / `→` or `[` / `]` step through all of them (the footer shows nine page keys, with `◂` / `▸` where more are hidden) · `A` auto-cycle pages · `F` fullscreen (or double-click) · `T` inject a test incident into a station on the current page (`Shift+T` picks which, when the page shows several; the key names it) · `S` time base ×1 / ×10 / ×60 for every simulated station (live stations always run at ×1) · `B` graphite or ivory finish · `E` opens the service panel (see below).
The pointer hides after 2.5 s.

## The service panel (editing pages)

Press `E` or the `SERVICE` key to open the housing. The deck shows its 12 × 8 grid, and every
module sits on a mounting plate:

- **Move** a module by its label strip, **resize** it by the notch at the bottom-right. The grid
  has no compaction: a module only lands where it fits, never on another one or off the deck.
- **Module bay** (right): every instrument as a faceplate. Click one to put it in the first free
  spot that fits its default size (or down to its minimum), or drag it onto the deck. `NO ROOM`
  marks those that don't fit; `PAGE FULL` says nothing does.
- **Settings plate**: click a module. Pick its station (each with a live lamp; the event log
  also has *All stations*), set its options, or **Remove**, **Duplicate** (first free spot) and
  **Swap** (pick the new instrument in the bay; it keeps the place and drops the old options).
  `Delete` removes the selected module.
- **Pages** (key row): `+` new page `PAGE N`, `◀ ▶` move the current page, `✎` rename it,
  `✕` delete it (press twice), `▦` add the five standard pages for a station.
- `Ctrl/Cmd+Z` undo, `Shift+Ctrl/Cmd+Z` (or `Ctrl+Y`) redo, 50 steps; also the *Undo* and *Redo*
  keys. The history is saved with the document and survives a reload, as long as the document
  that loads is still the one it leads to. `Esc` or `E` closes the housing.

Every change is saved to this display's `localStorage` after half a second, except for a
document from the URL (`?config=` or legacy parameters): the panel says *URL cartridge · not
saved* until you press **Save as local**. For a `?config=` link that saves a copy for this link
on this display, and from then on the copy wins whenever the display opens that link: the panel
says *URL cartridge · local copy wins* and the header's Station plate *· local copy*. **Revert
to URL** (press twice) deletes the copy and its history and reloads the link's own document.
A document from the legacy parameters becomes the display's own document when saved.

### Stations and cartridges

The **Stations** key on the panel opens the stations plate in a wider service column (the deck
stays in view):

- **The table**: one row per station: lamp, name, source (`PROM api`, `SIM #2`, `POLL`), nodes,
  live RPS, `✎` edit and `✕` remove. Removing a station that no panel uses takes two presses.
  If panels use it, the plate asks whether to remove them too or move them to another station
  (one undo step either way). The last station can't be removed.
- **Prometheus**: the document's `prometheus.url`, editable, with a lamp that is lit while
  `/api/v1/status/buildinfo` answers.
- **Available on Prometheus**: the `station` label values of `mars_info` (last hour) that no
  station reads yet, each with its live P50 and RPS (one query for all of them). `+ Add` creates
  `{ id, name: "<VALUE>-01", source: { kind: "prometheus", station } }` and offers the five
  standard pages for it.
- **Edit** (`✎`): name, thresholds (P50, error and saturation warn/crit, the tape, error and RPS
  scales), SLO target and window, home (a region code from
  [src/data/regions.js](src/data/regions.js), or lat/lon), and for a Prometheus station the P95
  SLO per discovered route and the pipeline order (`▲` moves a stage up; *Probe order* goes back
  to the order the probe exports). An empty field means the default, which it shows faintly. A
  value the document's schema refuses, or a warn above its crit, is written in amber under the
  field and doesn't go in. Threshold changes take effect on the running station at once: lamps,
  limit lines and bars change, and the tape stays. Any other change restarts the station (a
  Prometheus station reloads its tape, about 3 s).
- **Cartridge**: **Export** downloads the document as `mars-<date>.mars.json`. **Import** takes
  such a file (or drop one anywhere on the open device), shows its stations and pages, or every
  problem it has (then nothing changes), and **Replace**s the document or **Merge**s it in.
  Merging adds the file's stations and pages: a station with the same id and source is kept
  as it is, one with the same id and another source gets a new id (its panels follow), and
  device settings stay. Imports run the version migrations. **Reset** (press twice) goes back to
  the built-in document. All three are undoable.

Adding a server to Prometheus is still a file in `deploy/prometheus/targets/`
([deploy/](../deploy/README.md)); the plate lists what Prometheus already scrapes.

**Lock** sets `device.locked` in the document. A locked display ignores `E` and clicks on
`SERVICE`; hold `SERVICE` for 2 s (or open the page with `?unlock=1`) to get in. The long-press
unlock lasts until the housing is closed again.

## The config document

Stations and pages come from one JSON document ([ADR-0005](../docs/adr/0005-config-document.md),
schema in [src/config/schema.js](src/config/schema.js)). The first of these wins:

1. `?config=<url>`, e.g. `?config=/examples/two-stations.json` (shipped in [public/examples/](public/examples/)),
   or this display's saved copy of that link's document if there is one (`localStorage["mars.config@<url>"]`)
2. the old station parameters `?source=`, `?station=`, `?hosts=`, `?speed=` (still work, see below)
3. `localStorage["mars.config"]`, this display's saved copy
4. `/config/mars.json`, the Docker config volume ([deploy/config/](../deploy/config/))
5. the built-in default: one simulated station `main` with the five standard pages

A document that doesn't validate is skipped with a `[MARS] config …` warning in the console.
Documents from the URL (1, 2) are never saved over this display's copy.

Several stations run side by side. With more than one, module headers carry the station name,
the alarm lamp and the System tube show the worst station, and an event log bound to
`"station": "*"` merges every station's events.

Pages and stations can be edited on the device itself (the service panel and the stations
plate, above). The devtools console can do the same:

```js
__mars.getDoc()                       // the current document (frozen)
__mars.setDoc((d) => ({ ...d, stations: [...d.stations,
  { id: 'b', name: 'B-01', source: { kind: 'sim', seed: 3 } }] }))   // live; throws if invalid
__mars.standardPages('b', 'b-')      // the five standard pages for station b
__mars.save()                         // keep it in this display's localStorage
__mars.stations()  __mars.stats()     // running stations, live GPU objects
```

## URL parameters

`?fps=30&dpr=1.5&finish=ivory&page=2&cycle=120` override the document's `device` block for this
session. `?unlock=1` lets `E` open a locked device for this session. Use `fps=30` and `dpr=1` on weak machines or 4K panels.

The parameters from before the config document still work and describe one station:
`?station=edge-eu-2&hosts=48&speed=10&source=/telemetry.json` (`source` is `sim` or a JSON URL).

## Connecting real data

### Prometheus (the normal way)

Instrument the service with [mars-probe](../probe/README.md), let Prometheus scrape it with the
MARS recording rules loaded ([deploy/](../deploy/README.md) does both), and give a station

```json
{ "id": "api", "name": "API-01", "source": { "kind": "prometheus", "station": "api" } }
```

`station` is the value of the probe's `station` label. The document's `prometheus.url` (default
`/prom`) is the API base. The Docker image and `npm run dev` both proxy `/prom` to Prometheus,
so the browser needs no CORS. [deploy/config/mars.json](../deploy/config/mars.json) is the
document the Docker stack serves: the two demo stations, the five standard pages for `api`, and
a mixed page for both.

When a Prometheus station starts ([src/data/prometheus/](src/data/prometheus/)):

1. **Discovery.** Nodes come from `mars:node_up` (last 1 h), and routes, stages and regions from
   the label values of `mars:endpoint_rps`, `mars:stage_mean_ms` and `mars:region_rps` (last 4 h).
   Region codes are joined against [src/data/regions.js](src/data/regions.js) (IATA-style
   codes). Unknown codes are skipped, with one console warning. The table is the probe's
   ([probe/src/mars_probe/regions.json](../probe/src/mars_probe/regions.json)), copied to
   `src/data/regions.json`; `npm test` fails while the copies differ.
2. **Tape load.** Its screens show TAPE LOAD while the station-level series are fetched for the
   whole 4 h tape (`query_range`, 1 s steps, 1 h chunks, at most 4 at once). Per-node series
   are fetched only for the last 10 min (what Fleet and Slices show). Routes, stages and regions
   are live only. Other stations keep running meanwhile. If Prometheus can't be reached, the
   screens say NO CONTACT and discovery retries.
3. **Live.** It sends one `query {__name__=~"mars:.+",station="api"}` per second, sampled
   requests from `query_exemplars` every 5 s, and firing alerts from `/api/v1/alerts` (those
   with a matching `station` label) every 10 s. A firing alert lights the lamp amber and
   shows on the Caution & Warning panel (`EXT ALERTS`), but MARS's own state is unchanged.
   Firing alerts **without** a `station` label belong to the device: they light the header's
   `EXT` lamp (shown while any station is a Prometheus one) and are logged without a station
   name in event logs bound to *All stations*. They don't change any station's state.
4. **Almanac.** Minutes the browser doesn't hold yet (up to 30 days) are read from Prometheus
   (`avg_over_time(…[1m])`, 60 s steps; the error rate from `mars:error_ratio:rate1m`, which is
   weighted by traffic like the live minutes). IndexedDB is only a cache.

Mapping (ADR-0003): a node is **offline** when `node_up` is 0 or missing. Otherwise it is warn
or crit when its load passes the station's `thresh.satWarn` / `satCrit`. If a second has no
`throughput_rps`, the target is down or unknown, and if it has no `latency_p50_ms`, there was no
traffic. Either way nothing is written for that second, and the tape shows a gap. After 10 s
without data the station is **STALE**: the lamp goes dark (if no other station is worse), the
System tube says STALE, and the C&W `SOURCE AGE` row says STALE. It recovers by itself.

Optional overrides in the station entry:

```json
"endpoints": [{ "route": "/v1/predict", "slo": 40 }],
"stages": ["ingress", "auth", "embed", "infer", "rank", "egress"]
```

Without an `endpoints` entry, a route's P95 SLO is **2 × its observed 4-hour P95**, rounded, and
at least the station's `thresh.warn` (so a 5 ms route doesn't get a 10 ms SLO). The
contacts table marks such SLOs with `A` (for example `61A`). Stages listed in `stages` come
first, in that order; the rest follow in the order the probe exports in `mars_stage_info`
(`instrument(app, stages=[…])`, else the order the process first entered them), and stages a
probe older than step 09 doesn't order go by their usual meaning (ingress/auth first, egress
last), then by name. Each stage's normal share of the latency is learned from its 4-hour mean.

Nodes, routes, stages and regions that appear later take spare slots and show up within a
second. If the slots run out, the station rebuilds and refills its tape
([ADR-0007](../docs/adr/0007-runtime-entities.md)). The C&W `SLOTS USED` row shows how full they
are. A Prometheus station's topology (Orbit) is one service, the station itself, with its
nodes as satellites. The time base key `S` doesn't apply to it (`Time ×1 live`).

### A JSON feed

Give a station `"source": { "kind": "poll", "url": "/telemetry.json", "hosts": 48 }` (or use the
old `?source=<url>`) to poll a JSON endpoint once per second ([src/data/polling.js](src/data/polling.js)):

```json
{ "timestamp": 1730812345123, "latency": 12.4, "throughput": 318, "errorRate": 0.003,
  "saturation": 0.42, "hosts": [{ "load": 0.4, "state": "ok", "latency": 11.2 }],
  "stages": [1.0, 0.7, 2.2, 5.6, 1.9, 0.7],
  "requests": [{ "route": "/v1/predict", "status": 200, "ms": 11.8, "node": 6 }],
  "endpoints": [{ "route": "/v1/predict", "rps": 120, "p95": 18.2, "err": 0.002 }],
  "regions": [{ "code": "IAD", "rps": 64, "rtt": 92, "err": 0.001 }] }
```

`stages`, `requests`, `endpoints`, `regions` and per-host `latency` are optional. Service names, links and pipeline stages are set in the station profile ([src/station/profile.js](src/station/profile.js)).
The same profile sets endpoint SLOs (`endpoints`), client regions (`regions`, codes from [src/data/regions.js](src/data/regions.js)) and the station's own position (`home`).
Endpoints and regions are matched by `route` / `code`, or by position in the array.

`errorRate` is a fraction (0.003 = 0.3 %). Host `state` is one of `ok`, `warn`, `crit` or `offline`.
Thresholds are the profile's `thresh`.

### Another transport

Write a source with the shape
`{ kind, hostCount, speed, now(), setSpeed(), backfill(fromT, progress?, store?) -> Promise<samples[]>, start(push, store?), stop(), triggerIncident() }`
and add it to [src/station/station.js](src/station/station.js). The station waits for `backfill`
(its screens show TAPE LOAD) and ingests what it returns before it calls `start`.

## Architecture

```
src/station/    station = profile (thresholds, SLO, topology, endpoints, regions)
                + source + telemetry store + almanac + signal analyser
                manager.js: one running station per document entry, diffed by id
src/data/       simulator + polling sources → telemetry store (tape rows, state, events)
src/gl/         engine: one WebGL2 context renders every screen
src/instruments each instrument = fragment shader + update() that returns uniforms
                registry.js: every panel type; overlays/: labels printed on the glass
src/config/     the config document: schema (zod), migrations, load order, store;
                presets.js: standardPages(station) and DEFAULT_PAGES
src/ui/         PageView (lays a page's panels out on the 12 × 8 grid), Module, Screen, Key
src/ui/service/ the service panel: EditableDeck (react-grid-layout), ModuleBay,
                SettingsPlate, Workbench; loaded on first use. Edits are pure functions
                in src/config/edit.js; the doc store keeps the undo stack
src/config.js   device constants (tape geometry, history lengths)
src/runtime.js  boot(): load the document, start the stations, window.__mars
src/App.jsx     the housing (header, keys, page switching)
```

Nothing station-specific is a module global. `createStation(def)` builds one monitored
system, and every instrument factory takes it: `createX(station, options = {})`, reading
`station.store`, `station.signal`, `station.almanac` and `station.profile`. Instruments with
registry scope `either` or `device` get the device instead, `{ stations }`, a live read-only list.
The page 4 analyser (`station.signal`) exists only while a mounted panel that `needs: ['signal']`
holds it. Each station keeps its almanac in IndexedDB under `station:<id>:<source kind>`.

Instruments come in two kinds:

- **Fragment instruments** (tape, meter, nodes, station board, dot-matrix panels) shade every pixel from uniforms and data textures.
- **Vector instruments** (orbit, fleet, pipeline, slices, proximity, ground track, spectrum, X‑Y scope, correlator, budget, burn rate, station radar, station strands) draw glowing beam strokes with the painter in [src/gl/vector.js](src/gl/vector.js): instanced gaussian line segments blended additively, plus a small 3D camera and wireframe solids in [src/instruments/space.js](src/instruments/space.js).

Every screen runs the same pipeline: **instrument scene → phosphor persistence
(feedback buffer) → quarter-res bloom → tube composite** (curvature, scanlines,
convergence error, vignette, grain, flicker). Screens power on with a raster
cascade when a page is switched in.

Pages are data. A page is `{ id, name, panels: [{ id, type, station, x, y, w, h, options }] }`,
placed on a grid of 12 columns × 8 rows that fills the deck. `PageView` builds each panel's
instrument when the page mounts and drops it when the page goes away. The engine frees the
screen's GPU objects then, and `window.__mars.stats()` shows the live counts (screens,
textures, framebuffers, programs, buffers), and `window.__mars.frames()` the mean and 95th
percentile CPU time per frame over the last 240 frames. A panel whose type isn't in the registry shows
`NO MODULE`. A panel whose station doesn't exist shows `NO SIGNAL`. Module numbers run on in
panel order across all pages.

### Adding an instrument

Write the instrument as one object:

```js
export const createMyInstrument = (station, options = {}) => ({
  frag: `uniform float uValue; void main(){ fragColor = vec4(PH_OK*uValue, 1.); }`,
  crt: { curve: 0.03, scan: 0.8, bloom: 0.9, decay: 0.86 },
  update(gl, state, frame) { return { uValue: station.store.latest.saturation }; },
});
```

A vector instrument is just as short:

```js
export const sweep = {
  render(gl, state, frame, v) {
    const a = frame.time;
    v.line(v.w / 2, v.h / 2, v.w / 2 + Math.cos(a) * 80, v.h / 2 + Math.sin(a) * 80, [0.5, 1, 0.72], 0.9);
    v.text(10, 10, 'SWEEP', [0.5, 1, 0.72], 0.6);
  },
};
```

An instrument with registry scope `device` is built on the device instead of a station:
`create(device, options)`, where `device.stations` is the current list. It is built once, so it
reads `device.stations` and each station's `store` (thresholds: `store.profile.thresh`) every
frame rather than keeping copies; [src/instruments/stations.js](src/instruments/stations.js)
has the shared readings (lamp code, pressure, numerals). Text drawn with the vector painter
costs one beam instance per glyph dot, so cap how many stations get labels.

Then register it in [src/instruments/registry.js](src/instruments/registry.js):

```js
mine: entry({
  name: 'My instrument',        // module header; may be (options) => text
  reads: 'Saturation as a bar', // one line on the module bay's faceplate
  meta: 'Saturation · live',     // right-hand caption; may be ({ station, snap, options }) => text
  create: createMyInstrument,    // (station, options) => instrument
  overlay: null,                 // optional React component inside the glass: { inst, station, snap, options }
  needs: [],                     // station tables it reads: 'endpoints', 'stages', 'regions', 'almanac'
  minW: 3, minH: 2, defaultSize: [4, 3],
  options: {},                   // { key: { type, default, label } }, defaults are filled in before create();
                                 // types 'enum' (values), 'number' (min, max, step), 'boolean', 'string'
                                 // are rendered on the settings plate
}),
```

and put a panel `{ id, type: 'mine', station: 'main', x, y, w, h }` on a page in
[src/config/presets.js](src/config/presets.js). Don't mount instruments in `App.jsx`; only
the housing's status and clock tubes live there. If an instrument allocates GPU objects in
`init(gl, engine)`, release them in `dispose(gl, state)`. The engine calls it when the panel
unmounts. The shared header gives
every shader the phosphor palette, `uRes`, `uTime`, `uDpr` and SDF helpers.
For text, use `createDotMatrix` with a `draw(api)` callback.
