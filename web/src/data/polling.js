import { STALE_AFTER } from './telemetry.js';

// Live adapter: polls a JSON endpoint once per interval.
// Expected payload (all fields numeric unless noted):
// {
//   "timestamp": 1730812345123,      // optional, ms since epoch
//   "latency": 12.4,                 // P50 ms
//   "throughput": 318,               // req/s
//   "errorRate": 0.003,              // fraction, 0.003 = 0.3 %
//   "saturation": 0.42,              // 0..1
//   "hosts": [{ "load": 0.4, "state": "ok" | "warn" | "crit" | "offline", "latency": 11.2 }, ...],
//   "stages": [1.0, 0.7, 2.2, 5.6, 1.9, 0.7],   // optional, ms per pipeline stage
//   "requests": [{ "route": "/v1/predict", "status": 200, "ms": 11.8, "node": 6 }],  // optional
//   "endpoints": [{ "route": "/v1/predict", "rps": 120, "p95": 18.2, "err": 0.002 }],  // optional
//   "regions": [{ "code": "IAD", "rps": 64, "rtt": 92, "err": 0.001 }]                 // optional
// }
// endpoints and regions are matched to the station profile by route / code, or by position.

const STATES = { ok: 0, warn: 1, crit: 2, offline: 3, down: 3 };

function align(list, names, key, fields) {
  if (!Array.isArray(list)) return null;
  return names.map((name, i) => {
    const item = list.find((x) => x && String(x[key]).toUpperCase() === name.toUpperCase()) ?? (list[i]?.[key] == null ? list[i] : null);
    if (!item) return null;
    const out = {};
    for (const f of fields) out[f] = Number.isFinite(+item[f]) ? +item[f] : -1;
    return out;
  });
}

function normalize(j, n, profile) {
  const hosts = Array.isArray(j.hosts) ? j.hosts : [];
  const hostLoads = new Float32Array(n);
  const hostStates = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const h = hosts[i];
    if (!h) {
      hostStates[i] = 3;
      continue;
    }
    hostLoads[i] = Math.max(0, Math.min(1, +h.load || 0));
    hostStates[i] = typeof h.state === 'number' ? h.state : STATES[String(h.state).toLowerCase()] ?? 0;
  }
  const latency = +j.latency || 0;
  const hostLatency = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = hosts[i]?.latency;
    hostLatency[i] = hostStates[i] === 3 ? -1 : Number.isFinite(+v) ? +v : latency;
  }
  return {
    t: Math.floor(j.timestamp ? j.timestamp / 1000 : Date.now() / 1000),
    latency,
    throughput: +j.throughput || 0,
    errorRate: +j.errorRate || 0,
    saturation: +j.saturation || 0,
    hostLoads,
    hostStates,
    hostLatency,
    stageLatency: Array.isArray(j.stages) ? j.stages.map(Number) : null,
    requests: Array.isArray(j.requests) ? j.requests : [],
    endpoints: align(j.endpoints, profile.endpoints.map((e) => e[0]), 'route', ['rps', 'p95', 'err']),
    regions: align(j.regions, profile.regions.map((r) => r[0]), 'code', ['rps', 'rtt', 'err']),
  };
}

export function createPollingSource({ profile, url, hostCount = 32, interval = 1000 }) {
  let timer = null, watchdog = null, controller = null;
  let generation = 0;
  let lastSuccess = -Infinity;
  return {
    kind: 'LIVE',
    hostCount,
    speed: 1,
    now: () => Date.now() / 1000,
    setSpeed() {},
    backfill: () => Promise.resolve([]), // the feed has no history
    triggerIncident() {},
    start(push, store) {
      this.stop();
      const token = generation;
      lastSuccess = -Infinity;
      const freshness = () => store?.setStale(Date.now() - lastSuccess > STALE_AFTER * 1000);
      freshness();
      watchdog = setInterval(freshness, 1000);
      const poll = async () => {
        if (token !== generation) return;
        const ctrl = controller = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 8000);
        try {
          const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const sample = normalize(await r.json(), hostCount, profile);
          if (token !== generation || ctrl.signal.aborted) return;
          push(sample);
          lastSuccess = Date.now();
          freshness();
        } catch (e) {
          if (token === generation) console.warn('[MARS] poll failed', e);
        } finally {
          clearTimeout(timeout);
          if (controller === ctrl) controller = null;
          if (token === generation) timer = setTimeout(poll, interval);
        }
      };
      poll();
    },
    stop() {
      generation++;
      clearTimeout(timer);
      clearInterval(watchdog);
      controller?.abort();
      controller = null;
    },
  };
}
