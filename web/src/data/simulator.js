import { ROWS, ROW_SECONDS, STAGE_SHARE, ENDPOINTS, REGIONS, HOME } from '../config.js';
import { distanceKm, solarHour } from './geo.js';

const ROUTES = [
  ['/v1/predict', 0.55],
  ['/v1/embed', 0.2],
  ['/v1/rank', 0.12],
  ['/v1/models', 0.08],
  ['/healthz', 0.05],
];

// A plausible fake cluster: daily traffic rhythm, an hourly batch job, a cache
// sweep every ten minutes, random latency spikes, single-node blips, rare node
// outages and occasional incidents that hit a contiguous "rack" of nodes.
// Endpoints get the odd slow deploy; client regions follow their local
// daylight and now and then suffer a route flap (RTT and errors up).
// The periodic events land at the same x position on every tape row, so the
// archive shows them as vertical seams, which is the point of aligned rows.

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (x) => x * x * (3 - 2 * x);
const mod = (a, n) => ((a % n) + n) % n;

// Traffic between 0.1 and 0.9: peaks at 15:00 local, a third lower at weekends.
function dailyTraffic(t, tz) {
  const local = t - tz;
  const day = mod(local / 86400, 1);
  const wd = new Date(t * 1000).getDay();
  const weekend = wd === 0 || wd === 6 ? 0.65 : 1;
  return (0.5 + 0.4 * Math.sin(2 * Math.PI * (day - 0.375))) * weekend;
}

export function createSimulator({ hostCount = 32, seed = Date.now() } = {}) {
  const rnd = mulberry32(seed >>> 0);
  const gauss = () => {
    let u = 0;
    while (u === 0) u = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };
  const tz = new Date().getTimezoneOffset() * 60;

  let slow = 0, fast = 0, tp = 0, sat = 0, err = 0, spike = 0;
  const offset = Float32Array.from({ length: hostCount }, () => (rnd() - 0.5) * 0.2);
  const noise = new Float32Array(hostCount);
  const blip = new Float32Array(hostCount);
  const down = new Float32Array(hostCount);
  const latNoise = new Float32Array(hostCount);
  let incident = null;
  let nextIncident = null;
  // a rogue scheduled job that appears now and then and runs for a few hours
  let rogue = null;

  // endpoints: a fixed operating point below the SLO, plus occasional slowdowns
  const E = ENDPOINTS.length;
  const epBase = Float32Array.from({ length: E }, () => 0.3 + rnd() * 0.18);
  const epErr = Float32Array.from({ length: E }, () => 0.5 + rnd());
  const epNoise = new Float32Array(E);
  const epEvent = Array.from({ length: E }, () => null);
  // regions: RTT from distance, occasional route flaps
  const G = REGIONS.length;
  const rgRtt = REGIONS.map(([, , lat, lon]) => 3 + distanceKm(lat, lon, HOME.lat, HOME.lon) / 95);
  const rgNoise = new Float32Array(G);
  const rgErr = Float32Array.from({ length: G }, () => 0.5 + rnd());
  const rgEvent = Array.from({ length: G }, () => null);
  // 0 → 1 → 0 over an event's life, with 20 s edges
  const envelope = (ev, t) => {
    if (!ev) return 0;
    const d = t - ev.t0;
    return Math.max(0, Math.min(1, d / 20, (ev.dur - d) / 20));
  };

  function startIncident(t, severity) {
    const width = 3 + Math.floor(rnd() * 5);
    incident = {
      t0: t,
      ramp: 30 + rnd() * 50,
      hold: 140 + rnd() * 320,
      fall: 80 + rnd() * 120,
      severity,
      first: Math.floor(rnd() * (hostCount - width + 1)),
      width,
      stage: 1 + Math.floor(rnd() * 4), // the pipeline stage that chokes
      endpoint: Math.floor(rnd() * 3), // the endpoint that takes the worst of it
    };
  }

  function incidentLevel(t) {
    if (!incident) return 0;
    const { t0, ramp, hold, fall, severity } = incident;
    const d = t - t0;
    if (d < 0) return 0;
    if (d < ramp) return severity * smooth(d / ramp);
    if (d < ramp + hold) return severity * (0.9 + 0.1 * Math.sin(d * 0.05));
    if (d < ramp + hold + fall) return severity * (1 - smooth((d - ramp - hold) / fall));
    incident = null;
    return 0;
  }

  function step(t) {
    if (nextIncident === null) nextIncident = t + 900 + rnd() * 2400;
    if (!incident && t >= nextIncident) {
      startIncident(t, 0.55 + rnd() * 0.45);
      nextIncident = t + 2400 + rnd() * 4800;
    }
    const inc = incidentLevel(t);

    const local = t - tz;
    const traffic = dailyTraffic(t, tz);
    const hourSec = mod(local, 3600);
    const job = hourSec < 180 ? Math.sin((Math.PI * hourSec) / 180) : 0; // hourly batch
    const rowSec = mod(t, ROW_SECONDS);
    const sweep = rowSec >= 300 && rowSec < 312 ? Math.sin((Math.PI * (rowSec - 300)) / 12) : 0;
    if (rogue && t - rogue.t0 > rogue.dur) rogue = null;
    if (!rogue && rnd() < 1 / 21600) {
      const period = [240, 420, 900, 1500][Math.floor(rnd() * 4)];
      rogue = { t0: t, dur: 3600 + rnd() * 7200, period, width: 20 + rnd() * 25, amp: 4 + rnd() * 3 };
    }
    const rp = rogue ? mod(t - rogue.t0, rogue.period) : Infinity;
    const cron = rp < rogue?.width ? rogue.amp * Math.sin((Math.PI * rp) / rogue.width) : 0;

    slow += 0.004 * -slow + 0.09 * gauss();
    fast += 0.35 * -fast + 0.5 * gauss();
    tp += 0.02 * -tp + 0.2 * gauss();
    sat += 0.03 * -sat + 0.2 * gauss();
    err += 0.06 * -err + 0.25 * gauss();
    if (spike < 0.3 && rnd() < 0.005) spike = 5 + rnd() * 15;
    else spike *= 0.6;

    const saturation = clamp(0.2 + 0.42 * traffic + 0.05 * sat + 0.1 * job + 0.38 * inc, 0.02, 0.995);
    const throughput = Math.max(5, 150 + 230 * traffic + 16 * tp + 60 * job - 140 * inc);
    const latency = Math.max(
      2,
      7 + 10 * saturation * saturation + 0.8 * slow + 0.6 * fast + spike + 6 * job + 7 * sweep + cron + 30 * inc,
    );
    const errorRate = Math.max(0, 0.0016 + 0.0007 * err + 0.03 * inc * inc + (spike > 4 ? 0.0015 : 0));

    const hostLoads = new Float32Array(hostCount);
    const hostStates = new Uint8Array(hostCount);
    const hostLatency = new Float32Array(hostCount);
    for (let i = 0; i < hostCount; i++) {
      latNoise[i] += 0.1 * -latNoise[i] + 0.35 * gauss();
      noise[i] += 0.08 * -noise[i] + 0.02 * gauss();
      if (down[i] > 0) down[i]--;
      else if (rnd() < 0.00001) down[i] = 240 + rnd() * 600;
      if (blip[i] > 0) blip[i]--;
      else if (rnd() < 0.00007) blip[i] = 15 + rnd() * 70;
      const hit = incident && i >= incident.first && i < incident.first + incident.width ? inc : 0;
      const load = clamp(saturation + offset[i] + noise[i] + (blip[i] > 0 ? 0.36 : 0) + hit * 0.4, 0, 1);
      let state = 0;
      if (down[i] > 0) state = 3;
      else if (load > 0.95 || hit > 0.7) state = 2;
      else if (load > 0.82 || hit > 0.3) state = 1;
      hostLoads[i] = state === 3 ? 0 : load;
      hostStates[i] = state;
      hostLatency[i] =
        state === 3
          ? -1
          : Math.max(1, latency * (0.72 + 0.6 * load) + 1.2 * latNoise[i] + (blip[i] > 0 ? 9 : 0) + hit * 16);
    }

    // where in the pipeline the time goes
    const w = STAGE_SHARE.map((s, k) => s * (k === 2 ? 1 + job : 1) * (incident && k === incident.stage ? 1 + 4 * inc : 1));
    const wSum = w.reduce((a, b) => a + b, 0);
    const stageLatency = w.map((x) => (latency * x) / wSum);

    // a few sampled requests for the trace
    const requests = [];
    const k = 1 + (rnd() < 0.5 ? 1 : 0);
    for (let j = 0; j < k; j++) {
      let r = rnd(), route = ROUTES[0][0];
      for (const [p, share] of ROUTES) {
        if ((r -= share) <= 0) {
          route = p;
          break;
        }
      }
      let node = Math.floor(rnd() * hostCount);
      if (hostStates[node] === 3) node = (node + 1) % hostCount;
      const ms = Math.max(0.4, hostLatency[node] * (0.6 + 0.8 * rnd()) * (rnd() < 0.03 ? 2.5 : 1));
      const status = rnd() < errorRate * 8 ? (rnd() < 0.7 ? 503 : 500) : rnd() < 0.01 ? 404 : 200;
      requests.push({ route, node, ms, status });
    }

    const latRatio = latency / 11;
    const endpoints = ENDPOINTS.map(([, share, slo], e) => {
      epNoise[e] += 0.15 * -epNoise[e] + 0.3 * gauss();
      if (epEvent[e] && t - epEvent[e].t0 > epEvent[e].dur) epEvent[e] = null;
      if (!epEvent[e] && rnd() < 0.00005) epEvent[e] = { t0: t, dur: 90 + rnd() * 300, mul: 1.5 + rnd() * 0.9 };
      const env = envelope(epEvent[e], t);
      const hit = incident && e === incident.endpoint ? 1 + 0.8 * inc : 1;
      const p95 = slo * epBase[e] * Math.pow(latRatio, 0.8) * (1 + 0.07 * epNoise[e]) * (1 + (epEvent[e] ? epEvent[e].mul - 1 : 0) * env) * hit;
      return {
        rps: throughput * share * (1 + 0.04 * epNoise[e]),
        p95: Math.max(0.2, p95),
        err: Math.max(0, errorRate * epErr[e] + 0.006 * env),
      };
    });

    const weights = REGIONS.map(([, , , lon, share]) => {
      const h = solarHour(t, lon);
      return share * (0.25 + 0.75 * Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * (h - 4)) / 24), 1.4));
    });
    const wTotal = weights.reduce((a, b) => a + b, 0);
    const regions = REGIONS.map((_, g) => {
      rgNoise[g] += 0.1 * -rgNoise[g] + 0.3 * gauss();
      if (rgEvent[g] && t - rgEvent[g].t0 > rgEvent[g].dur) rgEvent[g] = null;
      if (!rgEvent[g] && rnd() < 0.00003) {
        rgEvent[g] = { t0: t, dur: 120 + rnd() * 420, mul: 1.6 + rnd() * 1.4, err: 0.004 + rnd() * 0.025 };
      }
      const ev = rgEvent[g], env = envelope(ev, t);
      return {
        rps: Math.max(0, (throughput * weights[g]) / wTotal) * (1 - 0.3 * env) * (1 + 0.03 * rgNoise[g]),
        rtt: Math.max(1, rgRtt[g] * (1 + 0.03 * rgNoise[g]) * (1 + (ev ? ev.mul - 1 : 0) * env) + latency * 0.3),
        err: Math.max(0, errorRate * rgErr[g] * (1 + 0.1 * rgNoise[g]) + (ev ? ev.err : 0) * env),
      };
    });

    return {
      t, latency, throughput, errorRate, saturation, hostLoads, hostStates, hostLatency, stageLatency, requests,
      endpoints, regions,
    };
  }

  return { step, triggerIncident: (t) => startIncident(t, 1) };
}

// Source contract (see README): { kind, hostCount, speed, now(), setSpeed(),
// backfill(fromT) -> samples[], start(push), stop(), triggerIncident() }
export function createSimulatedSource({ hostCount = 32, speed = 1 } = {}) {
  const sim = createSimulator({ hostCount });
  let baseT = Date.now() / 1000;
  let baseWall = performance.now();
  let sp = speed;
  let nextT = null;
  let timer = null;
  let push = null;

  const now = () => baseT + ((performance.now() - baseWall) / 1000) * sp;

  const tick = () => {
    const n = now();
    if (nextT === null) nextT = Math.floor(n);
    // after a long sleep, skip ahead instead of replaying more than the archive holds
    if (n - nextT > ROWS * ROW_SECONDS) nextT = Math.floor(n) - ROWS * ROW_SECONDS;
    while (nextT <= n) push(sim.step(nextT++));
  };
  const schedule = () => {
    clearInterval(timer);
    if (push) timer = setInterval(tick, Math.max(16, Math.min(250, 500 / sp)));
  };

  return {
    kind: 'SIMULATED',
    hostCount,
    get speed() {
      return sp;
    },
    now,
    setSpeed(v) {
      baseT = now();
      baseWall = performance.now();
      sp = v;
      schedule();
    },
    backfill(from) {
      const out = [];
      const end = Math.floor(now());
      for (let t = Math.floor(from); t < end; t++) out.push(sim.step(t));
      nextT = end;
      return out;
    },
    start(fn) {
      push = fn;
      tick();
      schedule();
    },
    stop() {
      clearInterval(timer);
    },
    triggerIncident() {
      sim.triggerIncident(nextT ?? Math.floor(now()));
    },
  };
}

// Long history at one-minute resolution, for the almanac. It follows the same
// model as step() (daily and weekly traffic, the hourly job, incidents every
// one to two hours) but is computed per minute and seeded per day, so the same
// past comes back on every boot. About one day in five has a major outage: a
// long partial outage that fails a fifth or so of requests.
const hash32 = (n) => {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
};

export function createHistorySynth() {
  const tz = new Date().getTimezoneOffset() * 60;
  const days = new Map();
  function incidentsOf(d) {
    if (days.has(d)) return days.get(d);
    const rnd = mulberry32(hash32(d * 7919 + 17));
    const list = [];
    for (let t = d * 86400 + rnd() * 3600; t < (d + 1) * 86400; t += 2400 + rnd() * 4800) {
      list.push({ t0: t, ramp: 30 + rnd() * 50, hold: 140 + rnd() * 320, fall: 80 + rnd() * 120, sev: 0.55 + rnd() * 0.45, fail: 0 });
    }
    if (rnd() < 0.2) list.push({ t0: d * 86400 + rnd() * 80000, ramp: 300, hold: 1800 + rnd() * 3600, fall: 600, sev: 1, fail: 0.12 + rnd() * 0.18 });
    if (days.size > 64) days.clear();
    days.set(d, list);
    return list;
  }
  // incident level and the extra failure rate of a partial outage
  function level(t) {
    let v = 0, fail = 0;
    const d = Math.floor(t / 86400);
    for (const dd of [d - 1, d]) {
      for (const i of incidentsOf(dd)) {
        const x = t - i.t0;
        if (x < 0 || x > i.ramp + i.hold + i.fall) continue;
        const l = x < i.ramp ? smooth(x / i.ramp) : x < i.ramp + i.hold ? 0.95 : 1 - smooth((x - i.ramp - i.hold) / i.fall);
        v = Math.max(v, i.sev * l);
        fail = Math.max(fail, i.fail * l);
      }
    }
    return [v, fail];
  }
  // slow wander: value noise on a 10-minute lattice
  const wander = (t) => {
    const k = Math.floor(t / 600), f = smooth((t % 600) / 600);
    const a = hash32(k) / 4294967296 - 0.5, b = hash32(k + 1) / 4294967296 - 0.5;
    return a + (b - a) * f;
  };
  return function minute(mi) {
    const t0 = mi * 60;
    let inc = 0, inc2 = 0, fail = 0;
    for (let k = 0; k < 6; k++) {
      const [v, f] = level(t0 + 5 + k * 10);
      inc += v / 6;
      inc2 += (v * v) / 6;
      fail += f / 6;
    }
    const traffic = dailyTraffic(t0 + 30, tz);
    const hm = mod(Math.floor((t0 - tz) / 60), 60);
    const job = hm < 3 ? 0.64 : 0;
    const jit = hash32(mi) / 4294967296 - 0.5;
    const saturation = clamp(0.2 + 0.42 * traffic + 0.1 * job + 0.38 * inc + 0.03 * jit, 0.02, 0.995);
    const throughput = Math.max(5, 150 + 230 * traffic + 60 * job - 140 * inc);
    const latency = Math.max(2, 7 + 10 * saturation * saturation + 2 * wander(t0) + 6 * job + 30 * inc + 0.6 * jit);
    const errorRate = Math.max(0, 0.0016 + 0.0004 * jit + 0.03 * inc2 + fail);
    return { latency, errorRate, throughput, saturation };
  };
}
