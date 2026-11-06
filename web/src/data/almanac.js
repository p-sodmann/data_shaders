import { ALMANAC_DAYS } from '../config.js';

// The almanac: one record per minute for the last 30 days, kept in the browser
// (IndexedDB) so the device remembers across reloads. Page 5 reads it.
//
//   lat   mean P50 latency, ms
//   err   error rate, weighted by throughput
//   tp    mean throughput, req/s
//   sat   mean saturation
//   st    worst system state in the minute: 0 nominal, 1 degraded, 2 incident
//
// Slot i holds minute m[i]; a slot is valid for minute mi when m[i] === mi.
// Derived views (budget, burn rates, incidents) are recomputed only when a
// minute is committed.

const N = ALMANAC_DAYS * 1440;
const SEV = { NOMINAL: 0, DEGRADED: 1, INCIDENT: 2 };
const DB = 'mars', STORE = 'almanac', SAVE_MS = 60000;

export const slotOf = (mi) => ((mi % N) + N) % N;

export function createAlmanac({ profile, key }) {
  const { thresh, slo, burnAlerts } = profile;
  const BUDGET = 1 - slo.target;
  const m = new Int32Array(N).fill(-1);
  const lat = new Float32Array(N), err = new Float32Array(N), tp = new Float32Array(N), sat = new Float32Array(N);
  const st = new Uint8Array(N);
  let acc = null;
  let version = 0;
  let lastMin = -1;

  function write(mi, x) {
    const i = slotOf(mi);
    m[i] = mi;
    lat[i] = x.lat;
    err[i] = x.err;
    tp[i] = x.tp;
    sat[i] = x.sat;
    st[i] = x.st;
    lastMin = Math.max(lastMin, mi);
  }

  function commit() {
    if (!acc || !acc.n) return;
    write(acc.min, {
      lat: acc.lat / acc.n,
      err: acc.tp > 0 ? acc.errW / acc.tp : 0,
      tp: acc.tp / acc.n,
      sat: acc.sat / acc.n,
      st: acc.st,
    });
    version++;
  }

  // one telemetry sample (1 s) and the system state at that moment
  function add(x, state) {
    const mi = Math.floor(x.t / 60);
    if (acc && acc.min !== mi) {
      commit();
      acc = null;
    }
    if (!acc) acc = { min: mi, n: 0, lat: 0, errW: 0, tp: 0, sat: 0, st: 0 };
    acc.n++;
    acc.lat += x.latency;
    acc.errW += x.errorRate * x.throughput;
    acc.tp += x.throughput;
    acc.sat += x.saturation;
    acc.st = Math.max(acc.st, SEV[state] ?? 0);
  }

  // fill empty minutes in [from, to) from a generator (simulated past)
  function synthesize(from, to, gen) {
    let n = 0;
    for (let mi = from; mi < to; mi++) {
      if (m[slotOf(mi)] === mi) continue;
      const x = gen(mi);
      const s = x.latency > thresh.crit || x.errorRate > thresh.errCrit ? 2 : x.latency > thresh.warn || x.errorRate > thresh.errWarn ? 1 : 0;
      write(mi, { lat: x.latency, err: x.errorRate, tp: x.throughput, sat: x.saturation, st: s });
      n++;
    }
    if (n) version++;
  }

  // ---------- persistence ----------
  let db = null;
  const open = () =>
    new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  async function load(nowMin) {
    try {
      db = await open();
      const rec = await new Promise((res, rej) => {
        const q = db.transaction(STORE).objectStore(STORE).get(key);
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
      if (!rec || rec.v !== 1 || rec.m.length !== N) return 0;
      let n = 0;
      for (let i = 0; i < N; i++) {
        const mi = rec.m[i];
        // newer than what we hold, and not from a faster-than-real-time run
        if (mi > m[i] && mi <= nowMin && mi > nowMin - N) {
          write(mi, { lat: rec.lat[i], err: rec.err[i], tp: rec.tp[i], sat: rec.sat[i], st: rec.st[i] });
          n++;
        }
      }
      if (n) version++;
      return n;
    } catch {
      return 0;
    }
  }
  function save() {
    if (!db) return;
    try {
      db.transaction(STORE, 'readwrite').objectStore(STORE).put({ v: 1, m, lat, err, tp, sat, st }, key);
    } catch {
      /* storage full or unavailable: keep running from memory */
    }
  }
  const timer = setInterval(save, SAVE_MS);
  addEventListener('pagehide', save);

  // ---------- derived views ----------
  let cache = { v: -1 };

  // budget, burn rates and incidents for the 30 days ending at lastMin
  function analyse() {
    if (cache.v === version) return cache;
    const end = lastMin;
    const from = end - N + 1;
    let total = 0, bad = 0, minutes = 0;
    const incidents = [];
    let cur = null;
    for (let mi = from; mi <= end; mi++) {
      const i = slotOf(mi);
      if (m[i] !== mi) continue;
      minutes++;
      const req = tp[i] * 60, b = err[i] * req;
      total += req;
      bad += b;
      if (st[i] === 2) {
        if (cur && mi - cur.end <= 3) cur.end = mi;
        else {
          cur = { start: mi, end: mi, peakLat: 0, peakErr: 0, bad: 0 };
          incidents.push(cur);
        }
      }
      if (cur && mi - cur.end <= 3) {
        cur.peakLat = Math.max(cur.peakLat, lat[i]);
        cur.peakErr = Math.max(cur.peakErr, err[i]);
        cur.bad += b;
      }
    }
    const allowed = total * BUDGET;
    for (const inc of incidents) inc.cost = allowed > 0 ? inc.bad / allowed : 0;
    incidents.reverse(); // newest first
    const consumed = allowed > 0 ? bad / allowed : 0;

    // burn rate over the last w minutes ending at minute e
    const burnAt = (e, w) => {
      let t = 0, b = 0;
      for (let mi = e - w + 1; mi <= e; mi++) {
        const i = slotOf(mi);
        if (m[i] !== mi) continue;
        t += tp[i];
        b += err[i] * tp[i];
      }
      return t > 0 ? b / t / BUDGET : NaN;
    };
    // per-minute burn series over the last 24 h, via prefix sums
    const H = 1440, PAD = 360;
    const pt = new Float64Array(H + PAD + 1), pb = new Float64Array(H + PAD + 1);
    for (let k = 0; k < H + PAD; k++) {
      const mi = end - H - PAD + 1 + k, i = slotOf(mi);
      const ok = m[i] === mi;
      pt[k + 1] = pt[k] + (ok ? tp[i] : 0);
      pb[k + 1] = pb[k] + (ok ? err[i] * tp[i] : 0);
    }
    const series = (w) =>
      Float32Array.from({ length: H }, (_, j) => {
        const e = PAD + j + 1;
        const t = pt[e] - pt[e - w], b = pb[e] - pb[e - w];
        return t > 0 ? b / t / BUDGET : NaN;
      });
    const burn = { m5: series(5), h1: series(60), h6: series(360) };
    const alerts = burnAlerts.map((a) => ({ ...a, long: burnAt(end, a.long), short: burnAt(end, a.short) })).map((a) => ({
      ...a,
      firing: a.long >= a.rate && a.short >= a.rate,
    }));
    const b6 = burnAt(end, 360);
    const remaining = 1 - consumed;
    const daysLeft = remaining <= 0 ? 0 : b6 > 0 ? (remaining * slo.days) / b6 : Infinity;

    // incident statistics over the last 7 days
    const week = incidents.filter((x) => x.start > end - 7 * 1440);
    const mttr = week.length ? week.reduce((a, x) => a + x.end - x.start + 1, 0) / week.length : NaN;
    const starts = week.map((x) => x.start).sort((a, b) => a - b);
    const mtbf = starts.length > 1 ? (starts[starts.length - 1] - starts[0]) / (starts.length - 1) : NaN;

    cache = {
      v: version,
      end,
      coverage: minutes / N,
      total,
      bad,
      consumed,
      remaining,
      daysLeft,
      burn6h: b6,
      burn1h: burnAt(end, 60),
      burn,
      alerts,
      incidents,
      stats: {
        day: incidents.filter((x) => x.start > end - 1440).length,
        week: week.length,
        mttr,
        mtbf,
        since: incidents.length ? end - incidents[0].end : NaN,
        open: incidents.length > 0 && incidents[0].end >= end - 1,
      },
    };
    return cache;
  }

  return {
    get version() {
      return version;
    },
    get lastMin() {
      return lastMin;
    },
    add,
    synthesize,
    load,
    save,
    analyse,
    // the record for minute mi, or null
    at(mi) {
      const i = slotOf(mi);
      return m[i] === mi ? { lat: lat[i], err: err[i], tp: tp[i], sat: sat[i], st: st[i] } : null;
    },
    // mean latency and typical state of each `step`-minute bin from minute
    // `from`. A bin counts as incident when at least a third of its minutes
    // were, and as degraded when at least half were degraded or worse, so a
    // single bad minute does not colour a whole hour.
    bins(from, n, step) {
      const out = { lat: new Float32Array(n).fill(NaN), st: new Uint8Array(n) };
      for (let k = 0; k < n; k++) {
        let s = 0, c = 0, deg = 0, inc = 0;
        for (let j = 0; j < step; j++) {
          const mi = from + k * step + j, i = slotOf(mi);
          if (m[i] !== mi) continue;
          s += lat[i];
          c++;
          if (st[i] >= 1) deg++;
          if (st[i] === 2) inc++;
        }
        if (c) {
          out.lat[k] = s / c;
          out.st[k] = inc * 3 >= c ? 2 : deg * 2 >= c ? 1 : 0;
        }
      }
      return out;
    },
    // per hour from minute `from`: mean latency and the fraction of minutes in incident
    hours(from, n) {
      const out = { lat: new Float32Array(n).fill(NaN), inc: new Float32Array(n) };
      for (let k = 0; k < n; k++) {
        let s = 0, c = 0, bad = 0;
        for (let j = 0; j < 60; j++) {
          const mi = from + k * 60 + j, i = slotOf(mi);
          if (m[i] !== mi) continue;
          s += lat[i];
          c++;
          if (st[i] === 2) bad++;
        }
        if (c) {
          out.lat[k] = s / c;
          out.inc[k] = bad / c;
        }
      }
      return out;
    },
    dispose() {
      clearInterval(timer);
      removeEventListener('pagehide', save);
      save();
    },
  };
}
