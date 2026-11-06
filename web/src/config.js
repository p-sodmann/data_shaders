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
  // debug: ?stations=2 runs a second, independent sim station next to the first
  stations: Math.round(num('stations', 1)),
};

// Device constants. Everything that describes a monitored system (thresholds,
// SLO, topology, endpoints, regions) lives in the station profile
// (station/profile.js), so several stations can differ.

// Per-host latency history kept for the fleet and slice instruments.
export const HIST = 600;

// One tape row = one 10-minute window, one sample per second.
export const ROW_SECONDS = 600;
// 24 rows = 4 hours of archive.
export const ROWS = 24;

// The traffic centroid is sampled every TRACK_STEP seconds for the ground track.
export const TRACK_STEP = 30;

// minutes of history kept (and saved in the browser) for page 5
export const ALMANAC_DAYS = 30;
