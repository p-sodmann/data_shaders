import { PH, STATE_COLORS } from '../gl/palette.js';

// 14 PROXIMITY: a PPI radar scope with one contact per endpoint. Bearing is
// fixed per endpoint; range is headroom. A contact at the rim is idle, one on
// the amber ring is at 75 % of its limit, one on the orange ring is at its
// SLO (P95 latency or error budget, whichever is closer). The beam paints a
// contact as it passes, the echo fades over the following turns, and the
// faint echoes behind a contact show which way it is heading.

const TAU = Math.PI * 2;
const PERIOD = 6; // seconds per turn
const ECHOES = 7;
const WARN_P = 0.75;

// pressure (fraction of the limit) to radius (fraction of the scope): linear
// down to the SLO ring, then compressed so contacts past it keep their order
const rangeOf = (p) => (p <= 1 ? 1 - 0.8 * Math.max(0, p) : Math.max(0.03, 0.2 * Math.exp(-(p - 1) * 0.8)));
const LABEL_MIN = 0.42; // labels of close contacts stay outside the inner rings
const RINGS = [
  [1, '0'],
  [0.8, '25'],
  [0.6, '50'],
  [rangeOf(WARN_P), '75'],
  [rangeOf(1), 'SLO'],
];

export function createRadar(store) {
  const n = store.endpoints.length;
  const bearing = store.endpoints.map((_, i) => ((i + 0.35) / n) * TAU);
  const echoes = store.endpoints.map(() => []);
  const lastTurn = new Float64Array(n).fill(NaN);

  return {
    crt: { curve: 0.035, scan: 0.75, bloom: 1.1, decay: 0.9 },
    render(gl, _state, f, v) {
      const W = v.w, H = v.h;
      const now = f.now / 1000;
      const side = W - 2 * Math.min(H * 0.5, W * 0.5) > 200; // room for a readout column
      const R = Math.max(20, Math.min(H * 0.5 - 22, (side ? W - 190 : W) * 0.5 - 22));
      const cx = side ? R + 26 : W / 2, cy = H / 2;
      const at = (b, r) => [cx + Math.sin(b) * R * r, cy - Math.cos(b) * R * r];
      const turn = now / PERIOD;
      const sweep = (turn % 1) * TAU;

      // range rings, the warn and SLO rings in their colours
      RINGS.forEach(([r, label], k) => {
        const c = k === 4 ? PH.crit : k === 3 ? PH.warn : PH.ok;
        const steps = Math.max(24, Math.round(r * R * 0.9));
        for (let i = 0; i < steps; i++) {
          const [x, y] = at((i / steps) * TAU, r);
          v.dot(x, y, c, k === 0 ? 0.28 : k >= 3 ? 0.3 : 0.14, 0.5);
        }
        const [lx, ly] = at(TAU * 0.0, r);
        v.text(lx + 3, ly + 2, label, c, k >= 3 ? 0.55 : 0.32, 1.3);
      });
      // bearing scale
      for (let d = 0; d < 360; d += 5) {
        const b = (d / 360) * TAU, long = d % 30 === 0;
        const [x0, y0] = at(b, 1);
        const [x1, y1] = at(b, 1 + (long ? 7 : 3) / R);
        v.line(x0, y0, x1, y1, PH.ok, long ? 0.45 : 0.22, 0.45);
        if (long) {
          const s = String(d).padStart(3, '0');
          const [tx, ty] = at(b, 1 + 15 / R);
          v.text(tx - v.textWidth(s, 1.3) / 2, ty - 4.5, s, PH.ok, 0.4, 1.3);
        }
      }
      for (let k = 0; k < 4; k++) {
        const [x, y] = at((k * TAU) / 4, 1);
        v.line(cx, cy, x, y, PH.ok, 0.05, 0.45);
      }

      // beam with its afterglow wedge
      for (let j = 0; j < 36; j++) {
        const [x, y] = at(sweep - j * 0.022, 1);
        v.line(cx, cy, x, y, PH.ok, (j ? 0.32 : 0.9) * Math.exp(-j / 9), j ? 0.8 : 0.6);
      }

      // contacts
      const eps = store.endpoints;
      let nearest = null, closing = 0, over = 0, live = 0;
      eps.forEach((ep, i) => {
        if (!ep.live) return;
        live++;
        if (ep.trend > 0.002) closing++;
        if (ep.state === 2) over++;
        if (!nearest || ep.pressure > nearest.pressure) nearest = ep;
        const k = Math.floor(turn - bearing[i] / TAU);
        if (k !== lastTurn[i]) {
          lastTurn[i] = k;
          echoes[i].push({ r: rangeOf(ep.pressure), t: now, state: ep.state, rps: ep.rps });
          if (echoes[i].length > ECHOES) echoes[i].shift();
        }
        const list = echoes[i];
        const b = bearing[i];
        const size = 0.035 + 0.06 * Math.sqrt(Math.min(1, ep.share * 2.2));
        list.forEach((e, j) => {
          const age = (now - e.t) / PERIOD;
          const head = j === list.length - 1;
          const fade = Math.exp(-age * (head ? 0.9 : 1.5)) * (head ? 1 : 0.45);
          const c = STATE_COLORS[e.state];
          const [x0, y0] = at(b - size / e.r / 4, e.r);
          const [x1, y1] = at(b + size / e.r / 4, e.r);
          v.line(x0, y0, x1, y1, c, 0.95 * fade, head ? 1.3 : 0.9);
          if (j > 0) {
            const p = list[j - 1];
            const [ax, ay] = at(b, p.r), [bx, by] = at(b, e.r);
            v.line(ax, ay, bx, by, c, 0.12 * fade, 0.45);
          }
        });
        const e = list[list.length - 1];
        if (!e) return;
        const glow = Math.exp(-((now - e.t) / PERIOD) * 0.9);
        const c = STATE_COLORS[ep.state];
        const lr = Math.max(e.r, LABEL_MIN);
        const [lx, ly] = at(b, lr);
        if (lr > e.r) {
          const [bx, by] = at(b, e.r + 0.03);
          v.line(bx, by, lx, ly, c, 0.18 + 0.3 * glow, 0.45);
        }
        const right = Math.sin(b) >= -0.2;
        const label = ep.route.replace('/v1/', '/');
        const tx = right ? lx + 7 : lx - 7 - v.textWidth(label, 1.3);
        v.text(tx, ly - 11, label, c, (ep.state ? 0.55 : 0.25) + 0.5 * glow, 1.3);
      });

      // own station
      v.dot(cx, cy, PH.ok, 0.9, 1.1);
      v.line(cx - 5, cy, cx + 5, cy, PH.ok, 0.4, 0.45);
      v.line(cx, cy - 5, cx, cy + 5, PH.ok, 0.4, 0.45);

      // readout column
      const lx = side ? cx + R + 34 : 12;
      const rows = [];
      if (nearest) {
        const head = Math.round((1 - nearest.pressure) * 100);
        rows.push(['NEAREST', null]);
        rows.push([nearest.route, STATE_COLORS[nearest.state], 1]);
        rows.push([head >= 0 ? `HEADROOM ${head}%` : `OVER ${-head}%`, STATE_COLORS[nearest.state], 0.9]);
        rows.push(['', null]);
      }
      rows.push([`CONTACTS ${live}`, PH.ok, 0.75]);
      rows.push([`CLOSING  ${closing}`, closing ? PH.warn : PH.ok, closing ? 0.85 : 0.75]);
      rows.push([`OVER SLO ${over}`, over ? PH.crit : PH.ok, over ? 0.95 : 0.75]);
      rows.push([`SWEEP    ${PERIOD.toFixed(1)}S`, PH.ok, 0.75]);
      if (side) {
        rows.forEach(([s, c, inten], k) => v.text(lx, cy - rows.length * 9 + k * 18, s, c ?? PH.ok, inten ?? 0.42, 1.6));
      } else {
        if (nearest) {
          const head = Math.round((1 - nearest.pressure) * 100);
          v.text(lx, 12, `NEAREST ${nearest.route}`, STATE_COLORS[nearest.state], 0.85, 1.4);
          v.text(lx, 26, head >= 0 ? `HEADROOM ${head}%` : `OVER ${-head}%`, STATE_COLORS[nearest.state], 0.7, 1.4);
        }
        const s = over ? `OVER SLO ${over}` : `CLOSING ${closing}`;
        const c = over ? PH.crit : closing ? PH.warn : PH.ok;
        v.text(W - 12 - v.textWidth(s, 1.4), 12, s, c, over || closing ? 0.9 : 0.5, 1.4);
      }
      v.text(side ? lx : W - 12 - v.textWidth('RANGE = HEADROOM', 1.3), H - 16, 'RANGE = HEADROOM', PH.ok, 0.3, 1.3);
    },
  };
}
