// Device constants. Everything that describes a monitored system (thresholds,
// SLO, topology, endpoints, regions) lives in the station profile
// (station/profile.js), so several stations can differ. Settings that a user
// changes (stations, pages, finish, fps) come from the config document
// (config/load.js), never from here.

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
