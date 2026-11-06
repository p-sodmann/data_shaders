# MARS · Monitor Any Remote System

Model M-01, a tape archive terminal for a spare monitor. Half instrument, half
artwork, in a cassette-futurist housing: a Braun-style device whose screens are
all CRT phosphor shaders.

```bash
npm install
npm run dev      # then open the printed URL, press F for fullscreen
npm run smoke    # build, open pages 1–5 headless, fail on errors, write snapshots/page-N.png
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
| 14 | **Proximity** | Radar scope with one contact per endpoint. Each endpoint has a fixed bearing, and its range is its headroom. A contact at the rim is idle. A contact on the amber ring is at 75 % of its limit, and one on the orange ring is at its SLO (P95 latency or error budget, whichever is closer). The beam paints each contact as it passes, and the fading echoes behind a contact show which way it is moving. |
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
| 22 | **Rhythms** | Periodic behaviour found by epoch folding, as in a pulsar search. For each rhythm it shows the period, its amplitude in ms, the folded one-cycle profile with the current phase, the next peak and a countdown. NEW marks a rhythm that started inside the window. Incidents (latency above WARN) are left out of the search, and multiples or aliases of a rhythm are not reported separately. |

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

Colour is a signal, never decoration: mint is nominal, amber is warn, orange is critical.

## Keys

`1`–`5` or `←` / `→` switch pages · `A` auto-cycle pages · `F` fullscreen (or double-click) · `T` inject a test incident · `S` time base ×1 / ×10 / ×60 · `B` graphite or ivory finish.
The pointer hides after 2.5 s.

## URL parameters

`?station=edge-eu-2&hosts=48&speed=10&fps=30&dpr=1.5&finish=ivory&page=2&cycle=120&source=/telemetry.json`

Use `fps=30` and `dpr=1` on weak machines or 4K panels. `stations=2` is a debug flag (see Architecture).

## Connecting real data

Set `?source=<url>` to poll a JSON endpoint once per second ([src/data/polling.js](src/data/polling.js)):

```json
{ "timestamp": 1730812345123, "latency": 12.4, "throughput": 318, "errorRate": 0.003,
  "saturation": 0.42, "hosts": [{ "load": 0.4, "state": "ok", "latency": 11.2 }],
  "stages": [1.0, 0.7, 2.2, 5.6, 1.9, 0.7],
  "requests": [{ "route": "/v1/predict", "status": 200, "ms": 11.8, "node": 6 }],
  "endpoints": [{ "route": "/v1/predict", "rps": 120, "p95": 18.2, "err": 0.002 }],
  "regions": [{ "code": "IAD", "rps": 64, "rtt": 92, "err": 0.001 }] }
```

`stages`, `requests`, `endpoints`, `regions` and per-host `latency` are optional. Service names, links and pipeline stages are set in the station profile ([src/station/profile.js](src/station/profile.js)).
The same profile sets endpoint SLOs (`endpoints`), client regions with their coordinates (`regions`) and the station's own position (`home`).
Endpoints and regions are matched by `route` / `code`, or by position in the array.

`errorRate` is a fraction (0.003 = 0.3 %). Host `state` is one of `ok`, `warn`, `crit` or `offline`.
Thresholds are the profile's `thresh`.

To use another transport (WebSocket, Prometheus), write a source with the same shape:
`{ kind, hostCount, speed, now(), setSpeed(), backfill(fromT) -> samples[], start(push), stop(), triggerIncident() }`.
If `backfill` returns history (for example from a Prometheus range query), the archive is full on boot.

## Architecture

```
src/station/    station = profile (thresholds, SLO, topology, endpoints, regions)
                + source + telemetry store + almanac + signal analyser
src/data/       simulator + polling sources → telemetry store (tape rows, state, events)
src/gl/         engine: one WebGL2 context renders every screen
src/instruments each instrument = fragment shader + update() that returns uniforms
src/config.js   device constants (tape geometry, history lengths) and URL parameters
src/App.jsx     the housing (layout, labels, keys)
```

Nothing station-specific is a module global. `createStation(def)` builds one monitored
system, and every instrument factory takes it: `createX(station, options = {})`, reading
`station.store`, `station.signal`, `station.almanac` and `station.profile`. Several stations
can run side by side; `?stations=2` starts a second, hidden sim station and logs both
latency streams to the console once per second (a debug check).

Instruments come in two kinds:

- **Fragment instruments** (tape, meter, nodes, dot-matrix panels) shade every pixel from uniforms and data textures.
- **Vector instruments** (orbit, fleet, pipeline, slices, proximity, ground track, spectrum, X‑Y scope, correlator, budget, burn rate) draw glowing beam strokes with the painter in [src/gl/vector.js](src/gl/vector.js): instanced gaussian line segments blended additively, plus a small 3D camera and wireframe solids in [src/instruments/space.js](src/instruments/space.js).

Every screen runs the same pipeline: **instrument scene → phosphor persistence
(feedback buffer) → quarter-res bloom → tube composite** (curvature, scanlines,
convergence error, vignette, grain, flicker). Screens power on with a raster
cascade when a page is switched in.

Adding an instrument means writing one object:

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

Then mount it with `<Screen inst={createMyInstrument(station)} />` (built once, as in `App.jsx`). The shared header gives
every shader the phosphor palette, `uRes`, `uTime`, `uDpr` and SDF helpers.
For text, use `createDotMatrix` with a `draw(api)` callback.
