import { PH, STATE_COLORS } from '../gl/palette.js';
import { drawScope, rangeOf, TAU, PERIOD, ECHOES, LABEL_MIN } from './radar.js';
import { CODE, stationCode, pressureOf } from './stations.js';

// STATION RADAR: the proximity scope (radar.js) with one contact per station.
// The bearing is fixed by the station's place in the document, and the range
// is its headroom: the worst of P50 against crit, error rate against errCrit
// and saturation against satCrit, so the orange ring is "at a crit limit". The
// colour is the station's state, as on its lamp. A STALE station keeps its
// last echo, dimmed and crossed out, until it reports again.

const LIMITS = ['0', '25', '50', '75', 'CRIT'];
// Names are beam dots too, so at most this many contacts are named: those in the
// worst state, then the nearest to their limits. Every contact is still drawn.
const NAMED = 5;

export function createStationRadar(device, options = {}) {
  const echoesOf = new Map(); // station id → [{ r, t, code }]
  const lastTurnOf = new Map();

  return {
    crt: { curve: 0.035, scan: 0.75, bloom: 1.1, decay: 0.9 },
    render(gl, _state, f, v) {
      const { W, H, now, turn, at, cx, cy, R, side } = drawScope(v, f, LIMITS);
      const stations = device.stations;
      const n = stations.length;
      let nearest = null, nearestP = -1;
      const counts = [0, 0, 0, 0];
      const read = stations.map((st) => {
        const code = stationCode(st);
        return { code, p: code === CODE.STALE ? null : pressureOf(st.store) };
      });
      // severity first (stale ranks below degraded), then pressure
      const rank = ({ code, p }) => (code === CODE.STALE ? 0.5 : code) * 10 + (p ?? 0);
      const named = new Set(read.map((r, i) => i).sort((a, b) => rank(read[b]) - rank(read[a])).slice(0, NAMED));

      stations.forEach((st, i) => {
        const { code, p } = read[i];
        counts[code]++;
        const b = ((i + 0.35) / n) * TAU;
        if (!echoesOf.has(st.id)) echoesOf.set(st.id, []);
        const list = echoesOf.get(st.id);
        const k = Math.floor(turn - b / TAU);
        if (k !== lastTurnOf.get(st.id)) {
          lastTurnOf.set(st.id, k);
          // a stale station is painted where it was last seen
          const r = p == null ? list.at(-1)?.r : rangeOf(p);
          if (r != null) {
            list.push({ r, t: now, code });
            if (list.length > ECHOES) list.shift();
          }
        }
        if (p != null && p > nearestP) {
          nearest = st;
          nearestP = p;
        }
        const stale = code === CODE.STALE;
        const dim = stale ? 0.3 : 1;
        const size = 0.07;
        list.forEach((e, j) => {
          const age = (now - e.t) / PERIOD;
          const head = j === list.length - 1;
          const fade = Math.exp(-age * (head ? 0.9 : 1.5)) * (head ? 1 : 0.45);
          const c = STATE_COLORS[e.code];
          const [x0, y0] = at(b - size / e.r / 4, e.r);
          const [x1, y1] = at(b + size / e.r / 4, e.r);
          v.line(x0, y0, x1, y1, c, 0.95 * fade * dim, head ? 1.3 : 0.9);
          if (j > 0) {
            const q = list[j - 1];
            const [ax, ay] = at(b, q.r), [bx, by] = at(b, e.r);
            v.line(ax, ay, bx, by, c, 0.12 * fade * dim, 0.45);
          }
        });
        const e = list.at(-1);
        if (!e) return;
        const glow = stale ? 0 : Math.exp(-((now - e.t) / PERIOD) * 0.9);
        const c = STATE_COLORS[code];
        const [ex, ey] = at(b, e.r);
        if (stale) {
          v.line(ex - 5, ey - 5, ex + 5, ey + 5, PH.ok, 0.35, 0.5);
          v.line(ex - 5, ey + 5, ex + 5, ey - 5, PH.ok, 0.35, 0.5);
        }
        if (!named.has(i)) return;
        const lr = Math.max(e.r, LABEL_MIN);
        const [lx, ly] = at(b, lr);
        if (lr > e.r) {
          const [bx, by] = at(b, e.r + 0.03);
          v.line(bx, by, lx, ly, c, (0.18 + 0.3 * glow) * dim, 0.45);
        }
        const right = Math.sin(b) >= -0.2;
        const label = stale ? `${st.name} STALE` : st.name;
        const tx = right ? lx + 7 : lx - 7 - v.textWidth(label, 1.3);
        v.text(tx, ly - 11, label, c, ((code ? 0.6 : 0.35) + 0.5 * glow) * dim, 1.3);
      });

      // the device in the middle
      v.dot(cx, cy, PH.ok, 0.9, 1.1);
      v.line(cx - 5, cy, cx + 5, cy, PH.ok, 0.4, 0.45);
      v.line(cx, cy - 5, cx, cy + 5, PH.ok, 0.4, 0.45);

      const head = nearest ? Math.round((1 - nearestP) * 100) : 0;
      const nearC = nearest ? STATE_COLORS[stationCode(nearest)] : PH.ok;
      if (side) {
        const lx = cx + R + 34;
        const rows = [];
        if (nearest) {
          rows.push(['NEAREST', null]);
          rows.push([nearest.name, nearC, 1]);
          rows.push([head >= 0 ? `HEADROOM ${head}%` : `OVER ${-head}%`, nearC, 0.9]);
          rows.push(['', null]);
        }
        rows.push([`STATIONS ${n}`, PH.ok, 0.75]);
        rows.push([`DEGRADED ${counts[1]}`, counts[1] ? PH.warn : PH.ok, counts[1] ? 0.85 : 0.75]);
        rows.push([`INCIDENT ${counts[2]}`, counts[2] ? PH.crit : PH.ok, counts[2] ? 0.95 : 0.75]);
        rows.push([`STALE    ${counts[3]}`, PH.ok, counts[3] ? 0.75 : 0.45]);
        rows.forEach(([s, c, inten], k) => v.text(lx, cy - rows.length * 9 + k * 18, s, c ?? PH.ok, inten ?? 0.42, 1.6));
      } else {
        if (nearest) {
          v.text(12, 12, `NEAREST ${nearest.name}`, nearC, 0.85, 1.4);
          v.text(12, 26, head >= 0 ? `HEADROOM ${head}%` : `OVER ${-head}%`, nearC, 0.7, 1.4);
        }
        const bad = counts[2] ? `INCIDENT ${counts[2]}` : counts[1] ? `DEGRADED ${counts[1]}` : `STALE ${counts[3]}`;
        const c = counts[2] ? PH.crit : counts[1] ? PH.warn : PH.ok;
        if (counts[1] || counts[2] || counts[3]) v.text(W - 12 - v.textWidth(bad, 1.4), 12, bad, c, 0.9, 1.4);
      }
      const foot = 'RANGE = HEADROOM TO CRIT';
      v.text(side ? cx + R + 34 : W - 12 - v.textWidth(foot, 1.3), H - 16, foot, PH.ok, 0.3, 1.3);
    },
  };
}
