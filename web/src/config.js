// Runtime configuration. Everything can be overridden from the URL, e.g.
// ?speed=20&station=edge-eu-2&hosts=48&fps=30&finish=ivory&source=/telemetry.json
const q = new URLSearchParams(location.search);
const num = (key, fallback) => {
  const v = parseFloat(q.get(key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const CONFIG = {
  speed: num('speed', 1),
  station: (q.get('station') || 'INFERENCE-01').toUpperCase(),
  hosts: Math.round(num('hosts', 32)),
  fps: num('fps', 60),
  dpr: num('dpr', 2),
  finish: q.get('finish') === 'ivory' ? 'ivory' : 'graphite',
  source: q.get('source') || 'sim',
  page: Math.round(num('page', 0)),
  cycle: num('cycle', 0), // seconds per page when auto-cycling; 0 = off
};

// Per-host latency history kept for the fleet and slice instruments.
export const HIST = 600;

// Service topology. Hosts are split evenly across services in order.
export const SERVICES = ['GATEWAY', 'AUTH', 'INFER', 'EMBED', 'RANK', 'CACHE', 'STORE', 'QUEUE'];
export const HUB = 2;
export const LINKS = [
  [0, 1], [0, 2], [1, 6], [2, 3], [2, 4], [2, 5], [3, 5], [4, 6], [2, 7], [7, 6],
];
export const serviceOf = (host, hostCount) => Math.floor((host * SERVICES.length) / hostCount);

// Request pipeline stages and their normal share of total latency.
export const STAGES = ['INGRESS', 'AUTH', 'EMBED', 'INFER', 'RANK', 'EGRESS'];
export const STAGE_SHARE = [0.08, 0.06, 0.18, 0.46, 0.16, 0.06];

// One tape row = one 10-minute window, one sample per second.
export const ROW_SECONDS = 600;
// 24 rows = 4 hours of archive.
export const ROWS = 24;

export const THRESH = {
  warn: 25, // ms P50 latency
  crit: 35,
  max: 60, // full scale of the tape
  errWarn: 0.008, // fraction of requests
  errCrit: 0.02,
  errMax: 0.03,
  satWarn: 0.75,
  satCrit: 0.9,
  tpMax: 700, // req/s full scale
};

// Page 3. Endpoints are the radar contacts: [route, share of traffic, P95 SLO ms].
// A contact closes in on the scope as its P95 nears the SLO or its errors
// near the error budget.
export const ENDPOINTS = [
  ['/v1/predict', 0.4, 40],
  ['/v1/embed', 0.17, 25],
  ['/v1/rank', 0.11, 30],
  ['/v1/stream', 0.08, 60],
  ['/v1/tokenize', 0.07, 8],
  ['/v1/models', 0.06, 15],
  ['/v1/batch', 0.04, 120],
  ['/v1/feedback', 0.03, 20],
  ['/healthz', 0.04, 5],
];
export const EP_ERR_BUDGET = 0.01; // error fraction that counts as "at the limit"

// Where clients connect from: [code, name, lat, lon, share of traffic].
// HOME is this station; traffic arcs run from each region to it.
export const HOME = { lat: 50.1, lon: 8.7 };
export const REGIONS = [
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
];
// The traffic centroid is sampled every TRACK_STEP seconds for the ground track.
export const TRACK_STEP = 30;

// Page 5. Availability SLO: the fraction of requests that must succeed over a
// rolling window. The error budget is what is left of the other (1 - target).
export const SLO = { target: 0.995, days: 30 };
// Multi-window burn-rate alerts (as in the Google SRE workbook): a long and a
// short window must both burn faster than the rate for the alert to fire.
export const BURN_ALERTS = [
  { name: 'FAST BURN', rate: 14.4, long: 60, short: 5 },
  { name: 'SLOW BURN', rate: 6, long: 360, short: 30 },
];
// minutes of history kept (and saved in the browser) for page 5
export const ALMANAC_DAYS = 30;
