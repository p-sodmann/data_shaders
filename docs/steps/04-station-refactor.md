# Step 04: Station refactor (no global config)

Status: todo
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

- [ ] `npm run build` and `npm run smoke` pass. The screenshots look the same as step 00's
      (compare them by eye, and attach both in the handoff or name the paths).
- [ ] The grep above is clean.
- [ ] All instrument factories have the signature `(station, options)`.
- [ ] With `?stations=2`, two different latency streams are logged, and no errors appear.
- [ ] Reloading keeps the almanac history (same IndexedDB key).

## Out of scope

The page layout system (step 05), the config document (step 06), Prometheus (step 07).
