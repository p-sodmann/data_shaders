import { createDotMatrix } from './dotmatrix.js';
import { hms, routeLabel } from '../data/telemetry.js';
import { fmtPeriod } from '../data/signal.js';
import { worstStation } from '../station/manager.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const centered = (api, str, color) => {
  const w = api.measure(str, true);
  api.text(Math.floor((api.w - w) / 2), Math.floor((api.h - 7) / 2), str, color, true);
};

// Big numeral + segmented bar. Segment colour depends on the segment's
// position on the scale (like an LED VU bar), so the bar itself shows where
// the thresholds are.
export function createReadout(station, options = {}) {
  const { store } = station;
  const { value, format, max, warn = Infinity, crit = Infinity, chars = 6 } = options;
  return createDotMatrix({
    layout: (w, h) => Math.max(3, Math.min(h / 12, (w - 4) / (chars * 6 + 2))),
    draw(api) {
      const v = value(store);
      if (v == null) return;
      const s = format(v);
      const sev = v >= crit ? 3 : v >= warn ? 2 : 1;
      const y = Math.max(0, Math.floor((api.h - 3 - 7) / 2));
      api.text(api.w - 1 - api.measure(s, true), y, s, sev, true);
      const by = api.h - 2;
      const len = api.w - 2;
      const lit = Math.round(clamp(v / max, 0, 1) * len);
      for (let i = 0; i < len; i++) {
        const pos = ((i + 0.5) / len) * max;
        const c = pos >= crit ? 3 : pos >= warn ? 2 : 1;
        api.dot(1 + i, by, i < lit ? c : 6);
      }
    },
  });
}

// Teletype event log: newest at the bottom, typed out one character at a time.
const TYPE_MS = 24;
const LEVEL_COLOR = [1, 2, 3];
// Built on a station, or on the device (a panel bound to '*'), in which case it
// merges every station's events and prefixes each line with the station name.
export function createLog(target, options = {}) {
  const events = target.stations ? mergedEvents(target) : () => target.store.events;
  return createDotMatrix({
    crt: { decay: 0.78 },
    layout: (w, h) => clamp(h / 57, 2.2, 3.6),
    draw(api, f) {
      const lines = Math.max(1, Math.floor((api.h + 1) / 8));
      const cols = Math.max(1, Math.floor((api.w - 1) / 6));
      // events arriving together are typed one after another
      const recent = events().slice(-(lines + 12));
      let prevEnd = -Infinity;
      const shown = [];
      for (const e of recent) {
        const line = `${hms(e.t)} ${e.from ? `${e.from} ` : ''}${e.text}`.slice(0, cols);
        const start = Math.max(e.wall, prevEnd);
        prevEnd = start + line.length * TYPE_MS;
        if (start <= f.now) shown.push({ e, line, n: Math.min(line.length, Math.floor((f.now - start) / TYPE_MS)) });
      }
      const visible = shown.slice(-lines);
      const y0 = Math.max(0, Math.floor((api.h - (lines * 8 - 1)) / 2)) + (lines - visible.length) * 8;
      visible.forEach(({ e, line, n }, i) => {
        const y = y0 + i * 8;
        let x = 1;
        const dim = e.from ? 9 + e.from.length : 8; // time and station name
        for (let c = 0; c < n; c++) x = api.text(x, y, line[c], c < dim ? 4 : LEVEL_COLOR[e.level]);
        const last = i === visible.length - 1;
        if (last && (n < line.length || f.now % 1000 < 550) && x + 5 < api.w) api.text(x, y, '█', 5);
      });
    },
  });
}

// Every station's events in arrival order, as one list. Rebuilt only when some
// station logged something or the station list changed. Backfilled events have
// no wall time (-Infinity) and sort by their own time, before live ones.
function mergedEvents(device) {
  let list = null, last = [], merged = [];
  const byArrival = (a, b) => (a.wall === b.wall ? a.t - b.t : a.wall < b.wall ? -1 : 1);
  return () => {
    const stations = device.stations;
    if (list !== stations || stations.some((s, i) => s.store.events.at(-1) !== last[i])) {
      list = stations;
      last = stations.map((s) => s.store.events.at(-1));
      merged = stations.flatMap((s) => s.store.events.map((e) => ({ ...e, from: s.name }))).sort(byArrival);
    }
    return merged;
  };
}

// The housing clock. On the device it follows the first station, whose time
// base the S key sets; with no station running it shows wall time.
export function createClock(target, options = {}) {
  const now = target.stations ? () => (target.stations[0]?.store.now() ?? Date.now() / 1000) : () => target.store.now();
  return createDotMatrix({
    layout: (w, h) => Math.max(2, Math.min(h / 10, w / 46)),
    draw(api) {
      centered(api, hms(now()), 1);
    },
  });
}

// STALE is drawn dim: no colour, since there is no reading to signal
const STATE_COLOR = { NOMINAL: 1, DEGRADED: 2, INCIDENT: 3, STALE: 4 };
function elapsed(sec) {
  sec = Math.max(0, Math.floor(sec));
  const pad = (n) => String(n).padStart(2, '0');
  if (sec >= 3600) return `${Math.floor(sec / 3600)}H${pad(Math.floor(sec / 60) % 60)}`;
  return `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
}
// The housing's system state. On the device (several stations) it shows the
// worst station's state and, unless all is nominal, names that station.
export function createStatus(target, options = {}) {
  const pick = target.stations ? () => worstStation(target.stations) : () => target;
  // Dots across the tube: 78 fits the state and its age. A station name needs
  // more, so the dots shrink to fit (sized from the previous frame's text).
  let need = 78;
  return createDotMatrix({
    layout: (w, h) => Math.max(1.5, Math.min(h / 10, w / need)),
    draw(api, f) {
      const station = pick();
      const y = Math.floor((api.h - 7) / 2);
      if (!station) {
        api.text(1, y, 'NO STATION', 4, true);
        return;
      }
      const { store } = station;
      const st = store.status;
      const blinkOff = st === 'INCIDENT' && f.now % 1000 > 620;
      const label = target.stations?.length > 1 && st !== 'NOMINAL' ? `${st} · ${station.name}` : st;
      const dur = store.stateSince === null ? '' : elapsed(store.now() - store.stateSince);
      need = Math.max(78, api.measure(label, true) + api.measure(dur, true) + 10);
      api.text(1, y, label, blinkOff ? 4 : STATE_COLOR[st], true);
      api.text(api.w - 1 - api.measure(dur, true), y, dur, 4, true);
    },
  });
}

// Writes `cells` ([text, color] pairs) at fixed character columns.
function row(api, y, cells, cols, x0 = 1) {
  cells.forEach(([text, color], i) => {
    if (text !== '' && text != null) api.text(x0 + cols[i] * 6, y, String(text), color);
  });
}
const FLAG = ['NOM', 'WARN', 'CRIT'];
const lvl = (v, warn, crit) => (v >= crit ? 2 : v >= warn ? 1 : 0);

// 12 CAUTION & WARNING: the rules behind the alarm lamp, mission-control style.
export function createRules(station, options = {}) {
  const { store } = station;
  const { thresh } = station.profile;
  const COLS = [0, 3, 18, 26, 31];
  const tall = store.caps.nodes != null ? 9 : 7; // lines, with the heading
  return createDotMatrix({
    layout: (w, h) => clamp(Math.min(h / (tall * 8 + 1), w / (35 * 6 + 2)), 1.8, 4),
    draw(api) {
      const x = store.latest;
      if (!x) return;
      const age = Math.max(0, store.now() - x.t - 1);
      const e = store.ema;
      const c = store.counts;
      const rules = [
        ['P50 LATENCY', `${e.lat.toFixed(1)}MS`, `<${thresh.warn}`, lvl(e.lat, thresh.warn, thresh.crit)],
        ['ERROR RATE', `${(e.err * 100).toFixed(2)}%`, `<${thresh.errWarn * 100}`, lvl(e.err, thresh.errWarn, thresh.errCrit)],
        ['SATURATION', `${Math.round(x.saturation * 100)}%`, `<${thresh.satWarn * 100}`, lvl(x.saturation, thresh.satWarn, thresh.satCrit)],
        ['NODES CRIT', c.crit, '=0', lvl(c.crit, 1, 3)],
        ['NODES DOWN', c.off, '=0', lvl(c.off, 1, 4)],
        // a live source that went quiet is STALE at once (its source decides when)
        ['SOURCE AGE', age >= 600 ? `${Math.floor(age / 60)}M` : `${age.toFixed(1)}S`, '<5', store.stale ? 2 : lvl(age, 5, 30)],
      ];
      // Prometheus stations: alerts from Prometheus's own rules, and the spare
      // slots of the discovered tables (ADR-0007), amber once they overflowed
      if (store.caps.nodes != null) {
        const ext = store.external;
        rules.push(['EXT ALERTS', ext.length ? ext[0].name.slice(0, 7).toUpperCase() : 0, '=0', ext.length ? 1 : 0]);
        const used = store.hostCount + store.endpoints.length + store.stages.length + store.regions.length;
        const cap = store.caps.nodes + store.caps.endpoints + store.caps.stages + store.caps.regions;
        rules.push(['SLOTS USED', `${used}/${cap}`, store.rebuilds ? 'RBLT' : '<75%', store.overflow ? 2 : store.rebuilds || used > cap * 0.75 ? 1 : 0]);
      }
      const lines = rules.length + 1;
      const y0 = Math.max(0, Math.floor((api.h - (lines * 8 - 1)) / 2));
      const nom = rules.filter((r) => r[3] === 0).length;
      api.text(1, y0, 'CAUTION & WARNING', 1);
      const summary = `${nom}/${rules.length} NOM`;
      api.text(1 + 31 * 6 + 3 * 6 - api.measure(summary), y0, summary, nom === rules.length ? 4 : 2);
      rules.forEach(([label, value, limit, l], i) => {
        const col = [1, 2, 3][l];
        const flag = l === 0 ? 4 : col;
        const name = label === 'SOURCE AGE' && l === 2 ? 'STALE' : label === 'SLOTS USED' && l === 2 ? 'FULL' : FLAG[l];
        row(api, y0 + (i + 1) * 8, [[`R${i + 1}`, 4], [label, l ? col : 1], [value, col], [limit, 4], [name, flag]], COLS);
      });
    },
  });
}

// 13 TRACE: sampled requests, newest at the bottom.
export function createTrace(station, options = {}) {
  const { store } = station;
  const { thresh } = station.profile;
  const COLS = [0, 9, 22, 26, 34];
  return createDotMatrix({
    layout: (w, h) => clamp(Math.min(h / 57, w / (37 * 6 + 2)), 1.8, 4),
    draw(api) {
      const lines = Math.max(1, Math.floor((api.h - 2) / 8));
      const reqs = store.requests.slice(-lines);
      const y0 = Math.max(0, Math.floor((api.h - (lines * 8 - 1)) / 2)) + (lines - reqs.length) * 8;
      reqs.forEach((r, i) => {
        const err = r.status >= 500, miss = r.status >= 400 && !err;
        const slow = r.ms > thresh.warn;
        row(
          api,
          y0 + i * 8,
          [
            [hms(r.t), 4],
            [routeLabel(r.route).slice(0, 12), 1],
            [r.status, err ? 3 : miss ? 2 : 4],
            [`${r.ms.toFixed(1)}MS`, slow ? 2 : 1],
            [r.node != null ? `N${String(r.node + 1).padStart(2, '0')}` : '', 4],
          ],
          COLS,
        );
      });
    },
  });
}

// 16 CONTACTS: the radar's endpoints in table form, in bearing order.
export function createContacts(station, options = {}) {
  const { store } = station;
  const COLS = [0, 4, 17, 23, 29, 34, 39];
  return createDotMatrix({
    layout: (w, h) => clamp(Math.min(h / ((store.endpoints.length + 1) * 8 + 5), w / (41 * 6 + 10)), 1.6, 4),
    draw(api) {
      const eps = store.endpoints;
      const n = eps.length;
      const lines = Math.min(n + 1, Math.max(1, Math.floor((api.h - 3) / 8)));
      const y0 = Math.max(0, Math.floor((api.h - (lines * 8 - 1)) / 2));
      row(api, y0, [['BRG', 4], ['ROUTE', 4], ['RPS', 4], ['P95', 4], ['SLO', 4], ['LIM', 4]], COLS, 4);
      eps.slice(0, lines - 1).forEach((ep, i) => {
        const y = y0 + (i + 1) * 8;
        const brg = String(Math.round(((i + 0.35) / n) * 360)).padStart(3, '0');
        const route = routeLabel(ep.route).slice(0, 12);
        if (!ep.live) return row(api, y, [[brg, 4], [route, 4], ['NO DATA', 4]], COLS, 4);
        const col = [1, 2, 3][ep.state];
        const arrow = ep.trend > 0.002 ? '▲' : ep.trend < -0.002 ? '▼' : '';
        row(
          api,
          y,
          [
            [brg, 4],
            [route, ep.state ? col : 1],
            [Math.round(ep.rps), 4],
            [ep.p95.toFixed(1), ep.p95 >= ep.slo ? 3 : ep.p95 >= ep.slo * 0.75 ? 2 : 1],
            // A: derived from the observed 4 h P95, not set in the document
            [ep.auto ? `${ep.slo}A` : ep.slo, 4],
            [`${Math.round(ep.pressure * 100)}%`, col],
            [arrow, ep.trend > 0 ? (ep.state ? col : 2) : 4],
          ],
          COLS,
          4,
        );
      });
    },
  });
}

// 17 ORIGINS: client regions by share of traffic, with route health.
export function createOrigins(station, options = {}) {
  const { store } = station;
  const { thresh } = station.profile;
  const COLS = [0, 4, 15, 21, 27, 33, 38];
  const BAR = 10;
  return createDotMatrix({
    layout: (w, h) => clamp(Math.min(h / ((store.regions.length + 1) * 8 + 5), w / (42 * 6 + 10)), 1.6, 4),
    draw(api) {
      const regs = store.regions.filter((rg) => rg.live);
      const total = regs.reduce((a, rg) => a + rg.rps, 0) || 1;
      const sorted = [...regs].sort((a, b) => b.rps - a.rps);
      const lines = Math.min(sorted.length + 1, Math.max(1, Math.floor((api.h - 3) / 8)));
      const y0 = Math.max(0, Math.floor((api.h - (lines * 8 - 1)) / 2));
      row(api, y0, [['RTE', 4], ['REGION', 4], ['SHARE', 4], ['RPS', 4], ['RTT', 4], ['ERR', 4], ['', 4]], COLS, 4);
      if (!regs.length) api.text(4 + COLS[1] * 6, y0 + 8, 'NO REGION DATA', 4);
      sorted.slice(0, lines - 1).forEach((rg, i) => {
        const y = y0 + (i + 1) * 8;
        const col = [1, 2, 3][rg.state];
        const share = rg.rps / total;
        row(
          api,
          y,
          [
            [rg.code, rg.state ? col : 1],
            [rg.name, 4],
            ['', 1],
            [Math.round(rg.rps), 4],
            [rg.rtt >= 0 ? `${Math.round(rg.rtt)}` : '--', rg.state ? col : 1],
            [(rg.err * 100).toFixed(2), rg.err >= thresh.errCrit ? 3 : rg.err >= thresh.errWarn ? 2 : 4],
            [['NOM', 'DEG', 'LOST'][rg.state], rg.state ? col : 4],
          ],
          COLS,
          4,
        );
        // share bar, 10 segments = 40 %
        const lit = Math.round(Math.min(1, share / 0.4) * BAR);
        for (let k = 0; k < BAR; k++) {
          const bx = 4 + COLS[2] * 6 + k * 3;
          for (let yy = 2; yy < 5; yy++) {
            api.dot(bx, y + yy, k < lit ? (rg.state ? col : 1) : 6);
            api.dot(bx + 1, y + yy, k < lit ? (rg.state ? col : 1) : 6);
          }
        }
      });
    },
  });
}

// 22 RHYTHMS: the periodic components the analyser has confirmed, strongest
// first, with their folded profile (one cycle, averaged over four hours), the
// time of the next peak and a countdown. A rhythm that began inside the
// window is NEW, in amber, with the time it started.
export function createRhythms(station, options = {}) {
  const { store, signal } = station;
  const COLS = [0, 3, 10, 16, 23, 33, 40];
  const SPARK = 30;
  return createDotMatrix({
    layout: (w, h) => clamp(Math.min(h / (6 * 8 + 5), w / (50 * 6 + 10)), 1.6, 4),
    draw(api, f) {
      signal.update(f.now);
      const peaks = signal.spec.peaks;
      const now = store.now();
      const lines = Math.min(6, Math.max(1, Math.floor((api.h - 3) / 8)));
      const y0 = Math.max(0, Math.floor((api.h - (lines * 8 - 1)) / 2));
      row(api, y0, [['', 4], ['PERIOD', 4], ['AMP', 4], ['CYCLE', 4], ['NEXT PEAK', 4], ['IN', 4], ['', 4]], COLS, 4);
      if (!peaks.length) {
        api.text(4 + COLS[1] * 6, y0 + 8, signal.spec.searched ? 'NO RHYTHM ABOVE NOISE' : 'ANALYSING', 4);
        return;
      }
      peaks.slice(0, lines - 1).forEach((pk, i) => {
        const y = y0 + (i + 1) * 8;
        const col = pk.fresh ? 2 : 1;
        // the search runs once a minute; keep the prediction rolling in between
        let next = pk.next;
        while (next <= now) next += pk.period;
        const left = next - now;
        const inS = left >= 60 ? `${Math.floor(left / 60)}M${String(Math.floor(left % 60)).padStart(2, '0')}` : `${Math.floor(left)}S`;
        row(
          api,
          y,
          [
            [`R${i + 1}`, 4],
            [fmtPeriod(pk.period), col],
            [pk.amp.toFixed(1), 4],
            ['', 1],
            [hms(next), col],
            [inS, left < 30 ? col : 4],
            [pk.fresh ? `NEW ${hms(pk.since).slice(0, 5)}` : '', 2],
          ],
          COLS,
          4,
        );
        // folded profile as a sparkline, with the current phase marked
        const prof = pk.profile;
        const hi = Math.max(...prof), lo = Math.min(...prof);
        const x0 = 4 + COLS[3] * 6;
        const phase = (((now % pk.period) + pk.period) % pk.period) / pk.period;
        for (let k = 0; k < SPARK; k++) {
          const v = prof[Math.min(prof.length - 1, Math.floor((k / SPARK) * prof.length))];
          const hgt = hi > lo ? Math.round(((v - lo) / (hi - lo)) * 5) : 0;
          for (let d = 0; d <= hgt; d++) api.dot(x0 + k, y + 6 - d, d === hgt ? col : 6);
        }
        api.dot(x0 + Math.min(SPARK - 1, Math.floor(phase * SPARK)), y + 7, 5);
      });
    },
  });
}

// 27 LOGBOOK: every incident in the almanac, newest first: when it started, how
// long it lasted, how bad it got, and what it cost in error budget. The
// header keeps the score: incidents in the last day and week, mean time to
// recover, mean time between incidents, and time since the last one ended.
export function createLogbook(station, options = {}) {
  const { almanac } = station;
  const { thresh } = station.profile;
  const COLS = [0, 7, 13, 19, 25, 32];
  const dur = (min) => (min >= 60 ? `${Math.floor(min / 60)}H${String(Math.round(min % 60)).padStart(2, '0')}` : `${Math.round(min)}M`);
  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return createDotMatrix({
    layout: (w, h) => clamp(Math.min(h / (8 * 8 + 5), w / (46 * 6 + 10)), 1.6, 4),
    draw(api) {
      const a = almanac.analyse();
      if (a.end < 0) return;
      const lines = Math.max(2, Math.floor((api.h - 3) / 8));
      const y0 = Math.max(0, Math.floor((api.h - (lines * 8 - 1)) / 2));
      const st = a.stats;
      const head = st.open
        ? [['INCIDENT OPEN', 3]]
        : [[`SINCE ${st.since === st.since ? dur(st.since) : '--'}`, 1]];
      head.push([`24H ${st.day}`, 4], [`7D ${st.week}`, 4], [`MTTR ${st.mttr === st.mttr ? dur(st.mttr) : '--'}`, 4], [`MTBF ${st.mtbf === st.mtbf ? dur(st.mtbf) : '--'}`, 4]);
      let x = 4;
      for (const [s, c] of head) {
        api.text(x, y0, s, c);
        x += (s.length + 2) * 6;
      }
      row(api, y0 + 8, [['DAY', 4], ['START', 4], ['DUR', 4], ['PEAK', 4], ['ERR', 4], ['BUDGET', 4]], COLS, 4);
      if (!a.incidents.length) api.text(4, y0 + 16, 'NO INCIDENTS RECORDED', 4);
      a.incidents.slice(0, lines - 2).forEach((inc, i) => {
        const y = y0 + (i + 2) * 8;
        const d = new Date(inc.start * 60000);
        const open = i === 0 && st.open;
        const big = inc.cost >= 0.01;
        row(
          api,
          y,
          [
            [`${DAYS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}`, 4],
            [hms(inc.start * 60).slice(0, 5), open ? 3 : 1],
            [open ? 'OPEN' : dur(inc.end - inc.start + 1), open ? 3 : big ? 2 : 1],
            [`${Math.round(inc.peakLat)}MS`, inc.peakLat >= 35 ? 3 : 2],
            [`${(inc.peakErr * 100).toFixed(1)}%`, inc.peakErr >= thresh.errCrit ? 3 : inc.peakErr >= thresh.errWarn ? 2 : 4],
            [`${(inc.cost * 100).toFixed(inc.cost >= 0.1 ? 0 : inc.cost >= 0.01 ? 1 : 2)}%`, big ? 2 : 4],
          ],
          COLS,
          4,
        );
      });
    },
  });
}

// The power-on state of a station's screens while its tape loads (a backfill
// from the backend, after discovery for Prometheus): TAPE LOAD with a reel
// counter and a progress bar, or NO CONTACT while the backend can't be reached.
// Shown in place of every instrument of that station until it goes live.
export function createTapeLoad(station, options = {}) {
  return createDotMatrix({
    layout: (w, h) => clamp(Math.min(h / 30, w / 70), 1.6, 4),
    draw(api, f) {
      const { progress, problem, generation } = station.getStatus();
      const y = Math.max(0, Math.floor(api.h / 2) - 9);
      const blink = f.now % 1200 < 700;
      const title = problem ?? (generation > 1 ? 'TAPE RELOAD' : 'TAPE LOAD');
      api.text(Math.floor((api.w - api.measure(title)) / 2), y, title, problem ? 2 : 1);
      const len = Math.min(api.w - 8, 50);
      const x0 = Math.floor((api.w - len) / 2);
      const lit = Math.round(clamp(progress, 0, 1) * len);
      for (let i = 0; i < len; i++) api.dot(x0 + i, y + 11, i < lit ? 1 : i === lit && blink ? 5 : 6);
      const sub = problem ? 'RETRYING' : `${String(Math.round(progress * 100)).padStart(3, ' ')}%`;
      api.text(Math.floor((api.w - api.measure(sub)) / 2), y + 15, sub, 4);
    },
  });
}
