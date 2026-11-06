import { HIST } from '../../config.js';
import { STALE_AFTER } from '../telemetry.js';
import { region } from '../regions.js';
import { chunks, pool, sel } from './client.js';
import { defaultSlo } from './discover.js';

// The live side of a Prometheus station: one instant query per second for all
// of the station's `mars:*` series, mapped to a telemetry frame as ADR-0003
// lays out, plus sampled requests (exemplars) every 5 s and the backend's own
// firing alerts every 10 s.
//
// Source contract (see station.js): { kind, hostCount, speed, now(), setSpeed(),
// backfill(fromT, progress) -> Promise<samples[]>, start(push, store), stop(),
// triggerIncident() }, plus sync(). The store passed to start() is the one this
// source fills: new labels take spare slots in it, and it hears about staleness
// and external alerts. `overflow()` is called once when a new label finds no slot.
//
// Time is Prometheus's, not the browser's: a display whose clock is off by
// minutes would otherwise ask for seconds Prometheus doesn't have yet (and an
// instant query only looks back 5 minutes). sync() measures the offset before
// the tape loads, and every live answer keeps it current, since the live query
// carries no time and comes back stamped with Prometheus's evaluation time.

const POLL_MS = 1000;
const EXEMPLAR_EVERY = 5;
const ALERTS_EVERY = 10;
// Prometheus range queries are cut into chunks of at most this many points
// (one hour at 1 s, well under its 11,000-point cap), and at most this many
// run at once per backfill.
const CHUNK_POINTS = 3601;
const PARALLEL = 4;
const RANGE_TIMEOUT = 30000;

const STATION_SERIES = 'mars:(latency_p50_ms|throughput_rps|error_ratio|saturation_ratio)';
const NODE_SERIES = 'mars:node_(up|load_ratio|latency_p50_ms)';
const REQUEST_METRIC = 'mars_http_request_duration_seconds_bucket';

const num = (v) => {
  const x = +v;
  return Number.isFinite(x) ? x : undefined;
};

// Index of a store table by name, kept in step with the store.
function indexOf(list, key) {
  return new Map(list.map((x, i) => [key(x), i]));
}

// One second of `mars:*` series, by kind. `get(name, label?)` → value or undefined.
function group(result) {
  const by = new Map();
  for (const r of result) {
    const m = r.metric;
    const name = m.__name__?.slice(5); // drop "mars:"
    const sub = m.instance ?? m.route ?? m.stage ?? m.region ?? '';
    if (!by.has(name)) by.set(name, new Map());
    by.get(name).set(sub, num(r.value[1]));
  }
  return {
    get: (name, sub = '') => by.get(name)?.get(sub),
    keys: (name) => [...(by.get(name)?.keys() ?? [])],
  };
}

export function createPrometheusSource({ client, station, profile, onOverflow = () => {} }) {
  const { thresh } = profile;
  const s = sel(station);
  let store = null;
  let idx = null;
  let timer = null;
  let running = false;
  let busy = false;
  let lastT = -Infinity;
  let lastDataWall = -Infinity;
  let lastExemplarT = -Infinity;
  let pending = [];
  let overflowed = false;
  let tick = 0;
  let offset = 0; // Prometheus's clock minus the browser's, seconds
  const now = () => Date.now() / 1000 + offset;

  // Make sure every label we see has a slot; returns the index or -1.
  function slot(table, name, add) {
    let i = idx[table].get(name);
    if (i !== undefined) return i;
    i = add();
    if (i >= 0) idx[table].set(name, i);
    else if (!overflowed) {
      overflowed = true;
      onOverflow();
    }
    return i;
  }

  function bind(st) {
    if (store === st) return;
    store = st;
    idx = {
      nodes: indexOf(st.nodeNames ?? [], (n) => n),
      endpoints: indexOf(st.endpoints, (e) => e.route),
      stages: indexOf(st.stages, (n) => n),
      regions: indexOf(st.regions, (r) => r.code),
    };
  }

  // Per-node arrays for the store from node series; null if none of the station's
  // nodes reported (then the store keeps what it had).
  function hosts(g, fallbackLatency) {
    for (const name of g.keys('node_up')) slot('nodes', name, () => store.addNode(name));
    const n = store.hostCount;
    const hostStates = new Uint8Array(n);
    const hostLoads = new Float32Array(n);
    const hostLatency = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const name = store.nodeNames[i];
      // a node Prometheus doesn't list any more counts as down, like up == 0
      if (!g.get('node_up', name)) {
        hostStates[i] = 3;
        hostLatency[i] = -1;
        continue;
      }
      const load = Math.max(0, Math.min(1, g.get('node_load_ratio', name) ?? 0));
      hostLoads[i] = load;
      hostStates[i] = load >= thresh.satCrit ? 2 : load >= thresh.satWarn ? 1 : 0;
      hostLatency[i] = g.get('node_latency_p50_ms', name) ?? fallbackLatency ?? -1;
    }
    return { hostStates, hostLoads, hostLatency };
  }

  // The telemetry frame for second t, or null when the station reported no
  // system sample (no throughput series: its target is down or unknown; no
  // latency: it had no traffic). Node data is pushed separately in that case.
  // With every node down, the station-level rules still yield values for one
  // rate window (10 s) from the last scrapes; those are leftovers, not data.
  function frame(result, t) {
    const g = group(result);
    const h = hosts(g, g.get('latency_p50_ms'));
    const allDown = store.hostCount > 0 && h.hostStates.every((s) => s === 3);
    const throughput = allDown ? undefined : g.get('throughput_rps');
    const latency = allDown ? undefined : g.get('latency_p50_ms');

    for (const route of g.keys('endpoint_p95_ms')) {
      slot('endpoints', route, () => store.addEndpoint({ route, slo: defaultSlo(g.get('endpoint_p95_ms', route)) }));
    }
    for (const name of g.keys('stage_mean_ms')) slot('stages', name, () => store.addStage(name));
    for (const code of g.keys('region_rps')) {
      const r = region(code);
      if (r) slot('regions', code, () => store.addRegion(r));
    }

    const stageLatency = g.keys('stage_mean_ms').length ? store.stages.map((name) => g.get('stage_mean_ms', name) ?? 0) : null;
    const endpoints = store.endpoints.map(({ route }) => {
      const rps = g.get('endpoint_rps', route), p95 = g.get('endpoint_p95_ms', route);
      if (rps === undefined && p95 === undefined) return null;
      return { rps: rps ?? 0, p95: p95 ?? -1, err: g.get('endpoint_error_ratio', route) ?? 0 };
    });
    const regions = store.regions.map(({ code }) => {
      const rps = g.get('region_rps', code);
      if (rps === undefined) return null;
      return { rps, rtt: g.get('region_rtt_ms', code) ?? -1, err: g.get('region_error_ratio', code) ?? 0 };
    });

    const base = { t, ...h };
    if (throughput === undefined || latency === undefined) return { data: throughput !== undefined, hosts: base };
    return {
      data: true,
      hosts: base,
      sample: {
        ...base,
        latency,
        throughput,
        // absent means no traffic, which the latency check above already covers
        errorRate: g.get('error_ratio') ?? 0,
        saturation: g.get('saturation_ratio') ?? 0,
        stageLatency,
        requests: null,
        endpoints,
        regions,
      },
    };
  }

  async function sampleRequests(t) {
    const list = await client.exemplars(`${REQUEST_METRIC}${s}`, t - EXEMPLAR_EVERY, t);
    const out = [];
    for (const { seriesLabels: l, exemplars } of list) {
      for (const e of exemplars) {
        const et = +e.timestamp;
        if (et <= lastExemplarT) continue;
        const status = +e.labels?.status || (l.code_class === '5xx' ? 500 : l.code_class === '4xx' ? 400 : 200);
        out.push({ t: Math.floor(et), at: et, route: l.route, status, ms: +e.value * 1000, node: idx.nodes.get(l.instance) ?? null });
      }
    }
    out.sort((a, b) => a.at - b.at);
    if (out.length) lastExemplarT = out.at(-1).at;
    pending.push(...out.map(({ at, ...r }) => r));
    if (pending.length > 60) pending = pending.slice(-60);
  }

  async function checkAlerts() {
    const alerts = await client.alerts();
    const firing = new Map();
    for (const a of alerts) {
      if (a.state !== 'firing' || a.labels?.station !== station) continue;
      const name = a.labels.alertname ?? 'ALERT';
      firing.set(name, { name, severity: a.labels.severity ?? '' });
    }
    store.setExternal([...firing.values()]);
  }

  async function poll(push) {
    if (busy) return; // Prometheus is slow: never queue polls up behind each other
    busy = true;
    tick++;
    try {
      const side = [];
      if (tick % EXEMPLAR_EVERY === 0) side.push(sampleRequests(Math.floor(now())).catch(() => {}));
      if (tick % ALERTS_EVERY === 1) side.push(checkAlerts().catch(() => {}));
      const result = await client.query(`{__name__=~"mars:.+",station=${JSON.stringify(station)}}`);
      await Promise.all(side);
      if (!running) return;
      // every sample of an instant query carries the evaluation time
      if (result.length) offset = +result[0].value[0] - Date.now() / 1000;
      const t = Math.floor(now());
      const f = frame(result, t);
      if (f.data) lastDataWall = Date.now();
      if (f.sample && t > lastT) {
        lastT = t;
        f.sample.requests = pending;
        pending = [];
        push(f.sample);
      } else {
        store.pushHosts(f.hosts);
      }
    } catch (e) {
      // a failed poll pushes nothing: the tape shows the gap
      if (Date.now() - lastDataWall < POLL_MS * 2) console.warn(`[MARS] station "${station}": ${e.message}`);
    } finally {
      busy = false;
    }
    if (running) store.setStale(Date.now() - lastDataWall > STALE_AFTER * 1000);
  }

  // Several range queries ([query, from, to, step]), each cut into chunks, all
  // chunks through one pool of PARALLEL. Resolves to one result list per query.
  async function ranges(list, progress) {
    const tasks = [], owner = [];
    list.forEach(([query, from, to, step], k) => {
      for (const [a, b] of chunks(from, to, step, CHUNK_POINTS)) {
        tasks.push(() => client.queryRange(query, a, b, step, RANGE_TIMEOUT));
        owner.push(k);
      }
    });
    const res = await pool(tasks, PARALLEL, (n) => progress?.(n / tasks.length));
    const out = list.map(() => []);
    res.forEach((r, i) => out[owner[i]].push(...r));
    return out;
  }

  return {
    kind: 'LIVE',
    get hostCount() {
      return store?.hostCount ?? 0;
    },
    speed: 1,
    now,
    setSpeed() {},
    triggerIncident() {},

    // Measures Prometheus's clock; returns the offset in seconds (theirs − ours).
    async sync() {
      const before = Date.now();
      const t = await client.time();
      offset = t - (before + Date.now()) / 2000;
      return offset;
    },

    // The tape: station-level series at 1 s from `fromT` to now. Node series
    // only for the last HIST seconds (what the fleet and slice instruments
    // show); endpoints, stages and regions are live-only, so they aren't
    // backfilled. `store` gets new nodes found on the way.
    async backfill(fromT, progressFn, st) {
      bind(st);
      const end = Math.floor(now()) - 1;
      const from = Math.floor(fromT);
      const [sys, nodes] = await ranges(
        [
          [`{__name__=~"${STATION_SERIES}",station=${JSON.stringify(station)}}`, from, end, 1],
          [`{__name__=~"${NODE_SERIES}",station=${JSON.stringify(station)}}`, Math.max(from, end - HIST + 1), end, 1],
        ],
        progressFn,
      );

      const n = end - from + 1;
      const col = (series, name) => {
        const out = new Float64Array(n).fill(NaN);
        for (const r of series) {
          if (r.metric.__name__ !== `mars:${name}`) continue;
          for (const [t, v] of r.values) {
            const i = Math.round(+t) - from;
            if (i >= 0 && i < n) out[i] = +v;
          }
        }
        return out;
      };
      const lat = col(sys, 'latency_p50_ms'), tp = col(sys, 'throughput_rps'), err = col(sys, 'error_ratio'), sat = col(sys, 'saturation_ratio');

      // node values per second, by instance
      const nodeAt = new Map();
      for (const r of nodes) {
        const inst = r.metric.instance;
        slot('nodes', inst, () => store.addNode(inst));
        for (const [t, v] of r.values) {
          const ts = Math.round(+t);
          if (!nodeAt.has(ts)) nodeAt.set(ts, []);
          nodeAt.get(ts).push({ metric: { __name__: r.metric.__name__, instance: inst }, value: [t, v] });
        }
      }

      const out = [];
      for (let i = 0; i < n; i++) {
        if (!(lat[i] === lat[i]) || !(tp[i] === tp[i])) continue; // a gap stays a gap
        const t = from + i;
        const nd = nodeAt.get(t);
        const h = nd ? hosts(group(nd), lat[i]) : { hostStates: null, hostLoads: null, hostLatency: null };
        out.push({
          t, latency: lat[i], throughput: tp[i], errorRate: err[i] === err[i] ? err[i] : 0, saturation: sat[i] === sat[i] ? sat[i] : 0,
          ...h, stageLatency: null, requests: null, endpoints: null, regions: null,
        });
      }
      lastT = out.length ? out.at(-1).t : end;
      lastDataWall = out.length && out.at(-1).t >= end - STALE_AFTER ? Date.now() : -Infinity;
      return out;
    },

    // One record per minute for the almanac, for minutes [fromMin, toMin):
    // [{ mi, latency, errorRate, throughput, saturation }]. Each value is the
    // minute's mean of the 1 s rule, read at the end of the minute.
    async history(fromMin, toMin) {
      if (toMin <= fromMin) return [];
      const names = ['latency_p50_ms', 'throughput_rps', 'error_ratio', 'saturation_ratio'];
      const [lat, tp, err, sat] = await ranges(names.map((name) => [`avg_over_time(mars:${name}${s}[1m])`, (fromMin + 1) * 60, toMin * 60, 60]));
      const byMin = (series) => {
        const m = new Map();
        for (const r of series) for (const [t, v] of r.values) m.set(Math.round(+t / 60) - 1, +v);
        return m;
      };
      const L = byMin(lat), T = byMin(tp), E = byMin(err), S = byMin(sat);
      const out = [];
      for (const [mi, latency] of L) {
        if (!T.has(mi)) continue;
        out.push({ mi, latency, throughput: T.get(mi), errorRate: E.get(mi) ?? 0, saturation: S.get(mi) ?? 0 });
      }
      return out.sort((a, b) => a.mi - b.mi);
    },

    start(push, st) {
      bind(st);
      running = true;
      const loop = () => {
        poll(push);
        // just after each wall-clock second, when the rules have been evaluated
        timer = setTimeout(loop, POLL_MS - (Date.now() % POLL_MS) + 150);
      };
      loop();
    },
    stop() {
      running = false;
      clearTimeout(timer);
    },
  };
}
