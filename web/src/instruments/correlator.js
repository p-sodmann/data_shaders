import { PH } from '../gl/palette.js';
import { SIGNALS } from '../data/telemetry.js';

// 21 CORRELATOR: which signals move together. Each cell compares two signals
// over the last ten minutes: a filled dot for positive correlation, a ring for
// negative, size for strength. A cell turns amber when the pair behaves
// differently from its 4-hour habit, for example latency suddenly tracking
// one service's load, or two services that always move together drifting
// apart. The list on the right names the pairs that changed most.

const SHIFT = 0.6; // |r_now - r_base| that counts as a change...
const STRONG = 0.5; // ...when either the habit or the present is a strong correlation
const short = (s) => s.slice(0, 4);

export function createCorrelator(store, signal) {
  return {
    crt: { curve: 0.025, scan: 0.8, bloom: 1.0, decay: 0.8 },
    render(gl, _state, f, v) {
      signal.update(f.now);
      const { now: rn, base: rb } = signal.corr;
      if (!rn || !rb) return;
      const m = SIGNALS.length;
      const W = v.w, H = v.h;
      const cell = Math.max(6, Math.min((H - 24) / m, (W * 0.55 - 40) / m));
      const L = 36, T = (H - cell * m) / 2 + 4;
      const changes = [];

      for (let a = 0; a < m; a++) {
        const cy = T + (a + 0.5) * cell;
        v.text(L - 6 - v.textWidth(short(SIGNALS[a]), 1.2), cy - 4, short(SIGNALS[a]), PH.ok, 0.45, 1.2);
        for (let b = 0; b < a; b++) {
          const cx = L + (b + 0.5) * cell;
          const r = rn[a * m + b], r0 = rb[a * m + b];
          v.dot(cx, cy, PH.ok, 0.08, 0.4);
          if (r !== r) continue;
          const d = r0 === r0 ? r - r0 : 0;
          const changed = Math.abs(d) >= SHIFT && Math.max(Math.abs(r), Math.abs(r0)) >= STRONG;
          if (changed) changes.push({ a, b, r, r0, d });
          const c = changed ? PH.warn : PH.ok;
          const rad = Math.abs(r) * cell * 0.42;
          const inten = changed ? 0.95 : 0.25 + 0.45 * Math.abs(r);
          if (r >= 0) {
            v.dot(cx, cy, c, inten, Math.max(0.5, rad * 0.45));
          } else {
            const n = Math.max(8, Math.round(rad * 2));
            for (let i = 0; i < n; i++) {
              const t = (i / n) * Math.PI * 2;
              v.dot(cx + Math.cos(t) * rad, cy + Math.sin(t) * rad, c, inten * 0.8, 0.45);
            }
          }
        }
      }
      // column labels along the diagonal
      for (let b = 0; b < m - 1; b++) {
        const cx = L + (b + 0.5) * cell;
        v.text(cx - 2, T + (b + 0.5) * cell - 4, short(SIGNALS[b])[0], PH.ok, 0.35, 1.2);
      }

      // what changed
      const x0 = L + m * cell + 24;
      changes.sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
      v.text(x0, T, changes.length ? 'CHANGED VS 4H' : 'ALL PAIRS AS USUAL', changes.length ? PH.warn : PH.ok, changes.length ? 0.9 : 0.55, 1.4);
      changes.slice(0, Math.max(1, Math.floor((H - T - 30) / 16))).forEach((c, i) => {
        const yy = T + 20 + i * 16;
        const pair = `${SIGNALS[c.a]}·${SIGNALS[c.b]}`;
        v.text(x0, yy, pair, PH.warn, 0.85, 1.35);
        v.text(x0 + v.textWidth('EMBED·GATEWAY ', 1.35), yy, `${c.r >= 0 ? '+' : ''}${c.r.toFixed(2)} WAS ${c.r0 >= 0 ? '+' : ''}${c.r0.toFixed(2)}`, PH.warn, 0.6, 1.35);
      });
      v.text(x0, H - 16, '10 MIN VS 4 H · PEARSON', PH.ok, 0.3, 1.25);
    },
  };
}
