import { createTape } from './tape.js';
import { createMeter } from './meter.js';
import { createMatrix } from './matrix.js';
import { createReadout, createLog, createClock, createStatus, createRules, createTrace, createContacts, createOrigins, createRhythms, createLogbook } from './panels.js';
import { createOrbit } from './orbit.js';
import { createFleet } from './fleet.js';
import { createSlices } from './slices.js';
import { createPipeline } from './pipeline.js';
import { createRadar } from './radar.js';
import { createGroundTrack } from './groundtrack.js';
import { createSpectrum } from './spectrum.js';
import { createWaterfall } from './waterfall.js';
import { createXYScope } from './xyscope.js';
import { createCorrelator } from './correlator.js';
import { createWeekDial } from './weekdial.js';
import { createHeatmap } from './heatmap.js';
import { createBudget, createBurnRate } from './budget.js';
import { TapeOverlay } from './overlays/tape.jsx';
import { WaterfallOverlay } from './overlays/waterfall.jsx';
import { DialOverlay } from './overlays/dial.jsx';
import { HeatOverlay } from './overlays/heat.jsx';

// Every instrument a page can mount, by panel type. An entry says how to
// build the instrument from a station and what the module around it looks like:
//
//   name      module header text, or (options) => text
//   meta      header text on the right, or ({ station, snap, options }) => text;
//             snap is the station's store snapshot, so live captions follow the data
//   scope     'station' (built from one station) | 'device' (cross-station, step 10)
//   create    (station, options) => instrument (see gl/engine.js for the interface)
//   overlay   optional React component rendered inside the glass, gets { inst, station, snap, options }
//   needs     station tables the instrument reads; step 07 uses it for discovered stations
//   minW/minH, defaultSize [w, h], aspect   grid cells, enforced by the editor (step 08)
//   options   option schema { key: { type, default, label, values? } }, used by step 08

// The three readouts are one instrument with different presets. Scales come
// from the station's thresholds, so they are resolved at build time.
const READOUTS = {
  latency: {
    name: 'Latency',
    meta: 'P50 · ms',
    preset: (t) => ({ value: (s) => s.disp?.lat, format: (v) => v.toFixed(1), max: t.max, warn: t.warn, crit: t.crit }),
  },
  throughput: {
    name: 'Throughput',
    meta: 'req / s',
    preset: (t) => ({ value: (s) => s.disp?.tp, format: (v) => String(Math.round(v)), max: t.tpMax }),
  },
  errors: {
    name: 'Errors',
    meta: '% of req',
    preset: (t) => ({ value: (s) => s.disp?.err, format: (v) => (v * 100).toFixed(2), max: t.errMax, warn: t.errWarn, crit: t.errCrit }),
  },
};
const readoutOf = (o) => {
  const r = READOUTS[o.signal];
  if (!r) throw new Error(`unknown readout signal "${o.signal}"`);
  return r;
};

const nodeMeta = ({ snap }) => {
  const c = snap.counts;
  return [`${c.ok} OK`, c.warn && `${c.warn} WARN`, c.crit && `${c.crit} CRIT`, c.off && `${c.off} OFF`].filter(Boolean).join(' · ');
};
const contactMeta = ({ station }) => {
  const closing = station.store.endpoints.filter((ep) => ep.live && ep.state).length;
  return closing ? `${closing} inside 75 %` : 'All clear of limits';
};

// Fields every entry shares unless it says otherwise.
const BASE = { scope: 'station', overlay: null, needs: [], minW: 2, minH: 2, aspect: null, options: {} };
const entry = (e) => Object.freeze({ ...BASE, ...e });

export const REGISTRY = Object.freeze({
  // page 1: tape
  tape: entry({
    name: 'Tape archive',
    meta: 'P50 latency · 10 min per row · 4 h',
    create: createTape,
    overlay: TapeOverlay,
    minW: 5, minH: 3, defaultSize: [8, 6],
  }),
  meter: entry({ name: 'Load', meta: 'Cluster saturation %', create: createMeter, minW: 3, defaultSize: [4, 3] }),
  matrix: entry({ name: 'Nodes', meta: nodeMeta, create: createMatrix, minW: 3, defaultSize: [4, 3] }),
  readout: entry({
    name: (o) => readoutOf(o).name,
    meta: ({ options }) => readoutOf(options).meta,
    create: (st, o) => createReadout(st, { ...readoutOf(o).preset(st.profile.thresh), chars: 5 }),
    defaultSize: [2, 2],
    options: { signal: { type: 'enum', values: Object.keys(READOUTS), default: 'latency', label: 'Signal' } },
  }),
  log: entry({ name: 'Event log', meta: 'Teletype', create: createLog, minW: 3, defaultSize: [6, 2] }),

  // page 2: orbit
  orbit: entry({ name: 'Orbit', meta: 'Service topology · live calls', create: createOrbit, minW: 4, minH: 3, defaultSize: [7, 6] }),
  fleet: entry({ name: 'Fleet', meta: 'Per-node latency · 3 min', create: createFleet, minW: 3, defaultSize: [5, 3] }),
  pipeline: entry({ name: 'Pipeline', meta: 'Request stages · ms', create: createPipeline, needs: ['stages'], minW: 3, defaultSize: [5, 2] }),
  slices: entry({ name: 'Slices', meta: 'Fleet fingerprint · 10 min', create: createSlices, minW: 3, defaultSize: [5, 3] }),
  rules: entry({ name: 'Caution & warning', meta: 'Rules', create: createRules, minW: 3, defaultSize: [4, 2] }),
  trace: entry({ name: 'Trace', meta: 'Sampled requests', create: createTrace, needs: ['stages'], minW: 3, defaultSize: [3, 2] }),

  // page 3: sweep
  radar: entry({ name: 'Proximity', meta: 'Endpoints · range = headroom to SLO', create: createRadar, needs: ['endpoints'], minW: 3, minH: 3, defaultSize: [5, 6] }),
  ground: entry({ name: 'Ground track', meta: 'Traffic origins · centre of traffic, 4 h', create: createGroundTrack, needs: ['regions'], minW: 4, minH: 3, defaultSize: [7, 6] }),
  contacts: entry({ name: 'Contacts', meta: contactMeta, create: createContacts, needs: ['endpoints'], minW: 4, defaultSize: [6, 2] }),
  origins: entry({ name: 'Origins', meta: 'Client regions · RTT ms · err %', create: createOrigins, needs: ['regions'], minW: 4, defaultSize: [6, 2] }),

  // page 4: signal
  spectrum: entry({ name: 'Spectrum', meta: 'P50 latency · 4 h reference · 10 min live', create: createSpectrum, minW: 4, defaultSize: [7, 3] }),
  waterfall: entry({
    name: 'Waterfall',
    meta: 'Spectrogram · 30 min window · 1 row per 30 s',
    create: createWaterfall,
    overlay: WaterfallOverlay,
    minW: 4, defaultSize: [7, 3],
  }),
  xy: entry({ name: 'X‑Y scope', meta: 'Latency vs load · operating curve', create: createXYScope, minW: 3, minH: 3, defaultSize: [5, 6] }),
  correlator: entry({ name: 'Correlator', meta: 'Signal pairs · 10 min vs 4 h', create: createCorrelator, minW: 4, defaultSize: [6, 2] }),
  rhythms: entry({ name: 'Rhythms', meta: 'Scheduled behaviour · epoch folding', create: createRhythms, minW: 4, defaultSize: [6, 2] }),

  // page 5: almanac
  dial: entry({
    name: 'Week dial',
    meta: 'P50 · 7 days on a 24 h clock',
    create: createWeekDial,
    overlay: DialOverlay,
    needs: ['almanac'],
    minW: 3, minH: 3, defaultSize: [4, 6],
  }),
  heatmap: entry({
    name: 'Habits',
    meta: 'Typical P50 by weekday and hour · 30 d · ■ incident share',
    create: createHeatmap,
    overlay: HeatOverlay,
    needs: ['almanac'],
    minW: 5, minH: 3, defaultSize: [8, 6],
  }),
  budget: entry({
    name: 'Error budget',
    meta: ({ station }) => `Availability SLO · rolling ${station.profile.slo.days} d`,
    create: createBudget,
    needs: ['almanac'],
    defaultSize: [3, 2],
  }),
  burn: entry({ name: 'Burn rate', meta: '× sustainable · 24 h · multi-window alerts', create: createBurnRate, needs: ['almanac'], minW: 3, defaultSize: [5, 2] }),
  logbook: entry({ name: 'Logbook', meta: 'Incidents · 30 d', create: createLogbook, needs: ['almanac'], minW: 3, defaultSize: [4, 2] }),
});

// Instruments built into the housing (header), not mountable as panels.
export const HOUSING = Object.freeze({ status: createStatus, clock: createClock });

// Panel options with the schema's defaults filled in.
export function resolveOptions(def, options = {}) {
  const out = {};
  for (const [k, spec] of Object.entries(def.options)) out[k] = spec.default;
  return { ...out, ...options };
}

export const panelName = (def, options) => (typeof def.name === 'function' ? def.name(options) : def.name);
export const panelMeta = (def, args) => (typeof def.meta === 'function' ? def.meta(args) : def.meta);
