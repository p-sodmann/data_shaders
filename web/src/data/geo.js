// Spherical helpers for the ground-track map and the region simulator.
// Angles in degrees unless noted.

const R = Math.PI / 180;

export const toVec = (lat, lon) => [
  Math.cos(lat * R) * Math.cos(lon * R),
  Math.cos(lat * R) * Math.sin(lon * R),
  Math.sin(lat * R),
];

export const fromVec = ([x, y, z]) => [Math.atan2(z, Math.hypot(x, y)) / R, Math.atan2(y, x) / R];

export function distanceKm(lat0, lon0, lat1, lon1) {
  const a = toVec(lat0, lon0), b = toVec(lat1, lon1);
  const d = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(d) * 6371;
}

// n+1 points along the great circle from a to b, as [lat, lon]
export function greatCircle(lat0, lon0, lat1, lon1, n = 48) {
  const a = toVec(lat0, lon0), b = toVec(lat1, lon1);
  const w = Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    if (w < 1e-6) {
      out.push([lat0, lon0]);
      continue;
    }
    const ka = Math.sin((1 - u) * w) / Math.sin(w), kb = Math.sin(u * w) / Math.sin(w);
    out.push(fromVec([a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb]));
  }
  return out;
}

// Sub-solar point at unix time t (seconds), good to about a degree.
export function sunPosition(t) {
  const d = new Date(t * 1000);
  const doy = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5;
  const dec = -23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10));
  const hours = (t % 86400) / 3600;
  const lon = ((((12 - hours) * 15 + 180) % 360) + 360) % 360 - 180;
  return { lat: dec, lon };
}

// Local solar hour (0..24) at a longitude.
export const solarHour = (t, lon) => ((((t % 86400) / 3600 + lon / 15) % 24) + 24) % 24;
