import { SLO, BURN_ALERTS } from '../config.js';
import { PH } from '../gl/palette.js';

// 25 BUDGET: the error budget as a fuel tank. Full is the whole budget for the
// rolling window (the 0.5 % of requests that may fail under a 99.5 % SLO);
// the level is what is left after the failures of the last 30 days. Bubbles
// rise while the budget is burning faster than it refills, and the readout
// projects when the tank runs dry at the 6-hour burn rate.

export function createBudget(almanac) {
  const bubbles = [];
  return {
    crt: { curve: 0.035, scan: 0.8, bloom: 1.05, decay: 0.85 },
    render(gl, _state, f, v) {
      const a = almanac.analyse();
      if (a.end < 0) return;
      const W = v.w, H = v.h, t = f.now / 1000;
      const rem = Math.max(0, Math.min(1, a.remaining));
      const c = rem > 0.5 ? PH.ok : rem > 0.2 ? PH.warn : PH.crit;

      // the tube
      const tw = Math.min(70, W * 0.22), tx = 46, T = 22, B = H - 22;
      const r = tw / 2;
      const outline = [];
      for (let i = 0; i <= 12; i++) {
        const q = Math.PI + (i / 12) * Math.PI;
        outline.push([tx + r + Math.cos(q) * r, T + r + Math.sin(q) * r]);
      }
      for (let i = 0; i <= 12; i++) {
        const q = (i / 12) * Math.PI;
        outline.push([tx + r + Math.cos(q) * r, B - r + Math.sin(q) * r]);
      }
      v.poly(outline, PH.ok, 0.35, 0.55, true);
      // graduations
      const yOf = (fr) => B - r * 0.4 - fr * (B - T - r * 1.4);
      for (const g of [0, 0.25, 0.5, 0.75, 1]) {
        const y = yOf(g);
        v.line(tx - 8, y, tx - 2, y, PH.ok, 0.45, 0.45);
        const s = `${g * 100}`;
        v.text(tx - 12 - v.textWidth(s, 1.2), y - 4, s, PH.ok, 0.4, 1.2);
      }
      // the liquid: hatched fill and a moving meniscus
      const ly = yOf(rem);
      for (let y = B - r * 0.4; y > ly; y -= 3) {
        const inset = y > B - r ? r - Math.sqrt(Math.max(0, r * r - (y - (B - r)) ** 2)) : 0;
        v.line(tx + 3 + inset, y, tx + tw - 3 - inset, y, c, 0.16, 0.5);
      }
      let prev = null;
      for (let i = 0; i <= 16; i++) {
        const x = tx + 3 + (i / 16) * (tw - 6);
        const y = ly + Math.sin(t * 1.7 + i * 0.7) * 1.2;
        if (prev) v.line(prev[0], prev[1], x, y, c, 0.95, 0.6);
        prev = [x, y];
      }
      // bubbles while burning faster than 1x
      const rate = a.burn1h === a.burn1h ? a.burn1h : 0;
      if (rate > 1 && Math.random() < Math.min(0.5, (rate - 1) * f.dt * 3)) bubbles.push({ x: tx + 6 + Math.random() * (tw - 12), y: B - r * 0.5, s: 0.6 + Math.random() * 0.8 });
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const bb = bubbles[i];
        bb.y -= (12 + 20 * bb.s) * f.dt;
        bb.x += Math.sin(t * 3 + i) * 0.2;
        if (bb.y < ly + 2) bubbles.splice(i, 1);
        else v.dot(bb.x, bb.y, c, 0.5, bb.s);
      }

      // readout
      const x0 = tx + tw + 22;
      const pct = (n) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;
      const days = a.daysLeft;
      const proj = rem <= 0 ? 'EXHAUSTED' : days === Infinity || days > SLO.days ? 'HOLDS AT THIS RATE' : `EMPTY IN ${days < 2 ? `${Math.round(days * 24)}H` : `${days.toFixed(0)}D`}`;
      const projC = rem <= 0 || days < 3 ? PH.crit : days <= SLO.days ? PH.warn : PH.ok;
      const lines = [
        [`SLO ${(SLO.target * 100).toFixed(1)}% · ${SLO.days}D`, PH.ok, 0.5],
        [`LEFT ${pct(rem)}`, c, 1, 2.2],
        [`USED ${pct(Math.max(0, a.consumed))}`, PH.ok, 0.6],
        [`BURN 6H ${a.burn6h === a.burn6h ? a.burn6h.toFixed(2) : '--'}X`, a.burn6h > 1 ? PH.warn : PH.ok, 0.7],
        [proj, projC, 0.9],
      ];
      let y = T;
      for (const [s, col, inten, pitch = 1.4] of lines) {
        v.text(x0, y, s, col, inten, pitch);
        y += pitch * 11 + 4;
      }
      if (a.coverage < 0.98) v.text(x0, B - 12, `HISTORY ${Math.round(a.coverage * SLO.days)}D OF ${SLO.days}`, PH.ok, 0.35, 1.25);
    },
  };
}

// 26 BURN RATE: how fast the budget is being spent, as multiples of the rate
// that would use it up exactly over the window (1x). Three traces over the
// last 24 h: 6 h (heavy), 1 h and 5 min (light, nervous). The dashed lines are
// the alert rates; each alert lamp needs a long and a short window both above
// its rate, so a brief spike does not page anyone but a real burn does.

const YLO = 0.1, YHI = 100;

export function createBurnRate(store, almanac) {
  return {
    crt: { curve: 0.025, scan: 0.8, bloom: 1.0, decay: 0.84 },
    render(gl, _state, f, v) {
      const a = almanac.analyse();
      if (a.end < 0) return;
      const W = v.w, H = v.h;
      const L = 44, R = W - 74, T = 30, B = H - 24;
      const n = a.burn.h6.length;
      const x = (k) => L + (k / (n - 1)) * (R - L);
      const y = (b) => B - (Math.log10(Math.max(YLO, Math.min(YHI, b))) - Math.log10(YLO)) / (Math.log10(YHI) - Math.log10(YLO)) * (B - T);

      // grid: decades and the hour axis
      for (const b of [0.1, 1, 10, 100]) {
        for (let xx = L; xx < R; xx += 5) v.dot(xx, y(b), PH.ok, b === 1 ? 0.2 : 0.07, 0.4);
        const s = b < 1 ? '0.1' : String(b);
        v.text(L - 8 - v.textWidth(s, 1.2), y(b) - 4, s, PH.ok, 0.4, 1.2);
      }
      v.text(L - 8 - v.textWidth('X', 1.2), T - 16, 'X', PH.ok, 0.4, 1.2);
      for (let h = 0; h <= 24; h += 6) {
        const xx = L + ((24 - h) / 24) * (R - L);
        v.line(xx, B, xx, B + 4, PH.ok, 0.35, 0.45);
        for (let yy = T; yy < B; yy += 6) v.dot(xx, yy, PH.ok, 0.05, 0.4);
        const s = h === 0 ? 'NOW' : `-${h}H`;
        v.text(xx - v.textWidth(s, 1.2) / 2, B + 7, s, PH.ok, 0.4, 1.2);
      }

      // alert thresholds
      for (const al of BURN_ALERTS) {
        const yy = y(al.rate);
        const c = al.rate > 10 ? PH.crit : PH.warn;
        for (let xx = L; xx < R; xx += 8) v.line(xx, yy, xx + 4, yy, c, 0.3, 0.45);
        v.text(R + 6, yy - 4, `${al.rate}X`, c, 0.6, 1.2);
      }
      v.text(R + 6, y(1) - 4, '1X', PH.ok, 0.5, 1.2);

      // traces
      const trace = (s, inten, width) => {
        let prev = null;
        for (let k = 0; k < n; k++) {
          const b = s[k];
          if (b !== b) {
            prev = null;
            continue;
          }
          const p = [x(k), y(b)];
          const c = b >= 14.4 ? PH.crit : b >= 6 ? PH.warn : PH.ok;
          if (prev) v.line(prev[0], prev[1], p[0], p[1], c, inten, width);
          prev = p;
        }
      };
      trace(a.burn.m5, 0.22, 0.45);
      trace(a.burn.h1, 0.5, 0.55);
      trace(a.burn.h6, 0.9, 0.8);
      const last = a.burn.h6[n - 1];
      if (last === last) v.dot(x(n - 1), y(last), PH.ok, 1.1, 1.3);

      // legend and alert lamps
      let lx = L;
      for (const [s, inten] of [['6H', 0.9], ['1H', 0.5], ['5M', 0.25]]) {
        v.line(lx, 12, lx + 14, 12, PH.ok, inten, inten > 0.8 ? 0.8 : 0.5);
        lx = v.text(lx + 18, 8, s, PH.ok, 0.5, 1.25) + 14;
      }
      let rx = R + 66;
      for (const al of [...a.alerts].reverse()) {
        const c = al.firing ? (al.rate > 10 ? PH.crit : PH.warn) : PH.ok;
        const s = al.name;
        rx -= v.textWidth(s, 1.3) + 22;
        const on = al.firing && Math.sin(f.now / 160) > -0.3;
        v.dot(rx - 7, 12, c, on ? 1.2 : 0.18, 1.6);
        v.text(rx, 8, s, c, al.firing ? 0.95 : 0.3, 1.3);
      }
    },
  };
}
