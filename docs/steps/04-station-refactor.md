# Step 04: Station refactor (no global config)

Status: done
Depends on: 00
Read first: [ADR-0005](../adr/0005-config-document.md), `web/README.md` (Architecture section)

## Context

Today, `web/src/runtime.js` exports one global `source`, `store` and `almanac`, and 18 modules
import station-specific globals from `web/src/config.js` (`THRESH`, `SLO`, `BURN_ALERTS`,
`SERVICES`, `LINKS`, `HUB`, `serviceOf`, `STAGES`, `STAGE_SHARE`, `ENDPOINTS`, `EP_ERR_BUDGET`,
`REGIONS`, `HOME`). Several stations need several, independent sets of these.

Instruments are already factories (`createTape(store)` etc., see `App.jsx`), and
`engine.add(el, inst)` already supports mounting screens dynamically.

## Goal

Introduce a **station** object, and make every data module and instrument take its settings
from it. There must be **no visible change**: still one simulated station and the same five
pages.

## Design

```js
// web/src/station/profile.js
export function createProfile(overrides = {}) // → frozen object:
// { id, name, thresh, slo, burnAlerts, home, services, hub, links, serviceOf(host, n),
//   stages, stageShare, endpoints, epErrBudget, regions }
// Defaults are exactly today's config.js values, merged one level deep with the overrides.

// web/src/station/station.js
export function createStation(def) // def = { id, name, source: { kind: 'sim', hosts, seed, speed }, ...overrides }
// → { id, profile, source, store, almanac, get signal() /* created lazily */, start(), stop() }
```

- **Device constants stay in `config.js`:** `ROWS`, `ROW_SECONDS`, `HIST`, `TRACK_STEP`,
  `ALMANAC_DAYS`, plus `CONFIG` (URL params for fps, dpr, finish, page, cycle). Everything
  else moves into the profile.
- `createTelemetry`, `createSimulatedSource`, `createHistorySynth`, `createPollingSource`,
  `createAlmanac` and `createSignal` receive the `profile` (or the station) as a parameter.
- **Every instrument factory gets the same signature:** `createX(station, options = {})`.
  It reads `station.store`, `station.signal`, `station.almanac` and `station.profile` as
  needed. `createReadout`'s current second argument becomes `options`.
- `runtime.js` becomes `createStation({ id: 'main', name: CONFIG.station, source: … })` plus
  `start()`. The startup sequence stays the same (backfill → ingest → start → almanac load or
  synthesize), but it moves into `station.start()`.
- The almanac key stays `${kind}:${source}:${station}`, so existing IndexedDB history survives.
- The simulator gets an optional `seed` so two sim stations can differ. It must default to
  today's behaviour.
- `App.jsx` builds `inst` from the single station. The page JSX is unchanged in this step.

## Tasks

1. Create `station/profile.js` and `station/station.js` as above.
2. Thread the profile through `data/*` and every `instruments/*`. Remove every import of
   station globals. When you're done, `grep -rn "THRESH\|ENDPOINTS\|REGIONS\|SERVICES\|STAGES\|SLO\b\|HOME\|BURN_ALERTS\|LINKS\|HUB" web/src`
   should only match `station/profile.js` and property accesses like `profile.thresh`.
3. Make `App.jsx` overlays (`TapeOverlay`, `HeatOverlay`, etc.) and labels that use `THRESH`
   or `SLO` read them from the station.
4. Add a temporary check behind `?stations=2`: create a second sim station (seed 2) and log both
   stores' latest latency once per second to the console. This proves two stations run
   independently. Remove it, or keep it as a debug flag, and say which in the handoff.

## Acceptance criteria

- [x] `npm run build` and `npm run smoke` pass. The screenshots look the same as step 00's
      (compare them by eye, and attach both in the handoff or name the paths).
- [x] The grep above is clean. (Only UI label text and comments remain, see the handoff.)
- [x] All instrument factories have the signature `(station, options)`.
- [x] With `?stations=2`, two different latency streams are logged, and no errors appear.
- [x] Reloading keeps the almanac history (same IndexedDB key).

## Out of scope

The page layout system (step 05), the config document (step 06), Prometheus (step 07).

## Handoff

**Built**

- [web/src/station/profile.js](../../web/src/station/profile.js): `createProfile(overrides)` returns a
  deep-frozen `{ id, name, thresh, slo, burnAlerts, home, services, hub, links, serviceOf(host, n),
  stages, stageShare, endpoints, epErrBudget, regions }`. Defaults are exactly the old
  `config.js` values. Plain-object fields (`thresh`, `slo`, `home`) merge one level deep, and
  arrays replace the default table.
- [web/src/station/station.js](../../web/src/station/station.js): `createStation(def)` returns
  `{ id, name, profile, source, store, almanac, get signal(), start(), stop() }`. `def.source` is
  `{ kind: 'sim', hosts, seed, speed }` or `{ kind: 'poll', url, hosts }`. `start()` holds the
  old runtime sequence (backfill → ingest → notes → source.start → almanac load → synthesize).
  `stop()` stops the source and disposes the almanac. `signal` is created on first access.
- [web/src/config.js](../../web/src/config.js) keeps only device constants (`ROWS`, `ROW_SECONDS`,
  `HIST`, `TRACK_STEP`, `ALMANAC_DAYS`) and `CONFIG` (URL parameters).
- [web/src/runtime.js](../../web/src/runtime.js) exports one `station` (id `main`, name from
  `?station=`, source from `?source=`/`?hosts=`/`?speed=`) and starts it.
- `data/*` take the profile: `createTelemetry({ profile, … })`, `createSimulatedSource({ profile,
  …, seed })`, `createPollingSource({ profile, … })`, `createAlmanac({ profile, key })`,
  `createSignal(store, profile)`, `createHistorySynth({ seed })` (it uses no station tables, so
  it only gets the seed).
- All 27 instrument factories are `createX(station, options = {})`. `createReadout`'s old second
  argument is now `options`. [App.jsx](../../web/src/App.jsx) builds `inst` from the station, and
  `TapeOverlay`, the readouts, the module 25 caption, the station plate and the footer node count
  read from `station.profile` / `station.source`. The page JSX is unchanged.
- [web/README.md](../../web/README.md): architecture section (station layer, factory signature,
  `?stations=2`), and the "set in config.js" references now point to the profile.

**Deviations**

- **`SIGNALS` is now `store.signals`.** The page 4 signal list (`LAT, ERR, TPUT, SAT` plus one
  per service) depended on `SERVICES`, so it moved onto the store. `signal.js` and the
  correlator read it from there.
- **`tapeHeight(ms, max)`** takes the full scale as a second argument, since it was a module
  export that read `THRESH.max`.
- **Orbit positions and the pipeline stage count** were module-level values computed from
  `SERVICES`/`HUB`/`STAGES`. They are now computed per instrument.
- **`createHistorySynth({ seed })`**: the step only asked for a seed on the simulator. Without
  one, a second sim station would get the same 30-day past as the first. The seed is salted into
  the per-day hash, and seed 0 (the default) gives exactly the old past. That was checked by
  eye: the older logbook entries on page 5 match before and after (FRI 06 01:55 7M 40MS,
  THU 05 23:18 4M, THU 05 21:26 4M).
- **Sim seed default:** `createSimulatedSource` without `seed` still uses `Date.now()`, so the
  random draw order and behaviour are unchanged. The main station passes no seed.
- **Poll source kind is named `poll`.** ADR-0005 only names `sim` and `prometheus`, so this is
  recorded in open-questions for step 06.
- **`CONFIG` still contains `speed`, `station`, `hosts`, `source`** (the step lists only fps,
  dpr, finish, page, cycle). They are URL parameters that `runtime.js` turns into the station
  definition, and step 06 replaces them with the config document. `CONFIG.stations` was added
  for the debug flag.
- **`?stations=2` is kept as a debug flag** (in `runtime.js`). It starts a hidden second sim
  station `sim2` / `SIM-02` (seed 2) and logs `[MARS] stations main=…ms sim2=…ms` once per
  second with `console.info`. Side effect: that station also writes its own almanac record
  (`SIMULATED:sim:SIM-02`, about 1 MB) into IndexedDB.
- The grep in task 2 isn't literally empty. Its remaining matches are UI text and comments,
  with no identifiers: the labels `SLO`, `OVER SLO`, `SERVICES`, `LINKS` (radar, contacts,
  budget, orbit, telemetry log line, App module captions) and comments in `config.js`,
  `profile.js`, `radar.js`, `budget.js`, `simulator.js`. No module imports a station global
  from `config.js` any more. Only `ROWS`, `ROW_SECONDS`, `HIST`, `TRACK_STEP`, `ALMANAC_DAYS`
  and `CONFIG` are imported.
- `createDotMatrix({ layout, draw, crt })` keeps its signature. It is the dot-matrix
  primitive the panels are built on, not an instrument factory.

**Verification**

```
$ cd web && npm run smoke                     # before the change (baseline) and after
dist/assets/index-Dms-B9E5.js   263.20 kB │ gzip: 95.02 kB
✓ page 1  modules 01–07  → snapshots/page-1.png
  … pages 2–5 ✓
smoke: ok

$ grep -hn "^export function create" web/src/instruments/*.js
  → 27 × "(station, options = {})", plus createDotMatrix (primitive, see above)

$ grep -rn "THRESH\|ENDPOINTS\|REGIONS\|SERVICES\|STAGES\|SLO\b\|HOME\|BURN_ALERTS\|LINKS\|HUB" web/src
  → only UI strings and comments (listed above)

$ node check04.mjs <old web> <new web>        # Playwright script, kept outside the repo
[MARS] stations main=10.67ms sim2=9.46ms
[MARS] stations main=18.51ms sim2=10.00ms     # a spike on main only
…
stations=2: 11 lines, 11 with different values, errors: 0
old build keys: [ 'SIMULATED:sim:INFERENCE-01' ] errors: 0
mark minute: { present: true, lat: 999 }
new build keys: [ 'SIMULATED:sim:INFERENCE-01' ] errors: 0
marked minute after new build saved: { present: true, lat: 999 }   # new build loaded the old record
check04: ok

$ cd probe && uv run pytest -q   → 26 passed, 1 skipped
$ uv run ruff check . && uv run ruff format --check .   → All checks passed / 19 files already formatted
$ cd examples/demo && uv run pytest -q   → 14 passed
$ bash probe/scripts/test-rules.sh   → SUCCESS (promtool via the prom/prometheus image)
$ podman-compose -f deploy/compose.yaml config   → ok (`docker compose` isn't installed on this machine)
```

The almanac check builds the pre-refactor code (`git archive HEAD web`) and the new code, and
serves both on the same origin in one persistent Chromium profile. The old build runs past its
60 s save, then a marker latency (999) is written into a minute 1000 minutes back (older than
the tape, so only `load()` or the synthesizer can fill it). The new build then runs past its
own save. The IndexedDB keys and the marker are read back afterwards. Navigating away did
**not** save reliably: the `pagehide` save didn't commit before unload in headless Chromium,
so the check relies on the 60 s periodic save.

Screenshots (1920×1080, SwiftShader) are in the session scratchpad, not the repo:
`before/page-{1..5}.png` (pre-change build) and `after/page-{1..5}.png`. They were compared by
eye: same housing, layout, captions, threshold labels (WARN 25 / CRIT 35), station plate and
footer. The live data differs because the simulator is time-seeded (the "after" page 1 caught
an incident). `npm run smoke` regenerates `web/snapshots/` at any time.

**Not verified / needs a person**

- The `?source=<url>` polling path was refactored (it takes the profile for route/code
  matching) but not run against a real JSON endpoint.
- Nobody diffed the screenshots pixel by pixel. That can't be done while the sim is time-seeded.
- `station.stop()` isn't called anywhere yet. Step 06 will be its first user.

**Notes for later steps**

- Build instruments with `createX(station, options)`. Never import station settings. Read
  `station.profile.*`. Instruments copy what they need at construction, and the profile is
  frozen, so changing a station means building a new station and new instruments.
- `station.signal` is lazy and costly (page 4 analyser). Don't touch it from non-page-4
  instruments.
- The almanac key is still `${source.kind}:${'sim' | url}:${name}`, so a station's IndexedDB
  history is tied to its **name**, not its id. Step 06 should keep it like that (or migrate)
  when stations come from the config document.
- `store.signals` length depends on `profile.services`. The correlator sizes itself from it.
- `createStation` takes `{ id, name, source, ...overrides }`, the same shape as an ADR-0005
  station entry minus validation, so step 06 can pass parsed entries straight in.
