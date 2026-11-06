import { THRESH } from '../config.js';
import { PH, sevOf } from '../gl/palette.js';

// 09 FLEET: every node's latency over the last three minutes as one faint
// strand. A healthy fleet is a tight silk bundle; a sick node peels away and
// turns amber. The bright strand is the cluster P50; on the right is the
// current distribution across nodes.

const SPAN = 180;
const MAX = 45;

export function createFleet(store) {
  return {
    crt: { curve: 0.025, scan: 0.8, bloom: 1.0, decay: 0.84 },
    render(gl, _state, f, v) {
      const now = store.latest?.t;
      if (now == null) return;
      const W = v.w, H = v.h, n = store.hostCount;
      const L = 34, R = W * 0.78, T = 30, B = H - 24;
      const x = (s) => L + (s / (SPAN - 1)) * (R - L);
      const y = (ms) => B - Math.min(1.08, ms / MAX) * (B - T);
      const head = (f.now / 1000) % 1; // keep the right edge alive between samples

      // axis furniture
      for (let ms = 0; ms <= MAX; ms += 5) {
        const yy = y(ms);
        v.line(L - (ms % 25 === 0 ? 9 : 5), yy, L - 2, yy, PH.ok, 0.3, 0.45);
      }
      for (let xx = L; xx < R; xx += 6) v.dot(xx, y(THRESH.warn), PH.warn, 0.22, 0.5);
      v.line(L, B, R, B, PH.ok, 0.18, 0.5);
      for (let s = 0; s <= SPAN; s += 30) v.line(x(Math.min(s, SPAN - 1)), B, x(Math.min(s, SPAN - 1)), B + 4, PH.ok, 0.3, 0.45);

      // strands
      const cur = [];
      for (let i = 0; i < n; i++) {
        let prev = null;
        for (let s = 0; s < SPAN; s++) {
          const val = store.hostLatAt(now - (SPAN - 1) + s, i);
          if (val < 0) {
            prev = null;
            continue;
          }
          const p = [x(s), y(val), val];
          if (prev) v.line(prev[0], prev[1], p[0], p[1], sevOf(val, THRESH.warn, THRESH.crit), val > THRESH.warn ? 0.4 : 0.15, 0.5);
          prev = p;
        }
        if (prev) {
          v.dot(prev[0], prev[1], sevOf(prev[2], THRESH.warn, THRESH.crit), 0.8, 0.9);
          cur.push(prev[2]);
        }
      }

      // cluster P50 strand
      let prev = null;
      for (let s = 0; s < SPAN; s++) {
        const val = store.latencyAt(now - (SPAN - 1) + s);
        if (val < 0) {
          prev = null;
          continue;
        }
        const p = [x(s), y(val)];
        if (prev) v.line(prev[0], prev[1], p[0], p[1], mixWhite(sevOf(val, THRESH.warn, THRESH.crit)), 0.55, 0.55);
        prev = p;
      }
      if (prev) v.dot(prev[0] + head * 0.5, prev[1], PH.ok, 1.4, 1.4);

      // distribution of current node latency
      cur.sort((a, b) => a - b);
      const bins = 16, counts = new Array(bins).fill(0);
      cur.forEach((ms) => counts[Math.min(bins - 1, Math.floor((ms / MAX) * bins))]++);
      const peak = Math.max(1, ...counts);
      const hx = R + 22, hw = W - 14 - hx;
      counts.forEach((c, b) => {
        const xx = hx + (b + 0.5) * (hw / bins);
        const ms = ((b + 0.5) / bins) * MAX;
        v.line(xx, B, xx, B - 4 - (c / peak) * (B - T) * 0.45, sevOf(ms, THRESH.warn, THRESH.crit), c ? 0.7 : 0.15, 0.55);
      });
      v.line(hx, B, W - 14, B, PH.ok, 0.2, 0.45);

      const q = (p) => (cur.length ? cur[Math.min(cur.length - 1, Math.floor(p * cur.length))] : 0);
      const p50 = q(0.5), p99 = q(0.99);
      v.text(hx, T - 4, 'P50', PH.ok, 0.45, 1.6);
      v.text(hx + 36, T - 4, p50.toFixed(1), sevOf(p50, THRESH.warn, THRESH.crit), 0.9, 1.6);
      v.text(hx, T + 16, 'P99', PH.ok, 0.45, 1.6);
      v.text(hx + 36, T + 16, p99.toFixed(1), sevOf(p99, THRESH.warn, THRESH.crit), 0.9, 1.6);
      v.text(hx, T + 36, 'SPREAD', PH.ok, 0.45, 1.6);
      v.text(hx + 62, T + 36, (q(1) - q(0)).toFixed(1), PH.ok, 0.75, 1.6);

      v.text(L, B + 8, '-3M', PH.ok, 0.4, 1.5);
      v.text(R - v.textWidth('NOW', 1.5), B + 8, 'NOW', PH.ok, 0.6, 1.5);
      v.text(L, 10, `${n} NODES · MS`, PH.ok, 0.4, 1.5);
    },
  };
}

const mixWhite = (c) => c.map((x) => x * 0.6 + 0.4);
