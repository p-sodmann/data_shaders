import { THRESH } from '../config.js';
import { PH } from '../gl/palette.js';
import { CURVE_BINS } from '../data/signal.js';

// 20 X-Y SCOPE: latency (Y) against saturation (X), like a scope in X-Y mode.
// The faint cloud is the last four hours; the dotted line through it is the
// operating curve (the typical latency at each load) with its 90th-percentile
// edge above. The beam traces the last three minutes. Latency is on a log
// scale that ranges itself over the cloud, the curve and the beam, so an
// incident stays on the face instead of shooting off the top. As long as the beam
// rides the curve, latency is explained by load. When it lifts off the curve,
// something other than load is slowing requests down, and that is the earliest
// honest sign of trouble. The knee is where the curve starts to climb steeply.

const TRAIL = 180;
// 1-2-5 ladder for log-axis ticks and range snapping
const LADDER = [];
for (let e = -1; e <= 4; e++) for (const m of [1, 2, 5]) LADDER.push(m * 10 ** e);
const snapDown = (v) => [...LADDER].reverse().find((l) => l <= v) ?? LADDER[0];
const snapUp = (v) => LADDER.find((l) => l >= v) ?? LADDER[LADDER.length - 1];
const fmtMs = (v) => (v < 1 ? v.toFixed(1) : String(Math.round(v)));

export function createXYScope(store, signal) {
  let ema = null;
  let range = null; // eased Y range: [log10 lo, log10 hi]
  return {
    crt: { curve: 0.035, scan: 0.8, bloom: 1.05, decay: 0.86 },
    render(gl, _state, f, v) {
      signal.update(f.now);
      const now = store.latest?.t;
      if (now == null) return;
      const { curve } = signal;
      const W = v.w, H = v.h;
      const side = Math.min(W - 70, H - 64);
      const L = Math.max(44, (W - side) / 2), B = H - 30, R = L + side, T = B - side;
      const lat = store.window(0, now - TRAIL + 1, TRAIL, 1);
      const sat = store.window(3, now - TRAIL + 1, TRAIL, 1);

      // Auto range on Y (log): from the 1st percentile of the cloud to the
      // highest of its 99.5th percentile, the curve's upper edge and the beam.
      // The target snaps to round values and the face eases toward it.
      // X is fixed at 0-100 % load.
      const cl = curve.cloud;
      const ys = [];
      for (let i = 1; i < cl.length; i += 2) if (cl[i] > 0) ys.push(cl[i]);
      ys.sort((a, b) => a - b);
      const q = (a, p, d) => a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? d;
      let yHi = q(ys, 0.995, 20);
      for (const h of curve.hi) if (h === h) yHi = Math.max(yHi, h);
      for (let i = 0; i < TRAIL; i++) if (lat[i] === lat[i]) yHi = Math.max(yHi, lat[i]);
      const top = snapUp(yHi * 1.15);
      let bottom = snapDown(Math.max(0.1, q(ys, 0.01, 5) * 0.8));
      if (top / bottom < 5) bottom = snapDown(top / 5);
      const target = [Math.log10(bottom), Math.log10(top)];
      const ease = range ? 1 - Math.exp(-(f.dt || 0.016) * 2.5) : 1;
      range = target.map((t, i) => (range ? range[i] + (t - range[i]) * ease : t));
      const [ly0, ly1] = range;

      const x = (s) => L + Math.max(0, Math.min(1, s)) * (R - L);
      const y = (ms) => B - Math.max(0, Math.min(1, (Math.log10(Math.max(1e-3, ms)) - ly0) / (ly1 - ly0))) * (B - T);

      // graticule: 10 load divisions; latency decades bright, 1-2-5 steps
      // labelled, the rest of each decade faint
      for (let i = 0; i <= 10; i++) {
        const gx = L + (i / 10) * (R - L);
        for (let k = 0; k <= 50; k++) v.dot(gx, T + (k / 50) * (B - T), PH.ok, i % 5 ? 0.05 : 0.11, 0.4);
      }
      for (let e = Math.floor(ly0); e <= Math.ceil(ly1); e++) {
        for (let m = 1; m <= 9; m++) {
          const ms = m * 10 ** e, lg = Math.log10(ms);
          if (lg < ly0 - 1e-6 || lg > ly1 + 1e-6) continue;
          const gy = y(ms), major = m === 1, labelled = m === 1 || m === 2 || m === 5;
          for (let k = 0; k <= 50; k++) v.dot(L + (k / 50) * (R - L), gy, PH.ok, major ? 0.12 : labelled ? 0.07 : 0.035, 0.4);
          if (labelled) v.text(L - 8 - v.textWidth(fmtMs(ms), 1.3), gy - 4, fmtMs(ms), PH.ok, major ? 0.55 : 0.35, 1.3);
        }
      }
      v.poly([[L, T], [R, T], [R, B], [L, B]], PH.ok, 0.2, 0.5, true);
      for (const sv of [0, 0.5, 1]) {
        const s = `${Math.round(sv * 100)}%`;
        v.text(x(sv) - v.textWidth(s, 1.3) / 2, B + 7, s, PH.ok, 0.4, 1.3);
      }
      v.text(L, T - 14, 'P50 MS · LOG', PH.ok, 0.4, 1.3);
      v.text(R - v.textWidth('SATURATION', 1.3), B + 18, 'SATURATION', PH.ok, 0.4, 1.3);
      for (let gx = L; gx < R; gx += 4) v.dot(gx, y(THRESH.warn), PH.warn, 0.18, 0.45);

      // four hours of operating points
      for (let i = 0; i < cl.length; i += 2) v.dot(x(cl[i]), y(cl[i + 1]), PH.ok, 0.07, 0.6);

      // the operating curve and its upper edge
      let pm = null, ph = null;
      for (let k = 0; k < CURVE_BINS; k++) {
        const s = (k + 0.5) / CURVE_BINS;
        const m = curve.med[k], h = curve.hi[k];
        if (m === m) {
          const p = [x(s), y(m)];
          if (pm) for (let u = 0; u < 1; u += 0.25) v.dot(pm[0] + (p[0] - pm[0]) * u, pm[1] + (p[1] - pm[1]) * u, PH.ok, 0.9, 0.7);
          pm = p;
        } else pm = null;
        if (h === h) {
          const p = [x(s), y(h)];
          if (ph) v.dot((ph[0] + p[0]) / 2, (ph[1] + p[1]) / 2, PH.ok, 0.4, 0.55);
          ph = p;
        } else ph = null;
      }
      if (curve.knee != null) {
        const kx = x(curve.knee);
        for (let gy = T; gy < B; gy += 6) v.line(kx, gy, kx, gy + 2, PH.ok, 0.35, 0.45);
        v.text(kx + 4, T + 4, 'KNEE', PH.ok, 0.6, 1.3);
      }

      // the beam: last three minutes, smoothed a little like a real deflection
      let prev = null, sx = null, sy = null;
      for (let i = 0; i < TRAIL; i++) {
        if (lat[i] !== lat[i] || sat[i] !== sat[i]) continue;
        sx = sx == null ? sat[i] : sx + (sat[i] - sx) * 0.35;
        sy = sy == null ? lat[i] : sy + (lat[i] - sy) * 0.35;
        const p = [x(sx), y(sy)];
        const age = 1 - i / TRAIL;
        if (prev) v.line(prev[0], prev[1], p[0], p[1], PH.ok, 0.08 + 0.6 * (1 - age) * (1 - age), 0.6);
        prev = p;
      }
      if (sx == null) return;
      ema = ema ? { s: ema.s + (sx - ema.s) * 0.1, l: ema.l + (sy - ema.l) * 0.1 } : { s: sx, l: sy };

      // distance off the curve, in units of its normal spread
      // beyond the highest healthy load seen, hold the last known point
      let k = Math.min(CURVE_BINS - 1, Math.floor(ema.s * CURVE_BINS));
      while (k > 0 && curve.med[k] !== curve.med[k]) k--;
      const med = curve.med[k], hi = curve.hi[k];
      let off = null, sev = 0;
      if (med === med && hi === hi) {
        off = ema.l - med;
        const z = off / Math.max(1, hi - med);
        sev = z > 4 ? 2 : z > 2 ? 1 : 0;
      }
      const c = [PH.ok, PH.warn, PH.crit][sev];
      const [bx, by] = [x(sx), y(sy)];
      v.dot(bx, by, c, 1.3, 1.5);
      v.line(bx, by, bx, B, c, 0.15, 0.45);
      v.line(L, by, bx, by, c, 0.15, 0.45);
      if (off != null && sev) {
        const my = y(med);
        for (let gy = Math.min(my, by); gy < Math.max(my, by); gy += 3) v.dot(bx + 6, gy, c, 0.7, 0.5);
      }

      // readout
      const rx = R + 14 > W - 160 ? L : R + 14;
      const lines = [
        [off == null ? 'CURVE --' : sev ? `OFF CURVE +${off.toFixed(1)}MS` : 'ON CURVE', c, sev ? 1 : 0.75],
        [curve.knee != null ? `KNEE ${Math.round(curve.knee * 100)}%` : 'KNEE NOT SEEN', PH.ok, 0.6],
        [`LOAD ${Math.round(ema.s * 100)}%`, PH.ok, 0.6],
      ];
      // without room on the right, the readout runs along the top edge
      if (rx === L) v.text(L + 110, T - 14, lines.map((l) => l[0]).join('  '), c, 0.8, 1.3);
      else lines.forEach(([s, col, a], i) => v.text(rx, T + 4 + i * 16, s, col, a, 1.4));
    },
  };
}
