// What the cross-station instruments (step 10) read of one station. They are
// built once on the device and read its station list every frame, so a station
// that is added, removed, rebuilt (new store) or retuned (new thresholds) shows
// up on the next frame without rebuilding anything. Everything here goes
// through `station.store`, never a copy of it.

// lamp codes, as the nodes shader knows them: 3 is dark and struck through
export const CODE = { NOMINAL: 0, DEGRADED: 1, INCIDENT: 2, STALE: 3 };

// The station's lamp code. A station still loading its tape has nothing to
// show yet, so it reads like a stale one.
export function stationCode(station) {
  if (station.getStatus?.().phase === 'load') return CODE.STALE;
  return CODE[station.store.status] ?? CODE.NOMINAL;
}

// How close the station is to its limits, as the worst of P50 against crit,
// error rate against errCrit and saturation against satCrit: 1 is at the
// limit, 0 idle. null before the first sample.
export function pressureOf(store) {
  const d = store.disp;
  if (!d) return null;
  const t = store.profile.thresh;
  const sat = store.latest?.saturation ?? 0;
  return Math.max(d.lat / t.crit, d.err / t.errCrit, sat / t.satCrit, 0);
}

// The numerals line of a station: P50 and RPS, or why there are none. Longest
// form first, so a narrow lamp can take the first one that fits.
export function numerals(station, code) {
  if (station.getStatus?.().phase === 'load') return ['TAPE LOAD', 'LOAD'];
  if (code === CODE.STALE) return ['STALE'];
  const d = station.store.disp;
  if (!d) return ['--'];
  const lat = d.lat.toFixed(1), rps = Math.round(d.tp);
  return [`${lat} MS  ${rps} RPS`, `${lat}MS ${rps}RPS`, `${lat} MS`];
}

// The caption of a cross-station module: how many stations it shows.
export const stationCount = ({ station: device }) => {
  const n = device.stations?.length ?? 0;
  return n === 1 ? '1 station' : `${n} stations`;
};
