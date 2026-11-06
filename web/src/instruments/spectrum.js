import { PH } from '../gl/palette.js';
import { LONG, LIVE, axisX, fmtPeriod } from '../data/signal.js';

// 18 SPECTRUM: the amplitude spectrum of P50 latency on a period axis (long
// periods left, short right, like frequency rising). The dim trace is the
// 4 h spectrum, the reference. The bright trace is the last 10 minutes,
// redrawn by a sweeping cursor like a swept-tuned analyser, so what is
// happening now can be compared against the long view.
// A scheduled job is a short pulse, so it shows as a comb: a line at its
// period plus its harmonics. Every rhythm the analyser has confirmed gets a
// marker and a row of comb ticks at its harmonics, so the comb reads as one
// thing. A rhythm that began inside the window is marked in amber.

const DB_MIN = -36, DB_MAX = 12; // re 1 ms
const TICKS = [7200, 3600, 1800, 600, 300, 120, 60, 30];
const SWEEP_S = 3.5; // seconds per sweep of the live trace
const label = (p) => (p >= 3600 ? `${p / 3600}H` : p >= 60 ? `${p / 60}M` : `${p}S`);

export function createSpectrum(station, options = {}) {
  const { store, signal } = station;
  let shown = null; // live trace as last painted by the cursor
  let lastCursor = 0;
  return {
    crt: { curve: 0.025, scan: 0.8, bloom: 1.0, decay: 0.8 },
    render(gl, _state, f, v) {
      signal.update(f.now);
      const { spec, longP } = signal;
      if (spec.t < 0) return;
      const W = v.w, H = v.h;
      const L = 40, R = W - 14, T = 30, B = H - 24;
      const x = (p) => L + axisX(LONG, p) * (R - L);
      const y = (amp) => {
        const db = 20 * Math.log10(Math.max(1e-5, amp));
        return B - Math.max(0, Math.min(1, (db - DB_MIN) / (DB_MAX - DB_MIN))) * (B - T);
      };

      // graticule
      for (const p of TICKS) {
        const xx = x(p);
        for (let yy = T; yy < B; yy += 5) v.dot(xx, yy, PH.ok, 0.07, 0.4);
        v.line(xx, B, xx, B + 4, PH.ok, 0.35, 0.45);
        const s = label(p);
        v.text(xx - v.textWidth(s, 1.3) / 2, B + 8, s, PH.ok, 0.4, 1.3);
      }
      for (let db = DB_MIN; db <= DB_MAX; db += 12) {
        const yy = y(Math.pow(10, db / 20));
        for (let xx = L; xx < R; xx += 5) v.dot(xx, yy, PH.ok, db === 0 ? 0.14 : 0.07, 0.4);
        const s = db === 0 ? '1MS' : `${db > 0 ? '+' : ''}${db}`;
        v.text(L - 6 - v.textWidth(s, 1.2), yy - 4, s, PH.ok, 0.35, 1.2);
      }
      v.line(L, B, R, B, PH.ok, 0.25, 0.5);

      // 4 h reference: bars, peak hold and a dim trace; it needs half the window
      // with data, which a live station that just started doesn't have yet
      let prev = null;
      if (!spec.ref) {
        const msg = '4H REFERENCE AFTER 2H OF DATA';
        v.text(R - v.textWidth(msg, 1.3), T - 16, msg, PH.ok, 0.4, 1.3);
      }
      for (let b = 0; spec.ref && b < longP.length; b++) {
        const xx = x(longP[b]);
        const yy = y(spec.amp[b]);
        v.line(xx, B, xx, yy, PH.ok, 0.06, 0.5);
        if (b % 2 === 0) v.dot(xx, y(spec.hold[b]), PH.ok, 0.22, 0.5);
        if (prev) v.line(prev[0], prev[1], xx, yy, PH.ok, 0.3, 0.55);
        prev = [xx, yy];
      }

      // live 10 min trace, repainted bin by bin as the cursor passes
      if (!shown) shown = Float32Array.from(spec.live);
      const xLive = x(LIVE.pmax);
      const cursor = xLive + (((f.now / 1000) % SWEEP_S) / SWEEP_S) * (R - xLive);
      for (let b = 0; b < longP.length; b++) {
        const xx = x(longP[b]);
        const passed = cursor >= lastCursor ? xx > lastCursor && xx <= cursor : xx > lastCursor || xx <= cursor;
        if (passed) shown[b] = spec.live[b];
      }
      lastCursor = cursor;
      prev = null;
      for (let b = 0; b < longP.length; b++) {
        const a = shown[b];
        if (a !== a) {
          prev = null;
          continue;
        }
        const xx = x(longP[b]), yy = y(a);
        // just behind the cursor the beam is brightest
        const behind = (cursor - xx + (R - xLive)) % (R - xLive);
        const glow = 0.55 + 0.45 * Math.exp(-behind / 40);
        if (prev) v.line(prev[0], prev[1], xx, yy, PH.ok, 0.85 * glow, 0.65);
        prev = [xx, yy];
      }
      v.line(cursor, T, cursor, B, PH.ok, 0.22, 0.6);
      v.dot(cursor, B, PH.ok, 0.9, 1.1);
      if (spec.ref) v.text(L + 4, B - 12, '4H', PH.ok, 0.35, 1.2);
      v.text(xLive + 4, B - 12, '10M LIVE', PH.ok, 0.6, 1.2);
      for (let yy = T; yy < B; yy += 7) v.dot(xLive, yy, PH.ok, 0.12, 0.45);

      // confirmed rhythms: marker at the period, comb ticks at its harmonics
      const peaks = [...spec.peaks].sort((a, b) => b.period - a.period);
      peaks.forEach((pk, i) => {
        const c = pk.fresh ? PH.warn : PH.ok;
        const xx = x(pk.period);
        const top = T - 4; // markers share the top rail
        for (let yy = top + 6; yy < B; yy += 3) v.dot(xx, yy, c, 0.28, 0.45);
        v.poly([[xx - 4, top], [xx + 4, top], [xx, top + 5]], c, 0.95, 0.55, true);
        for (let k = 2; pk.period / k >= LONG.pmin && k <= 24; k++) {
          const hx = x(pk.period / k);
          v.line(hx, top + 1, hx, top + 5, c, 0.6 / Math.sqrt(k), 0.45);
        }
        const s = fmtPeriod(pk.period);
        const ly = top - 12 - (i % 2) * 10;
        v.text(Math.min(R - v.textWidth(s, 1.3), Math.max(L, xx - v.textWidth(s, 1.3) / 2)), ly, s, c, 0.9, 1.3);
      });
      if (!peaks.length && spec.searched) v.text(L, T - 16, 'NO RHYTHM ABOVE NOISE', PH.ok, 0.4, 1.3);
    },
  };
}
