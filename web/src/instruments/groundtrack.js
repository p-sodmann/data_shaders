import { HOME, TRACK_STEP } from '../config.js';
import { PH, STATE_COLORS } from '../gl/palette.js';
import { greatCircle, sunPosition } from '../data/geo.js';
import { LAND } from './land.js';
import { hash } from './space.js';

// 15 GROUND TRACK: a mission-control world map of where traffic comes from.
// Land is a dot screen, lit on the day side of the terminator. Every client
// region sends packets along its great-circle arc to this station, at a
// density set by its request rate, in its route colour. The bright cursor is
// the request-weighted centre of all traffic; its trail over the last four
// hours is the ground track, which drifts west as the working day moves
// around the planet.

const R = Math.PI / 180;
const LAT0 = 80, LAT1 = -60;
const fmtLat = (lat) => `${Math.abs(lat).toFixed(0).padStart(2, '0')}${lat < 0 ? 'S' : 'N'}`;
const fmtLon = (lon) => `${Math.abs(lon).toFixed(0).padStart(3, '0')}${lon < 0 ? 'W' : 'E'}`;

export function createGroundTrack(store) {
  const arcs = store.regions.map((rg) => greatCircle(rg.lat, rg.lon, HOME.lat, HOME.lon, 64));
  const cellLat = Array.from({ length: LAND.rows }, (_, r) => (LAND.lat0 - (r + 0.5) * LAND.step) * R);
  const cellLon = Array.from({ length: LAND.cols }, (_, c) => (LAND.lon0 + (c + 0.5) * LAND.step) * R);

  return {
    crt: { curve: 0.03, scan: 0.8, bloom: 1.0, decay: 0.84 },
    render(gl, _state, f, v) {
      const W = v.w, H = v.h, t = f.time;
      const simT = store.now();
      // fit the 360 x 140 degree map, leave a line for the readout below
      const mw = Math.min(W - 28, ((H - 44) * 360) / (LAT0 - LAT1));
      const mh = (mw * (LAT0 - LAT1)) / 360;
      const x0 = (W - mw) / 2, y0 = Math.max(14, (H - 26 - mh) / 2);
      const px = (lon) => x0 + ((lon + 180) / 360) * mw;
      const py = (lat) => y0 + ((LAT0 - lat) / (LAT0 - LAT1)) * mh;
      const pitch = mw / LAND.cols;

      // graticule
      for (let lon = -180; lon <= 180; lon += 30) {
        const x = px(lon);
        for (let lat = LAT1; lat <= LAT0; lat += 2.5) v.dot(x, py(lat), PH.ok, lon === 0 ? 0.14 : 0.07, 0.4);
        v.line(x, y0 + mh, x, y0 + mh + 3, PH.ok, 0.3, 0.45);
        if (lon > -180 && lon < 180 && lon % 60 === 0) {
          const s = lon === 0 ? '0' : fmtLon(lon);
          v.text(x - v.textWidth(s, 1.2) / 2, y0 + mh + 6, s, PH.ok, 0.3, 1.2);
        }
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        const y = py(lat);
        for (let lon = -180; lon <= 180; lon += 2.5) v.dot(px(lon), y, PH.ok, lat === 0 ? 0.14 : 0.07, 0.4);
        v.line(x0 - 3, y, x0, y, PH.ok, 0.3, 0.45);
      }
      v.poly([[x0, y0], [x0 + mw, y0], [x0 + mw, y0 + mh], [x0, y0 + mh]], PH.ok, 0.16, 0.45, true);

      // land, lit by the sun
      const sun = sunPosition(simT);
      const sd = sun.lat * R, sl = sun.lon * R;
      const sinD = Math.sin(sd), cosD = Math.cos(sd);
      const dotSize = Math.max(0.45, Math.min(1, pitch * 0.17));
      for (const [r, c] of LAND.cells) {
        const la = cellLat[r];
        const cz = Math.sin(la) * sinD + Math.cos(la) * cosD * Math.cos(cellLon[c] - sl);
        const day = Math.min(1, Math.max(0, (cz + 0.08) / 0.16));
        v.dot(x0 + (c + 0.5) * pitch, y0 + (r + 0.5) * pitch, PH.ok, 0.09 + 0.24 * day, dotSize);
      }

      // terminator and the sub-solar point
      const tanD = Math.tan(Math.abs(sd) < 0.01 ? 0.01 * Math.sign(sd || 1) : sd);
      let prev = null;
      for (let lon = -180; lon <= 180; lon += 2) {
        const lat = Math.atan(-Math.cos(lon * R - sl) / tanD) / R;
        const p = lat <= LAT0 && lat >= LAT1 ? [px(lon), py(lat)] : null;
        if (p && prev) v.line(prev[0], prev[1], p[0], p[1], PH.ok, 0.1, 0.45);
        prev = p;
      }
      const sx = px(sun.lon), sy = py(Math.max(LAT1, Math.min(LAT0, sun.lat)));
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU_;
        v.dot(sx + Math.cos(a) * 5, sy + Math.sin(a) * 5, PH.ok, 0.45, 0.45);
      }
      v.dot(sx, sy, PH.ok, 0.6, 0.9);

      // traffic arcs and packets
      const regs = store.regions;
      const total = regs.reduce((a, rg) => a + (rg.live ? rg.rps : 0), 0) || 1;
      regs.forEach((rg, i) => {
        if (!rg.live) return;
        const pts = arcs[i];
        const c = STATE_COLORS[rg.state];
        const share = rg.rps / total;
        const xy = pts.map(([la, lo]) => [px(lo), py(la), lo]);
        for (let j = 1; j < xy.length; j++) {
          if (Math.abs(xy[j][2] - xy[j - 1][2]) > 180) continue; // wraps the date line
          v.line(xy[j - 1][0], xy[j - 1][1], xy[j][0], xy[j][1], c, (rg.state ? 0.2 : 0.07) + 0.25 * share, 0.5);
        }
        const count = 1 + Math.round(share * 24);
        const speed = 0.12 + 0.12 * hash(i * 3.1);
        for (let k = 0; k < count; k++) {
          const u = (t * speed + k / count + hash(i)) % 1;
          const fi = u * (xy.length - 1), a = Math.floor(fi), b = Math.min(xy.length - 1, a + 1);
          if (Math.abs(xy[b][2] - xy[a][2]) > 180) continue;
          const w = fi - a;
          const lost = hash(i * 97 + k + Math.floor(t * speed + k / count)) < rg.err * 10;
          v.dot(xy[a][0] + (xy[b][0] - xy[a][0]) * w, xy[a][1] + (xy[b][1] - xy[a][1]) * w, lost ? PH.crit : c, 0.85 * Math.sin(Math.PI * u) + 0.1, 0.8);
        }
        // region marker: bracket sized by request rate
        const [mx, my] = [px(rg.lon), py(rg.lat)];
        const s = 2.5 + 7 * Math.sqrt(share);
        const pulse = rg.state === 2 ? (Math.sin(t * 6) > 0 ? 1 : 0.35) : 1;
        v.poly([[mx - s, my - s + 2], [mx - s, my - s], [mx - s + 2, my - s]], c, 0.6 * pulse, 0.5);
        v.poly([[mx + s, my + s - 2], [mx + s, my + s], [mx + s - 2, my + s]], c, 0.6 * pulse, 0.5);
        v.dot(mx, my, c, 0.9 * pulse, 0.6 + 1.4 * Math.sqrt(share));
        v.text(mx + s + 3, my - s - 3, rg.code, c, (rg.state ? 0.9 : 0.5) * pulse, 1.25);
      });

      // this station
      const hx = px(HOME.lon), hy = py(HOME.lat);
      v.poly([[hx, hy - 6], [hx + 6, hy], [hx, hy + 6], [hx - 6, hy]], PH.ok, 0.85, 0.55, true);
      v.dot(hx, hy, PH.ok, 1, 0.8);

      // ground track of the traffic centre
      const track = store.trackPoints();
      const span = track.length ? track[track.length - 1].t - track[0].t || 1 : 1;
      let last = null;
      track.forEach((p, k) => {
        const q = [px(p.lon), py(p.lat), p.lon];
        const age = 1 - (p.t - track[0].t) / span;
        if (k % 2 === 0) v.dot(q[0], q[1], PH.ok, 0.15 + 0.6 * (1 - age), 0.6);
        if (last && Math.abs(q[2] - last[2]) < 90 && p.t - last[3] <= TRACK_STEP * 2) {
          v.line(last[0], last[1], q[0], q[1], PH.ok, 0.05 + 0.15 * (1 - age), 0.45);
        }
        last = [...q, p.t];
        // hour marks along the track
        if (p.t % 3600 === 0) {
          v.line(q[0], q[1] - 3, q[0], q[1] + 3, PH.ok, 0.5, 0.45);
          const hh = String(new Date(p.t * 1000).getHours()).padStart(2, '0');
          v.text(q[0] - 3, q[1] + 6, hh, PH.ok, 0.35, 1.2);
        }
      });
      const cen = store.centroid;
      if (cen) {
        const cx = px(cen[1]), cy = py(cen[0]);
        const r = 7 + Math.sin(t * 2) * 0.6;
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * TAU_;
          v.dot(cx + Math.cos(a) * r, cy + Math.sin(a) * r, PH.ok, 0.6, 0.5);
        }
        v.line(cx - r - 6, cy, cx - r - 1, cy, PH.ok, 0.8, 0.5);
        v.line(cx + r + 1, cy, cx + r + 6, cy, PH.ok, 0.8, 0.5);
        v.line(cx, cy - r - 6, cx, cy - r - 1, PH.ok, 0.8, 0.5);
        v.line(cx, cy + r + 1, cx, cy + r + 6, PH.ok, 0.8, 0.5);
        v.dot(cx, cy, mixWhite(PH.ok), 1.2, 1.1);
      }

      // readout
      const by = H - 13;
      const d = new Date(simT * 1000);
      const utc = `UTC ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
      let x = v.text(x0, by, utc, PH.ok, 0.8, 1.4) + 16;
      x = v.text(x, by, `SUN ${fmtLat(sun.lat)} ${fmtLon(sun.lon)}`, PH.ok, 0.5, 1.4) + 16;
      if (cen) x = v.text(x, by, `CENTRE ${fmtLat(cen[0])} ${fmtLon(cen[1])}`, PH.ok, 0.8, 1.4) + 16;
      const bad = regs.filter((rg) => rg.live && rg.state);
      const s = bad.length ? `ROUTES ${bad.map((rg) => rg.code).join(' ')}` : `${regs.filter((rg) => rg.live).length} ROUTES NOMINAL`;
      v.text(x0 + mw - v.textWidth(s, 1.4), by, s, bad.length ? STATE_COLORS[Math.max(...bad.map((rg) => rg.state))] : PH.ok, bad.length ? 0.9 : 0.5, 1.4);
    },
  };
}

const TAU_ = Math.PI * 2;
const mixWhite = (c) => c.map((x) => x * 0.6 + 0.4);
