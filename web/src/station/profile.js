// A station profile: everything that describes one monitored system rather
// than the device (thresholds, SLO, topology, endpoints, regions). Several
// stations each carry their own, so nothing here is a module global any more.
// The defaults are the values the device shipped with for its one simulated station.

const DEFAULTS = {
  thresh: {
    warn: 25, // ms P50 latency
    crit: 35,
    max: 60, // full scale of the tape
    errWarn: 0.008, // fraction of requests
    errCrit: 0.02,
    errMax: 0.03,
    satWarn: 0.75,
    satCrit: 0.9,
    tpMax: 700, // req/s full scale
  },

  // Page 5. Availability SLO: the fraction of requests that must succeed over a
  // rolling window. The error budget is what is left of the other (1 - target).
  slo: { target: 0.995, days: 30 },
  // Multi-window burn-rate alerts (as in the Google SRE workbook): a long and a
  // short window must both burn faster than the rate for the alert to fire.
  burnAlerts: [
    { name: 'FAST BURN', rate: 14.4, long: 60, short: 5 },
    { name: 'SLOW BURN', rate: 6, long: 360, short: 30 },
  ],

  // Where this station is; traffic arcs on the ground track run to it.
  home: { lat: 50.1, lon: 8.7 },

  // Service topology. Hosts are split evenly across services in order.
  services: ['GATEWAY', 'AUTH', 'INFER', 'EMBED', 'RANK', 'CACHE', 'STORE', 'QUEUE'],
  hub: 2,
  links: [
    [0, 1], [0, 2], [1, 6], [2, 3], [2, 4], [2, 5], [3, 5], [4, 6], [2, 7], [7, 6],
  ],

  // Request pipeline stages and their normal share of total latency.
  stages: ['INGRESS', 'AUTH', 'EMBED', 'INFER', 'RANK', 'EGRESS'],
  stageShare: [0.08, 0.06, 0.18, 0.46, 0.16, 0.06],

  // Page 3. Endpoints are the radar contacts: [route, share of traffic, P95 SLO ms].
  // A contact closes in on the scope as its P95 nears the SLO or its errors
  // near the error budget.
  endpoints: [
    ['/v1/predict', 0.4, 40],
    ['/v1/embed', 0.17, 25],
    ['/v1/rank', 0.11, 30],
    ['/v1/stream', 0.08, 60],
    ['/v1/tokenize', 0.07, 8],
    ['/v1/models', 0.06, 15],
    ['/v1/batch', 0.04, 120],
    ['/v1/feedback', 0.03, 20],
    ['/healthz', 0.04, 5],
  ],
  epErrBudget: 0.01, // error fraction that counts as "at the limit"

  // Where clients connect from: [code, name, lat, lon, share of traffic].
  regions: [
    ['IAD', 'US EAST', 38.9, -77.4, 0.2],
    ['SFO', 'US WEST', 37.6, -122.4, 0.12],
    ['MEX', 'MEXICO', 19.4, -99.1, 0.04],
    ['GRU', 'BRAZIL', -23.4, -46.5, 0.05],
    ['LHR', 'UK', 51.5, -0.5, 0.12],
    ['MAD', 'IBERIA', 40.5, -3.6, 0.06],
    ['JNB', 'S AFRICA', -26.1, 28.2, 0.02],
    ['DXB', 'GULF', 25.3, 55.4, 0.04],
    ['BOM', 'INDIA', 19.1, 72.9, 0.08],
    ['SIN', 'SE ASIA', 1.4, 103.99, 0.09],
    ['NRT', 'JAPAN', 35.8, 140.4, 0.13],
    ['SYD', 'AUSTRALIA', -33.9, 151.2, 0.05],
  ],
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Instruments copy what they need out of the tables, so freezing the whole
// tree costs nothing and catches a module that tries to edit shared settings.
function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

// Overrides are merged one level deep: `{ thresh: { warn: 40 } }` keeps the
// other thresholds, while an array (`endpoints`, `regions`, ...) replaces the
// default table as a whole.
export function createProfile(overrides = {}) {
  const p = { id: overrides.id ?? 'main', name: overrides.name ?? 'MAIN' };
  for (const [key, def] of Object.entries(DEFAULTS)) {
    const o = overrides[key];
    if (o === undefined) p[key] = structuredClone(def);
    else if (isPlainObject(def) && isPlainObject(o)) p[key] = { ...structuredClone(def), ...structuredClone(o) };
    else p[key] = structuredClone(o);
  }
  const n = p.services.length;
  p.serviceOf = (host, hostCount) => Math.floor((host * n) / hostCount);
  return deepFreeze(p);
}
