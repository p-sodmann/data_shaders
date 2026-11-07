import { ROWS, ROW_SECONDS, HIST, TRACK_STEP } from '../config.js';
import { toVec, fromVec } from './geo.js';

// The telemetry store: owns the tape archive (one Float32Array per 10-minute
// row, interleaved [latency, errorRate] per second, -1 = no data), derives
// system state with hysteresis, and turns changes into log events.
// Instruments read it directly every frame; React subscribes at a throttled rate.
//
// Nodes, endpoints, stages and regions are tables sized when the store is
// made. A source that discovers them (Prometheus) asks for spare slots (`caps`)
// and fills them with add*() as new labels appear, so a new node or route keeps
// the short-term state of everything else (ADR-0007). Instruments read the
// tables every frame, so they pick up a new entry without being rebuilt.

const SEV = { NOMINAL: 0, DEGRADED: 1, INCIDENT: 2 };
// No data for this long and a live station is STALE (its source decides).
export const STALE_AFTER = 10;
// requests per second a measured endpoint needs before its P95 is judged
export const MIN_RPS = 5;
const pad2 = (n) => String(n).padStart(2, '0');
export const hms = (t) => {
  const d = new Date(t * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};
export const hm = (t) => {
  const d = new Date(t * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const nodeId = (i) => `N${pad2(i + 1)}`;
// A route template for the dot font, which has no braces: /items/{id} → /items/*
export const routeLabel = (route) => String(route).replace(/\{[^}]*\}/g, '*');
const ema = (prev, v, a) => (prev === undefined || prev < 0 ? v : prev + (v - prev) * a);
// Rising states latch at once; falling needs to clear the lower threshold by a margin.
function hysteresis(prev, v, warn, crit, margin) {
  const want = v >= crit ? 2 : v >= warn ? 1 : 0;
  if (want >= prev) return want;
  if (prev === 2 && v >= crit - margin) return 2;
  return Math.max(want, prev >= 1 && v >= warn - margin ? 1 : 0);
}
// the ground track covers the same span as the tape archive
const TRACK_N = (ROWS * ROW_SECONDS) / TRACK_STEP;
// Page 4 keeps every signal at 1 s for the same span: latency, errors,
// throughput, saturation and the load of each service (so the list depends
// on the station's services: see store.signals).
const BASE_SIGNALS = ['LAT', 'ERR', 'TPUT', 'SAT'];
const SERIES_N = ROWS * ROW_SECONDS;

// caps: { nodes, endpoints, stages, regions }, the most each table may grow
// to; a table without a cap stays at its starting size.
export function createTelemetry({ profile, hostCount, now, kind, getSpeed, caps = {}, nodeNames = null }) {
  const { epErrBudget, serviceOf } = profile;
  // the thresholds may be retuned while the station runs (retune below)
  let thresh = profile.thresh;
  const signals = [...BASE_SIGNALS, ...profile.services];
  const hostCap = Math.max(hostCount, caps.nodes ?? 0);
  const rows = Array.from({ length: ROWS }, () => new Float32Array(ROW_SECONDS * 2).fill(-1));
  const listeners = new Set();
  let quiet = false;
  let notifyTimer = null;

  const s = {
    hostCount,
    hostCap,
    // a name per node where the source has them (Prometheus instances)
    nodeNames: nodeNames ? [...nodeNames] : null,
    now,
    kind,
    profile,
    signals,
    rows,
    rowStart: null,
    lastIdx: -1,
    rowsVersion: 0,
    rolloverWall: -Infinity,
    latest: null,
    ema: null, // slow, for state decisions
    disp: null, // fast, for numerals
    hostStates: new Uint8Array(hostCap),
    hostLoads: new Float32Array(hostCap),
    hostChangeWall: new Float64Array(hostCap).fill(-Infinity),
    counts: { ok: hostCount, warn: 0, crit: 0, off: 0 },
    // smoothed per-host latency, ring buffer of the last HIST seconds (stride hostCap)
    hostLatEma: new Float32Array(hostCap).fill(-1),
    hostHist: new Float32Array(HIST * hostCap).fill(-1),
    histT: new Float64Array(HIST).fill(-1),
    services: profile.services.map((name) => ({ name, state: 0, load: 0, hosts: [] })),
    // pipeline stages and their normal share of the total, in pipeline order
    stages: [...profile.stages],
    stageShare: [...profile.stageShare],
    stageLatency: null,
    requests: [],
    // page 3: endpoints (radar contacts) and client regions (ground track)
    // auto: the SLO was derived from observed latency, not set by a person
    endpoints: profile.endpoints.map(([route, share, slo, auto = false]) => ({ route, share, slo, rps: 0, p95: -1, err: 0, pressure: 0, trend: 0, state: 0, live: false, low: false, auto })),
    regions: profile.regions.map(([code, name, lat, lon]) => ({ code, name, lat, lon, rps: 0, rtt: -1, base: -1, err: 0, state: 0, live: false })),
    centroid: null, // [lat, lon] of the request-weighted traffic centre
    track: new Float32Array(TRACK_N * 2).fill(NaN),
    series: signals.map(() => new Float32Array(SERIES_N).fill(NaN)),
    seriesT: new Float64Array(SERIES_N).fill(-1),
    trackT: new Float64Array(TRACK_N).fill(-1),
    caps,
    // bumped whenever a table gains an entry
    tablesVersion: 0,
    // true once a source asked for more slots than it had; rebuilds counts the
    // times the station was rebuilt for that (ADR-0007)
    overflow: false,
    rebuilds: 0,
    events: [],
    state: 'NOMINAL',
    // state as the lamp sees it: STALE without data, at least DEGRADED while an
    // external (Prometheus) alert fires
    status: 'NOMINAL',
    stale: false,
    external: [],
    stateSince: null,
    pending: null,
    pendingSince: 0,
    snapshot: null,
  };

  function log(t, level, text) {
    s.events.push({ t, wall: quiet ? -Infinity : performance.now(), level, text });
    if (s.events.length > 120) s.events.splice(0, s.events.length - 120);
  }

  function makeSnapshot() {
    s.snapshot = {
      state: s.state,
      status: s.status,
      stale: s.stale,
      stateSince: s.stateSince,
      rowStart: s.rowStart,
      counts: s.counts,
      latest: s.latest,
      kind: s.kind,
      speed: getSpeed(),
    };
  }

  function notify() {
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      makeSnapshot();
      listeners.forEach((fn) => fn());
    }, 150);
  }

  function roll(t) {
    const rs = Math.floor(t / ROW_SECONDS) * ROW_SECONDS;
    if (s.rowStart === null) {
      s.rowStart = rs;
      return;
    }
    if (rs <= s.rowStart) return;
    let peak = -1;
    const done = rows[0];
    for (let i = 0; i < ROW_SECONDS; i++) peak = Math.max(peak, done[i * 2]);
    if (peak >= 0) log(t, 0, `TAPE ${hm(s.rowStart)} ARCHIVED PEAK ${Math.round(peak)}MS`);
    const steps = Math.min(ROWS, Math.round((rs - s.rowStart) / ROW_SECONDS));
    for (let i = 0; i < steps; i++) {
      const r = rows.pop();
      r.fill(-1);
      rows.unshift(r);
    }
    s.rowStart = rs;
    s.lastIdx = -1;
    if (!quiet) s.rolloverWall = performance.now();
  }

  const nodeLabel = (i) => s.nodeNames?.[i]?.toUpperCase() ?? nodeId(i);
  function hostEvent(t, i, prev, st, load) {
    const pct = `${Math.round(load * 100)}%`;
    if (st === 1) log(t, 1, `${nodeLabel(i)} WARN LOAD ${pct}`);
    else if (st === 2) log(t, 2, `${nodeLabel(i)} CRIT LOAD ${pct}`);
    else if (st === 3) log(t, 2, `${nodeLabel(i)} OFFLINE NO HEARTBEAT`);
    else log(t, 0, `${nodeLabel(i)} ${prev === 3 ? 'BACK ONLINE' : 'RECOVERED'}`);
  }

  // A new entry in one of the tables, if its cap leaves room. Returns its
  // index, or -1 (and marks the overflow) when the table is full.
  function grow(table, used, make, what) {
    const cap = caps[table];
    if (cap == null || used >= cap) {
      if (!s.overflow) log(now(), 1, `SLOTS FULL ${table.toUpperCase()} ${what}`);
      s.overflow = true;
      return -1;
    }
    make();
    s.tablesVersion++;
    log(now(), 0, `NEW ${what}`);
    if (!quiet) notify();
    return used;
  }

  function refreshStatus() {
    s.status = s.stale ? 'STALE' : s.external.length && s.state === 'NOMINAL' ? 'DEGRADED' : s.state;
  }

  function setState(next, t) {
    s.state = next;
    refreshStatus();
    s.stateSince = t;
    s.pending = null;
    const e = s.ema;
    log(
      t,
      SEV[next],
      `SYSTEM ${next} P50 ${Math.round(e.lat)}MS ERR ${(e.err * 100).toFixed(1)}%`,
    );
  }

  function pushEndpoints(t, list) {
    list.forEach((m, i) => {
      const ep = s.endpoints[i];
      if (!ep) return;
      ep.live = !!m && m.p95 >= 0;
      if (!ep.live) return;
      ep.rps = ema(ep.rps, Math.max(0, m.rps), 0.3);
      // A measured P95 over the 10 s window from a few dozen requests swings
      // across the SLO and back: below MIN_RPS the endpoint keeps its state
      // and pressure (shown as LOW on the radar) until there is traffic to
      // judge it by. Simulated endpoints have no sampling noise.
      ep.low = caps.endpoints != null && ep.rps < MIN_RPS;
      if (ep.low) return;
      ep.p95 = ema(ep.p95, m.p95, 0.25);
      ep.err = ema(ep.err, Math.max(0, m.err), 0.2);
      const p = Math.max(ep.p95 / ep.slo, ep.err / epErrBudget);
      ep.trend = ep.trend + (p - ep.pressure - ep.trend) * 0.08; // closing rate, per second
      ep.pressure = p;
      const st = hysteresis(ep.state, p, 0.75, 1, 0.06);
      if (st !== ep.state) {
        const what = ep.err / epErrBudget > ep.p95 / ep.slo ? `ERR ${(ep.err * 100).toFixed(1)}%` : `P95 ${Math.round(ep.p95)}MS`;
        const name = routeLabel(ep.route);
        log(t, st, st ? `${name} ${st === 2 ? 'OVER SLO' : 'CLOSING'} ${what}` : `${name} CLEAR`);
        ep.state = st;
      }
    });
    // discovered routes have no configured share of traffic: use the measured one
    if (caps.endpoints != null) {
      const total = s.endpoints.reduce((a, ep) => a + (ep.live ? ep.rps : 0), 0);
      for (const ep of s.endpoints) ep.share = ep.live && total > 0 ? ep.rps / total : 0;
    }
  }

  function pushRegions(t, list) {
    let sx = 0, sy = 0, sz = 0;
    list.forEach((m, i) => {
      const rg = s.regions[i];
      if (!rg) return;
      // a region is live with a request rate; RTT is optional (Prometheus has
      // it only with a trusted client-RTT header, step 11)
      rg.live = !!m && (m.rtt >= 0 || m.rps >= 0);
      if (!rg.live) return;
      rg.rps = ema(rg.rps, Math.max(0, m.rps), 0.3);
      rg.err = ema(rg.err, Math.max(0, m.err), 0.2);
      let ratio = 1;
      if (m.rtt >= 0) {
        rg.rtt = ema(rg.rtt, m.rtt, 0.3);
        // the baseline learns only while the region is healthy (about 8 min)
        if (rg.base < 0) rg.base = rg.rtt;
        else if (rg.state === 0) rg.base += (rg.rtt - rg.base) * 0.002;
        ratio = rg.rtt / Math.max(1, rg.base);
      }
      const st = Math.max(hysteresis(rg.state, ratio, 1.4, 2, 0.1), hysteresis(rg.state, rg.err, thresh.errWarn, thresh.errCrit, 0.002));
      if (st !== rg.state) {
        const why = rg.rtt >= 0 ? `RTT ${Math.round(rg.rtt)}MS` : `ERR ${(rg.err * 100).toFixed(1)}%`;
        log(t, st, st ? `ROUTE ${rg.code} ${st === 2 ? 'LOST' : 'DEGRADED'} ${why}` : `ROUTE ${rg.code} RESTORED`);
        rg.state = st;
      }
      const v = toVec(rg.lat, rg.lon);
      sx += v[0] * rg.rps;
      sy += v[1] * rg.rps;
      sz += v[2] * rg.rps;
    });
    s.centroid = Math.hypot(sx, sy, sz) > 1e-9 ? fromVec([sx, sy, sz]) : null;
    if (s.centroid && t % TRACK_STEP === 0) {
      const slot = Math.floor(t / TRACK_STEP) % TRACK_N;
      s.trackT[slot] = t;
      s.track[slot * 2] = s.centroid[0];
      s.track[slot * 2 + 1] = s.centroid[1];
    }
  }

  // Node states, loads and latencies of one sample. A sample may carry no
  // node data (hostStates null: a backfill older than the per-node window), and
  // then the nodes keep what they had. Returns whether it carried any.
  function applyHosts(x) {
    if (!x.hostStates) return false;
    let ok = 0, warn = 0, crit = 0, off = 0;
    for (let i = 0; i < s.hostCount; i++) {
      const st = x.hostStates[i];
      const prev = s.hostStates[i];
      if (st !== prev) {
        s.hostChangeWall[i] = quiet ? -Infinity : performance.now();
        hostEvent(x.t, i, prev, st, x.hostLoads[i]);
      }
      s.hostStates[i] = st;
      s.hostLoads[i] = x.hostLoads[i];
      if (st === 0) ok++;
      else if (st === 1) warn++;
      else if (st === 2) crit++;
      else off++;
    }
    s.counts = { ok, warn, crit, off };

    // per-host history
    const slot = ((x.t % HIST) + HIST) % HIST;
    s.histT[slot] = x.t;
    for (let i = 0; i < s.hostCount; i++) {
      const v = x.hostLatency ? x.hostLatency[i] : x.latency;
      if (v < 0) s.hostLatEma[i] = -1;
      else s.hostLatEma[i] = s.hostLatEma[i] < 0 ? v : s.hostLatEma[i] + (v - s.hostLatEma[i]) * 0.35;
      s.hostHist[slot * s.hostCap + i] = s.hostLatEma[i];
    }

    // services roll up their hosts; offline hosts count as a warning
    for (const sv of s.services) {
      sv.state = 0;
      sv.load = 0;
      sv.hosts.length = 0;
    }
    for (let i = 0; i < s.hostCount; i++) {
      const sv = s.services[serviceOf(i, s.hostCount)];
      const st = x.hostStates[i];
      sv.hosts.push(i);
      sv.state = Math.max(sv.state, st === 3 ? 1 : st);
      sv.load += x.hostLoads[i];
    }
    for (const sv of s.services) sv.load = sv.hosts.length ? sv.load / sv.hosts.length : 0;

    return true;
  }

  function push(x) {
    roll(x.t);
    const idx = Math.floor(x.t - s.rowStart);
    if (idx >= 0 && idx < ROW_SECONDS) {
      rows[0][idx * 2] = x.latency;
      rows[0][idx * 2 + 1] = x.errorRate;
      s.lastIdx = Math.max(s.lastIdx, idx);
    }
    s.rowsVersion++;

    s.ema = {
      lat: ema(s.ema?.lat, x.latency, 0.12),
      err: ema(s.ema?.err, x.errorRate, 0.12),
    };
    s.disp = {
      lat: ema(s.disp?.lat, x.latency, 0.45),
      tp: ema(s.disp?.tp, x.throughput, 0.45),
      err: ema(s.disp?.err, x.errorRate, 0.45),
    };

    const hasHosts = applyHosts(x);

    const sl = ((x.t % SERIES_N) + SERIES_N) % SERIES_N;
    s.seriesT[sl] = x.t;
    s.series[0][sl] = x.latency;
    s.series[1][sl] = x.errorRate;
    s.series[2][sl] = x.throughput;
    s.series[3][sl] = x.saturation;
    s.services.forEach((sv, k) => (s.series[4 + k][sl] = hasHosts && sv.hosts.length ? sv.load : NaN));

    if (x.stageLatency) s.stageLatency = x.stageLatency;
    if (x.requests) {
      for (const r of x.requests) s.requests.push({ t: x.t, ...r });
      if (s.requests.length > 60) s.requests.splice(0, s.requests.length - 60);
    }

    if (x.endpoints) pushEndpoints(x.t, x.endpoints);
    if (x.regions) pushRegions(x.t, x.regions);

    const e = s.ema;
    const { crit, warn } = s.counts;
    const cand =
      e.lat > thresh.crit || e.err > thresh.errCrit || crit >= 3
        ? 'INCIDENT'
        : e.lat > thresh.warn || e.err > thresh.errWarn || crit >= 1 || warn >= 3
          ? 'DEGRADED'
          : 'NOMINAL';
    if (s.stateSince === null) {
      s.state = cand;
      s.stateSince = x.t;
      refreshStatus();
    } else if (cand === s.state) {
      s.pending = null;
    } else if (SEV[cand] > SEV[s.state]) {
      setState(cand, x.t);
    } else if (s.pending !== cand) {
      s.pending = cand;
      s.pendingSince = x.t;
    } else if (x.t - s.pendingSince >= 20) {
      setState(cand, x.t); // calm down only after 20 s of calm
    }

    s.latest = x;
    if (!quiet) notify();
  }

  return Object.assign(s, {
    push,
    // New thresholds (the stations plate, step 09): the next sample is judged
    // by them, and the tape and every table stay as they are.
    retune(next) {
      s.profile = next;
      thresh = next.thresh;
      s.refresh();
    },
    // node data without a system sample: the source reached its backend, but the
    // station had nothing to report this second (a node down, no traffic)
    pushHosts(x) {
      if (applyHosts(x) && !quiet) notify();
    },
    addNode(name) {
      return grow('nodes', s.hostCount, () => {
        s.nodeNames?.push(name);
        s.hostStates[s.hostCount] = 3;
        s.hostCount++;
      }, `NODE ${String(name).toUpperCase()}`);
    },
    // { route, slo }
    addEndpoint({ route, slo }) {
      return grow('endpoints', s.endpoints.length, () => {
        s.endpoints.push({ route, share: 0, slo, rps: 0, p95: -1, err: 0, pressure: 0, trend: 0, state: 0, live: false, low: false, auto: true });
      }, `ROUTE ${routeLabel(route)}`);
    },
    // A stage nobody has seen before gets the mean share for now.
    addStage(name) {
      return grow('stages', s.stages.length, () => {
        const n = s.stages.length;
        s.stages.push(name);
        s.stageShare = [...s.stageShare.map((v) => (v * n) / (n + 1)), 1 / (n + 1)];
      }, `STAGE ${name.toUpperCase()}`);
    },
    // { code, name, lat, lon }
    addRegion({ code, name, lat, lon }) {
      return grow('regions', s.regions.length, () => {
        s.regions.push({ code, name, lat, lon, rps: 0, rtt: -1, base: -1, err: 0, state: 0, live: false });
      }, `REGION ${code}`);
    },
    setStale(on, t = now()) {
      if (on === s.stale) return;
      s.stale = on;
      refreshStatus();
      log(t, on ? 1 : 0, on ? 'SOURCE STALE NO DATA' : 'SOURCE RESTORED');
      makeSnapshot();
      listeners.forEach((fn) => fn());
    },
    // Firing alerts from the backend's own rules, [{ name, severity }]. They light
    // the lamp but don't change the station's state, which stays MARS's own.
    setExternal(list, t = now()) {
      const key = (l) => l.map((a) => a.name).join('\0');
      if (key(list) === key(s.external)) return;
      const had = new Set(s.external.map((a) => a.name));
      for (const a of list) if (!had.has(a.name)) log(t, 1, `EXT ALERT ${a.name.toUpperCase()} FIRING`);
      const has = new Set(list.map((a) => a.name));
      for (const a of s.external) if (!has.has(a.name)) log(t, 0, `EXT ALERT ${a.name.toUpperCase()} RESOLVED`);
      s.external = list;
      refreshStatus();
      makeSnapshot();
      listeners.forEach((fn) => fn());
    },
    // push a batch without logging; `after` sees each sample once it is applied
    ingest(samples, after) {
      quiet = true;
      for (const x of samples) {
        push(x);
        after?.(x);
      }
      quiet = false;
      makeSnapshot();
    },
    // smoothed latency of host i at second t, or -1
    hostLatAt(t, i) {
      const slot = ((t % HIST) + HIST) % HIST;
      return s.histT[slot] === t ? s.hostHist[slot * s.hostCap + i] : -1;
    },
    // global P50 at second t from the tape, or -1
    latencyAt(t) {
      if (s.rowStart === null) return -1;
      const k = Math.floor((s.rowStart - Math.floor(t / ROW_SECONDS) * ROW_SECONDS) / ROW_SECONDS);
      if (k < 0 || k >= ROWS) return -1;
      const idx = Math.floor(t - (s.rowStart - k * ROW_SECONDS));
      return idx >= 0 && idx < ROW_SECONDS ? s.rows[k][idx * 2] : -1;
    },
    // signal k (index into SIGNALS) averaged into n bins of `step` seconds
    // starting at t0; bins without data are NaN
    window(k, t0, n, step = 1) {
      const out = new Float64Array(n);
      const ser = s.series[k];
      for (let i = 0; i < n; i++) {
        let sum = 0, cnt = 0;
        for (let j = 0; j < step; j++) {
          const t = t0 + i * step + j;
          const slot = ((t % SERIES_N) + SERIES_N) % SERIES_N;
          if (s.seriesT[slot] === t && ser[slot] === ser[slot]) {
            sum += ser[slot];
            cnt++;
          }
        }
        out[i] = cnt ? sum / cnt : NaN;
      }
      return out;
    },
    // ground-track samples, oldest first: [{ t, lat, lon }]
    trackPoints() {
      const out = [];
      if (!s.latest) return out;
      const end = Math.floor(s.latest.t / TRACK_STEP);
      for (let k = end - TRACK_N + 1; k <= end; k++) {
        const slot = ((k % TRACK_N) + TRACK_N) % TRACK_N;
        if (s.trackT[slot] === k * TRACK_STEP) out.push({ t: k * TRACK_STEP, lat: s.track[slot * 2], lon: s.track[slot * 2 + 1] });
      }
      return out;
    },
    note(level, text) {
      log(now(), level, text);
    },
    refresh() {
      makeSnapshot();
      listeners.forEach((fn) => fn());
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot() {
      if (!s.snapshot) makeSnapshot();
      return s.snapshot;
    },
  });
}
