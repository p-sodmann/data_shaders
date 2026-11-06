import { THRESH } from '../config.js';
import { PH, STATE_COLORS } from '../gl/palette.js';
import { camera, hash } from './space.js';

// 11 SLICES: the fleet's fingerprint at T-10m, T-5m, T-2m, T-60s, T-10s and
// now, stacked like film frames. In each frame, angle = node and radius =
// latency, wrapped in a slow swirl of particles weighted by load. Comparing
// frames shows how the shape of the fleet changed. The timeline below marks
// every logged event in the last ten minutes.

const SLICES = [
  [600, 'T-10M'],
  [300, 'T-5M'],
  [120, 'T-2M'],
  [60, 'T-60S'],
  [10, 'T-10S'],
  [0, 'T0'],
];
const STATE_INDEX = { NOMINAL: 0, DEGRADED: 1, INCIDENT: 2 };
const TAU = Math.PI * 2;

export function createSlices(store) {
  return {
    crt: { curve: 0.03, scan: 0.8, bloom: 1.05, decay: 0.82 },
    render(gl, _state, f, v) {
      const now = store.latest?.t;
      if (now == null) return;
      const W = v.w, H = v.h, n = store.hostCount, t = f.time;
      const scaleX = W - 74; // right-hand time scale
      const tlY = H - 18; // timeline
      const cam = camera({
        yaw: -0.72,
        pitch: 0.1,
        dist: 7.5,
        cx: (scaleX - 10) * 0.5,
        cy: (tlY - 8) * 0.48,
        scale: Math.min(scaleX * 0.62, tlY * 1.05) * 2.6,
      });
      const live = STATE_INDEX[store.state] ?? 0;

      SLICES.forEach(([ago, label], k) => {
        const z = (SLICES.length - 1 - k) * 0.62 - 1.55; // T0 at the front
        const front = k === SLICES.length - 1;
        const age = k / (SLICES.length - 1);
        const c = front ? STATE_COLORS[live] : PH.ok;
        const fade = 0.35 + 0.65 * age;
        const P = (lx, ly) => cam(lx - (SLICES.length - 1 - k) * 0.12, ly, z);

        const corners = [P(-0.82, -0.62), P(0.82, -0.62), P(0.82, 0.62), P(-0.82, 0.62)];
        v.poly(corners, c, (front ? 0.55 : 0.28) * fade, 0.5, true);

        const T = now - ago;
        const pts = [];
        for (let i = 0; i < n; i++) {
          const ms = store.hostLatAt(T, i);
          const a = (i / n) * TAU + t * 0.04;
          const r = ms < 0 ? 0.14 : 0.2 + 0.4 * Math.min(1.2, ms / 40);
          pts.push(P(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82 * 0.95));
          // swirl
          const load = store.hostLoads[i];
          for (let j = 0; j < 6; j++) {
            const h1 = hash(i * 13 + j), h2 = hash(i * 7 + j * 3 + 1);
            const rr = r * (0.35 + 0.75 * h1);
            const aa = a + (h2 - 0.5) * 0.9 + t * (0.05 + 0.1 * (1 - h1));
            const p = P(Math.cos(aa) * rr * 0.82, Math.sin(aa) * rr * 0.78);
            v.dot(p[0], p[1], ms > THRESH.warn ? PH.warn : c, (0.12 + 0.25 * load) * fade, 0.55);
          }
        }
        v.poly(pts, c, 0.5 * fade, 0.5, true);

        // time scale entry
        const sy = 14 + (k / (SLICES.length - 1)) * (tlY - 44);
        v.line(scaleX + 4, sy, scaleX + 12, sy, c, front ? 0.9 : 0.4, 0.5);
        if (front) v.line(scaleX + 8, sy - 4, scaleX + 8, sy + 4, c, 0.9, 0.5);
        v.text(scaleX + 18, sy - 5, label, c, front ? 1 : 0.6, 1.5);
      });
      v.line(scaleX + 8, 10, scaleX + 8, tlY - 26, PH.ok, 0.2, 0.45);

      // event timeline, last 10 minutes
      const L = 12, R = W - 12;
      v.line(L, tlY, R, tlY, PH.ok, 0.25, 0.5);
      for (let i = 0; i <= 10; i++) v.line(L + (i / 10) * (R - L), tlY, L + (i / 10) * (R - L), tlY + 3, PH.ok, 0.25, 0.45);
      for (const e of store.events) {
        const dt = now - e.t;
        if (dt < 0 || dt > 600) continue;
        const xx = R - (dt / 600) * (R - L);
        const len = [3, 7, 11][e.level];
        v.line(xx, tlY - len, xx, tlY, STATE_COLORS[e.level], e.level ? 0.85 : 0.3, 0.5);
      }
      for (const [ago] of SLICES) {
        const xx = R - (ago / 600) * (R - L);
        v.dot(xx, tlY + 7, PH.ok, 0.5, 0.8);
      }
    },
  };
}
