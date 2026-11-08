import { recoveryFrame, revealed } from '../data/recovery.js';
import { PH, sevOf } from '../gl/palette.js';
import { CODE, stationCode } from './stations.js';

// STATION STRANDS: the fleet strands (fleet.js) with one strand per station:
// its P50 over the last three minutes, divided by its own crit threshold, so
// stations on different scales share one axis and the orange line is "at
// crit" for all of them. Each strand is coloured by its own warn and crit. A
// strand that crosses its warn line is named at its tip; the list on the
// right has the current share of crit of the stations nearest it.
//
// Each strand ends at its own station's clock, so a STALE station's strand
// stops short of NOW. The beam's work is bounded whatever the station count
// (every glyph dot and segment is one beam instance): the strands share a fixed
// number of segments, so with more stations each segment spans more seconds and
// is drawn at the highest P50 among them (a short spike still shows), and the
// list and the tip labels name at most LISTED stations.

const SPAN = 180;
const TOP = 1.3; // the axis runs to 130 % of crit
const SEGMENTS = 400;
const LISTED = 5;

export function createStationStrands(device, options = {}) {
  return {
    crt: { curve: 0.025, scan: 0.8, bloom: 1.0, decay: 0.84 },
    render(gl, _state, f, v) {
      const stations = device.stations;
      const n = stations.length;
      const W = v.w, H = v.h;
      const L = 40, R = W * 0.76, T = 30, B = H - 24;
      const x = (s) => L + (s / (SPAN - 1)) * (R - L);
      const y = (q) => B - Math.min(TOP * 1.04, q / TOP) * (B - T);
      const step = Math.max(1, Math.ceil((n * SPAN) / SEGMENTS));
      // the highest P50 of the `step` seconds ending at t, or -1 without data
      const peak = (store, t) => {
        let m = -1;
        for (let k = 0; k < step; k++) m = Math.max(m, store.latencyAt(t - k));
        return m;
      };

      // axis furniture: tenths of crit, the crit line, and each station's warn
      for (let q = 0; q <= TOP + 1e-9; q += 0.1) {
        const yy = y(q);
        const major = Math.round(q * 10) % 5 === 0;
        v.line(L - (major ? 9 : 5), yy, L - 2, yy, PH.ok, 0.3, 0.45);
        if (major) v.text(L - 12 - v.textWidth(`${Math.round(q * 100)}`, 1.3), yy - 4, `${Math.round(q * 100)}`, PH.ok, 0.35, 1.3);
      }
      for (let xx = L; xx < R; xx += 6) v.dot(xx, y(1), PH.crit, 0.25, 0.5);
      v.text(R - v.textWidth('CRIT', 1.3), y(1) - 12, 'CRIT', PH.crit, 0.45, 1.3);
      v.line(L, B, R, B, PH.ok, 0.18, 0.5);
      for (let s = 0; s <= SPAN; s += 30) v.line(x(Math.min(s, SPAN - 1)), B, x(Math.min(s, SPAN - 1)), B + 4, PH.ok, 0.3, 0.45);

      const rows = [];
      const tips = [];
      stations.forEach((st) => {
        const { store } = st;
        const t = store.profile.thresh;
        const recovery = recoveryFrame(store.recovery, f.now);
        const code = stationCode(st);
        const stale = code === CODE.STALE;
        const warnQ = t.warn / t.crit;
        v.line(L - 3, y(warnQ), L + 3, y(warnQ), PH.warn, 0.35, 0.45);
        if (store.latest == null) {
          rows.push({ st, q: -1, code });
          return;
        }
        const now = Math.floor(store.now());
        let prev = null, tip = null;
        for (let s = (SPAN - 1) % step; s < SPAN; s += step) {
          const at = now - (SPAN - 1) + s;
          const val = revealed(at, recovery) ? peak(store, at) : -1;
          if (val < 0) {
            prev = null;
            continue;
          }
          const p = [x(s), y(val / t.crit), val];
          const c = sevOf(val, t.warn, t.crit);
          if (prev) v.line(prev[0], prev[1], p[0], p[1], c, stale ? 0.07 : val > t.warn ? 0.5 : 0.2, 0.5);
          prev = tip = p;
        }
        const q = tip ? tip[2] / t.crit : -1;
        rows.push({ st, q, code });
        if (!tip || stale) return;
        const c = sevOf(tip[2], t.warn, t.crit);
        v.dot(tip[0], tip[1], c, 0.85, 0.9);
        if (tip[2] > t.warn) tips.push({ st, tip, c, q });
      });
      // name the strands that crossed their warn line, worst first
      tips.sort((a, b) => b.q - a.q);
      for (const { st, tip, c } of tips.slice(0, LISTED)) v.text(tip[0] + 6, tip[1] - 11, st.name, c, 0.8, 1.3);

      // the stations nearest their crit now, worst first; stale ones after them
      rows.sort((a, b) => (a.code === CODE.STALE) - (b.code === CODE.STALE) || b.q - a.q);
      const hx = R + 22;
      const lh = Math.max(11, Math.min(18, (B - T + 10) / (LISTED + 1)));
      const size = lh >= 16 ? 1.5 : 1.2;
      const fits = Math.min(LISTED + 1, Math.max(1, Math.floor((B - T + 10) / lh)));
      const shown = rows.length > fits ? rows.slice(0, fits - 1) : rows;
      shown.forEach(({ st, q, code }, k) => {
        const yy = T - 6 + k * lh;
        const t = st.store.profile.thresh;
        const stale = code === CODE.STALE;
        const c = stale || q < 0 ? PH.ok : sevOf(q * t.crit, t.warn, t.crit);
        const val = stale ? 'STALE' : q < 0 ? '--' : `${Math.round(q * 100)}%`;
        v.text(hx, yy, st.name, c, stale ? 0.3 : 0.55, size);
        v.text(W - 12 - v.textWidth(val, size), yy, val, c, stale ? 0.35 : 0.9, size);
      });
      if (shown.length < rows.length) v.text(hx, T - 6 + shown.length * lh, `+${rows.length - shown.length} MORE`, PH.ok, 0.35, size);

      v.text(L, B + 8, '-3M', PH.ok, 0.4, 1.5);
      v.text(R - v.textWidth('NOW', 1.5), B + 8, 'NOW', PH.ok, 0.6, 1.5);
      v.text(L, 10, `${n} STATIONS · P50 % OF CRIT`, PH.ok, 0.4, 1.5);
    },
  };
}
