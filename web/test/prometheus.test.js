import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chunks, createPromClient, pool, MAX_POINTS } from '../src/data/prometheus/client.js';
import { discover, orderStages, probeOrder, defaultSlo } from '../src/data/prometheus/discover.js';
import { createPrometheusSource } from '../src/data/prometheus/source.js';
import { createStation } from '../src/station/station.js';
import { createProfile } from '../src/station/profile.js';
import { createTelemetry } from '../src/data/telemetry.js';
import { createSimulatedSource } from '../src/data/simulator.js';

// Responses recorded from the step 03 demo stack (see __fixtures__/README.md).
const FX = new URL('../src/data/prometheus/__fixtures__/', import.meta.url);
const fx = (name) => JSON.parse(readFileSync(new URL(name, FX), 'utf8'));
const LIVE_T = 1793977413; // when live.json was recorded

const ok = (body) => Promise.resolve({ status: 200, json: async () => body });
const success = (data) => ({ status: 'success', data });
const params = (url) => {
  const u = new URL(url, 'http://x');
  return { path: u.pathname.replace(/^.*\/api\/v1\//, ''), q: Object.fromEntries(u.searchParams), u };
};

// A fake Prometheus for one station: discovery and instant queries come from
// the fixtures (the live answer can be swapped), range queries are generated
// for any span so the 4 h backfill can be tested, with every 100th second
// missing. It records the range queries in flight, and refuses more than
// MAX_POINTS like the real one.
function fakeProm() {
  const state = { live: fx('live.json'), alerts: fx('alerts-empty.json'), exemplars: fx('exemplars.json'), inFlight: 0, maxInFlight: 0, ranges: [], down: false, skew: 0 };
  const value = (name, t) => ({ latency_p50_ms: 15 + (t % 7), throughput_rps: 30, error_ratio: 0.001, saturation_ratio: 0.2, node_up: 1, node_load_ratio: 0.3, node_latency_p50_ms: 16 })[name];
  state.fetch = vi.fn(async (url) => {
    if (state.down) throw new TypeError('fetch failed');
    const { path, q } = params(url);
    if (path === 'series') return ok(fx('series-node_up.json'));
    if (path.startsWith('label/')) return ok(fx(`labels-${path.split('/')[1]}.json`));
    if (path === 'alerts') return ok(state.alerts);
    if (path === 'query_exemplars') return ok(state.exemplars);
    if (path === 'query') {
      if (q.query.startsWith('histogram_quantile')) return ok(fx('endpoint-p95-4h.json'));
      if (q.query.startsWith('avg_over_time(mars:stage')) return ok(fx('stage-mean-4h.json'));
      if (q.query.includes('mars_stage_info')) return ok(state.stageInfo ?? fx('stage-info.json'));
      // Prometheus's clock runs `skew` seconds ahead of the browser's
      const serverNow = Date.now() / 1000 + state.skew;
      if (q.query === 'time()') return ok(success({ resultType: 'scalar', result: [serverNow, String(serverNow)] }));
      // the live answer, moved to the time asked for
      const body = structuredClone(state.live);
      for (const r of body.data.result) r.value[0] = q.time ? +q.time : serverNow;
      return ok(body);
    }
    if (path === 'query_range') {
      const start = +q.start, end = +q.end, step = +q.step;
      if ((end - start) / step + 1 > MAX_POINTS) return ok(fx('range-too-many-points.json'));
      state.ranges.push([start, end, step]);
      state.inFlight++;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await new Promise((r) => setTimeout(r, 5));
      state.inFlight--;
      const names = q.query.includes('node_') ? ['node_up', 'node_load_ratio', 'node_latency_p50_ms'] : ['latency_p50_ms', 'throughput_rps', 'error_ratio', 'saturation_ratio'];
      const result = names.map((n) => {
        const values = [];
        for (let t = start; t <= end; t += step) if (t % 100 !== 0) values.push([t, String(value(n, t))]);
        const metric = { __name__: `mars:${n}`, station: 'api', ...(n.startsWith('node_') ? { instance: 'demo-api:8000' } : {}) };
        return { metric, values };
      });
      return ok(success({ resultType: 'matrix', result }));
    }
    throw new Error(`unexpected ${url}`);
  });
  return state;
}

const def = (extra = {}) => ({ id: 'api', name: 'API-01', source: { kind: 'prometheus', station: 'api' }, ...extra });

describe('prometheus client', () => {
  it('chunks a range under the point cap without overlap', () => {
    const c = chunks(1000, 1000 + 14399, 1, 3601);
    expect(c).toEqual([[1000, 4600], [4601, 8201], [8202, 11802], [11803, 15399]]);
    for (const [a, b] of chunks(0, 4 * 3600, 1)) expect(b - a + 1).toBeLessThanOrEqual(MAX_POINTS);
    expect(chunks(0, 600, 60)).toEqual([[0, 600]]);
  });

  it('runs tasks with a concurrency limit, results in order', async () => {
    let now = 0, max = 0;
    const task = (v) => async () => {
      max = Math.max(max, ++now);
      await new Promise((r) => setTimeout(r, 1));
      now--;
      return v;
    };
    const progress = [];
    expect(await pool([1, 2, 3, 4, 5, 6].map(task), 4, (n) => progress.push(n))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(max).toBe(4);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('throws Prometheus errors and timeouts', async () => {
    const client = createPromClient({ fetch: () => ok(fx('range-too-many-points.json')) });
    await expect(client.queryRange('up', 0, 14400, 1)).rejects.toThrow(/11,000 points/);
    vi.useFakeTimers();
    const slow = createPromClient({ fetch: (u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))), timeout: 50 });
    const p = slow.query('up');
    const check = expect(p).rejects.toThrow(/timed out after 50 ms/);
    await vi.advanceTimersByTimeAsync(60);
    await check;
    vi.useRealTimers();
  });

  it('builds URLs under the proxy base and escapes station labels', async () => {
    const fetch = vi.fn(() => ok(success([])));
    const client = createPromClient({ url: '/prom/', fetch });
    await client.labelValues('route', 'mars:endpoint_rps{station="a\\"b"}', 1, 2);
    const { path, q } = params(fetch.mock.calls[0][0]);
    expect(fetch.mock.calls[0][0]).toMatch(/^\/prom\/api\/v1\/label\/route\/values\?/);
    expect(path).toBe('label/route/values');
    expect(q['match[]']).toBe('mars:endpoint_rps{station="a\\"b"}');
  });
});

describe('discovery', () => {
  let prom;
  beforeEach(() => {
    prom = fakeProm();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('finds nodes, routes with derived SLOs, ordered stages and their shares', async () => {
    const found = await discover(createPromClient({ fetch: prom.fetch }), 'api', {}, LIVE_T);
    expect(found.nodes).toEqual(['demo-api:8000']);
    expect(found.endpoints.map((e) => e.route)).toEqual(['/v1/embed', '/v1/items/{item_id}', '/v1/models', '/v1/predict', '/v1/rank']);
    const predict = found.endpoints.find((e) => e.route === '/v1/predict');
    // 2 × the observed 4 h P95 (30.53 ms), rounded
    expect(predict).toMatchObject({ slo: 61, source: 'auto' });
    expect(predict.observed).toBeCloseTo(30.53, 1);
    expect(found.stages).toEqual(['ingress', 'auth', 'embed', 'infer', 'rank', 'egress']);
    expect(found.stageShare.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    // infer is the biggest stage of the demo (10.6 of 30.3 ms)
    expect(found.stageShare[3]).toBeCloseTo(10.58 / 30.29, 2);
    expect(found.regions).toEqual([]);
  });

  it('applies the document overrides', async () => {
    const overrides = { endpoints: [{ route: '/v1/predict', slo: 40 }, { route: '/v1/new', slo: 9 }], stages: ['egress', 'nope'] };
    const found = await discover(createPromClient({ fetch: prom.fetch }), 'api', overrides, LIVE_T);
    expect(found.endpoints.slice(0, 2)).toEqual([
      { route: '/v1/predict', slo: 40, observed: expect.any(Number), source: 'doc' },
      { route: '/v1/new', slo: 9, observed: null, source: 'doc' },
    ]);
    expect(found.endpoints).toHaveLength(6);
    expect(found.stages[0]).toBe('egress');
    expect(orderStages(['b', 'a', 'send', 'parse'])).toEqual(['parse', 'a', 'b', 'send']);
    expect(defaultSlo(0.2)).toBe(1);
    // the station's thresh.warn is the floor: a 5 ms route doesn't get a 10 ms SLO
    expect(defaultSlo(5, 25)).toBe(25);
    expect(defaultSlo(20, 25)).toBe(40);
  });

  it('orders stages by the probe, after the override and before the names', async () => {
    // a probe that declared rank before embed, and never saw egress
    const info = (pairs) => success({ resultType: 'vector', result: pairs.map(([stage, order]) => ({ metric: { stage, order: String(order) }, value: [LIVE_T, '1'] })) });
    prom.stageInfo = info([['ingress', 0], ['auth', 1], ['rank', 2], ['embed', 3], ['infer', 4]]);
    const client = createPromClient({ fetch: prom.fetch });
    expect((await discover(client, 'api', {}, LIVE_T)).stages).toEqual(['ingress', 'auth', 'rank', 'embed', 'infer', 'egress']);
    expect((await discover(client, 'api', { stages: ['infer'] }, LIVE_T)).stages).toEqual(['infer', 'ingress', 'auth', 'rank', 'embed', 'egress']);
    // an older probe exports nothing: the name heuristic as before
    prom.stageInfo = info([]);
    expect((await discover(client, 'api', {}, LIVE_T)).stages).toEqual(['ingress', 'auth', 'embed', 'infer', 'rank', 'egress']);
    // two instances that saw a stage at different positions: the earliest wins
    expect(probeOrder(info([['a', 3], ['a', 1], ['b', 2]]).data.result)).toEqual(new Map([['a', 1], ['b', 2]]));
  });

  it('joins region codes against the table and skips unknown ones once', async () => {
    const fetch = (url) => (params(url).path === 'label/region/values' ? ok(success(['fra', 'XYZ', 'IAD'])) : prom.fetch(url));
    const client = createPromClient({ fetch });
    const found = await discover(client, 'api', {}, LIVE_T);
    expect(found.regions.map((r) => r.code)).toEqual(['FRA', 'IAD']);
    expect(found.regions[0]).toMatchObject({ name: 'FRANKFURT', lat: 50, lon: 8.6 });
    await discover(client, 'api', {}, LIVE_T);
    expect(console.warn.mock.calls.filter((c) => c[0].includes('"XYZ"'))).toHaveLength(1);
  });
});

describe('prometheus source', () => {
  const profile = createProfile({ id: 'api', name: 'API-01', stages: [], stageShare: [], endpoints: [], regions: [] });
  const storeFor = (source, caps = { nodes: 2, endpoints: 6, stages: 6, regions: 2 }) =>
    createTelemetry({ profile, hostCount: 0, now: source.now, kind: source.kind, getSpeed: () => 1, caps, nodeNames: [] });

  it('turns a recorded range into tape samples, keeping gaps and the per-node window', async () => {
    vi.useFakeTimers({ now: (LIVE_T + 1) * 1000 - 1 });
    const fetch = (url) => ok(fx(params(url).q.query.includes('node_') ? 'range-nodes.json' : 'range-station.json'));
    const source = createPrometheusSource({ client: createPromClient({ fetch }), station: 'api', profile });
    const store = storeFor(source);
    const progress = [];
    const samples = await source.backfill(LIVE_T - 120, (p) => progress.push(p), store);
    vi.useRealTimers();
    // 117 seconds have both latency and throughput in the recording; 3 are gaps
    expect(samples).toHaveLength(117);
    const times = samples.map((x) => x.t);
    expect(new Set(times).size).toBe(117);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(LIVE_T - 120);
    // nodes only for the last 60 s recorded
    const withNodes = samples.filter((x) => x.hostStates);
    expect(withNodes.length).toBeGreaterThan(50);
    expect(withNodes.length).toBeLessThan(65);
    expect(withNodes[0].hostStates[0]).toBe(0);
    expect(store.nodeNames).toEqual(['demo-api:8000']);
    expect(samples[0]).toMatchObject({ endpoints: null, regions: null, stageLatency: null });
    expect(progress.at(-1)).toBeCloseTo(1, 6);
  });

  it('reads the almanac history minute by minute', async () => {
    const fetch = vi.fn(() => ok(fx('range-almanac-latency.json')));
    const source = createPrometheusSource({ client: createPromClient({ fetch }), station: 'api', profile });
    const rec = fx('range-almanac-latency.json').data.result[0].values;
    const toMin = rec.at(-1)[0] / 60;
    const out = await source.history(toMin - 30, toMin);
    expect(out).toHaveLength(rec.length);
    // the value at the end of a minute is that minute's mean
    expect(out[0]).toMatchObject({ mi: rec[0][0] / 60 - 1, latency: +rec[0][1] });
    // 4 signals, one range each (30 min fits one chunk)
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(params(fetch.mock.calls[0][0]).q).toMatchObject({ step: '60' });
  });
});

describe('prometheus station', () => {
  let prom, station;
  beforeEach(() => {
    vi.useFakeTimers({ now: LIVE_T * 1000 + 300 });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    prom = fakeProm();
  });
  afterEach(() => {
    station?.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function boot(extra) {
    station = createStation(def(extra), { prometheus: '/prom', fetch: prom.fetch });
    const started = station.start();
    expect(station.getStatus().phase).toBe('load');
    await vi.advanceTimersByTimeAsync(100);
    await started;
    return station;
  }

  it('discovers, fills a 4 h tape in chunks, then goes live', async () => {
    await boot();
    expect(station.getStatus()).toMatchObject({ phase: 'live', progress: 1, generation: 1 });
    const { store } = station;
    expect(store.hostCount).toBe(1);
    expect(store.stages).toEqual(['ingress', 'auth', 'embed', 'infer', 'rank', 'egress']);
    expect(store.endpoints.map((e) => e.route)).toContain('/v1/predict');
    // station-level backfill: 4 h (the tape span) at 1 s, cut into 1 h chunks, at most 4 at once
    const sys = prom.ranges.filter(([a, b]) => b - a > 600);
    expect(sys.length).toBeGreaterThanOrEqual(4);
    expect(prom.maxInFlight).toBe(4);
    for (const [a, b, step] of prom.ranges) expect((b - a) / step + 1).toBeLessThanOrEqual(3601);
    // the tape is full except the generated gaps (every 100th second)
    const row = store.rows[1];
    const filled = Array.from({ length: 600 }, (_, i) => row[i * 2]).filter((v) => v >= 0).length;
    expect(filled).toBe(594);
    expect(store.latencyAt(LIVE_T - 1000)).toBeGreaterThan(0);
  });

  it('maps a live answer to a frame', async () => {
    await boot();
    await vi.advanceTimersByTimeAsync(1100);
    const { store } = station;
    expect(store.latest.t).toBe(LIVE_T + 1);
    expect(store.latest.latency).toBeCloseTo(18.02, 2);
    expect(store.hostStates[0]).toBe(0);
    const predict = store.endpoints.find((e) => e.route === '/v1/predict');
    expect(predict.live).toBe(true);
    expect(predict.auto).toBe(true);
    expect(store.stageLatency).toHaveLength(6);
    expect(store.stale).toBe(false);
    expect(store.status).toBe('NOMINAL');
  });

  it('marks a node offline at once, and the station STALE after 10 s without data', async () => {
    await boot();
    await vi.advanceTimersByTimeAsync(1100);
    const t = store().latest.t;
    // the demo target is down: node_up = 0, and the rate rules still yield the
    // last window's values for 10 s, which must not count as data
    const leftovers = fx('live.json').data.result.filter((r) => r.metric.__name__ !== 'mars:node_up');
    prom.live = success({ resultType: 'vector', result: [{ metric: { __name__: 'mars:node_up', instance: 'demo-api:8000', station: 'api' }, value: [0, '0'] }, ...leftovers] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(store().hostStates[0]).toBe(3);
    expect(store().latest.t).toBe(t); // nothing pushed: a gap on the tape
    expect(store().stale).toBe(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(store().stale).toBe(true);
    expect(store().status).toBe('STALE');
    expect(store().events.some((e) => e.text.startsWith('SOURCE STALE'))).toBe(true);
    // back: recovers without a reload
    prom.live = fx('live.json');
    await vi.advanceTimersByTimeAsync(1000);
    expect(store().stale).toBe(false);
    expect(store().hostStates[0]).toBe(0);
    expect(store().latest.t).toBeGreaterThan(t);
  });

  it("follows Prometheus's clock when the browser's is off", async () => {
    // the browser runs 24 min ahead of Prometheus (seen with a Podman VM after sleep)
    prom.skew = -1440;
    await boot();
    await vi.advanceTimersByTimeAsync(1100);
    const server = Date.now() / 1000 - 1440;
    expect(store().latest.t).toBeGreaterThan(server - 2);
    expect(store().latest.t).toBeLessThanOrEqual(server);
    expect(store().now()).toBeCloseTo(server, 0);
    // the tape runs up to Prometheus's now, not into its future
    const sys = prom.ranges.filter(([a, b, step]) => step === 1 && b - a > 600);
    expect(Math.max(...sys.map(([, b]) => b))).toBeLessThanOrEqual(server);
    await vi.advanceTimersByTimeAsync(12000);
    expect(store().stale).toBe(false);
    expect(store().events.some((e) => e.text === 'CLOCK SKEW -1440S PROMETHEUS')).toBe(true);
  });

  it('goes STALE when Prometheus itself is gone, and keeps running', async () => {
    await boot();
    await vi.advanceTimersByTimeAsync(1100);
    prom.down = true;
    await vi.advanceTimersByTimeAsync(12000);
    expect(store().status).toBe('STALE');
    prom.down = false;
    await vi.advanceTimersByTimeAsync(1100);
    expect(store().status).not.toBe('STALE');
  });

  it('shows NO CONTACT and retries while discovery fails', async () => {
    prom.down = true;
    station = createStation(def(), { prometheus: '/prom', fetch: prom.fetch });
    station.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(station.getStatus()).toMatchObject({ phase: 'load', problem: 'NO CONTACT' });
    expect(station.store.status).toBe('STALE');
    prom.down = false;
    await vi.advanceTimersByTimeAsync(2500);
    expect(station.getStatus()).toMatchObject({ phase: 'live', problem: null });
  });

  it('samples requests from exemplars and lights the lamp for firing external alerts', async () => {
    prom.alerts = fx('alerts-firing.json');
    await boot();
    await vi.advanceTimersByTimeAsync(5100);
    const req = store().requests.at(-1);
    expect(req).toMatchObject({ status: 200, node: 0 });
    expect(req.route).toMatch(/^\/v1\//);
    expect(req.ms).toBeGreaterThan(0);
    // only the firing alert of this station
    expect(store().external).toEqual([{ name: 'HighLatency', severity: 'warning' }]);
    expect(store().state).toBe('NOMINAL');
    expect(store().status).toBe('DEGRADED');
  });

  it('puts a new route in a spare slot, and rebuilds when the slots run out', async () => {
    await boot();
    const ep = (route) => ({ metric: { __name__: 'mars:endpoint_p95_ms', route, station: 'api' }, value: [0, '12'] });
    const base = fx('live.json');
    prom.live = success({ resultType: 'vector', result: [...base.data.result, ep('/v1/fresh')] });
    await vi.advanceTimersByTimeAsync(1100);
    const fresh = store().endpoints.find((e) => e.route === '/v1/fresh');
    expect(fresh).toMatchObject({ slo: 25, auto: true }); // 2 × 12 ms, floored at thresh.warn
    expect(store().events.some((e) => e.text === 'NEW ROUTE /v1/fresh')).toBe(true);
    expect(station.getStatus().generation).toBe(1);
    // 5 discovered + 8 spare: the 9th new route finds no slot
    const many = Array.from({ length: 9 }, (_, i) => ep(`/v1/r${i}`));
    prom.live = success({ resultType: 'vector', result: [...base.data.result, ...many] });
    const before = station.store;
    await vi.advanceTimersByTimeAsync(1000);
    expect(before.overflow).toBe(true);
    expect(before.events.some((e) => e.text.startsWith('SLOTS FULL ENDPOINTS'))).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    // rediscovered with twice the spare slots, tape refilled
    expect(station.getStatus()).toMatchObject({ phase: 'live', generation: 2 });
    expect(station.store).not.toBe(before);
    expect(station.store.rebuilds).toBe(1);
    expect(station.store.rowStart).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(station.store.endpoints.map((e) => e.route)).toContain('/v1/r8');
    expect(station.store.overflow).toBe(false);
  });

  const store = () => station.store;
});

describe('async source contract', () => {
  it('the simulator resolves its backfill', async () => {
    const source = createSimulatedSource({ profile: createProfile(), hostCount: 4, seed: 1 });
    const p = source.backfill(Date.now() / 1000 - 10);
    expect(p).toBeInstanceOf(Promise);
    expect((await p).length).toBeGreaterThanOrEqual(9);
  });
});

describe('measured endpoints', () => {
  // one auto endpoint with a tight SLO, judged from samples at `rps`
  function run(rps, p95s, caps = { nodes: 1, endpoints: 2, stages: 0, regions: 0 }) {
    const profile = createProfile({ id: 'x', name: 'X', endpoints: [['/v1/models', 0, 10, true]] });
    let t = 1793977200;
    const store = createTelemetry({ profile, hostCount: 1, now: () => t, kind: 'LIVE', getSpeed: () => 1, caps });
    for (const p95 of p95s) {
      t++;
      store.ingest([{ t, latency: 15, throughput: 30, errorRate: 0, saturation: 0.2, hostStates: Uint8Array.of(0), hostLoads: Float32Array.of(0.2), hostLatency: Float32Array.of(15), stageLatency: null, requests: null, endpoints: [{ rps, p95, err: 0 }], regions: null }]);
    }
    return store;
  }
  const swinging = Array.from({ length: 120 }, (_, i) => (i % 20 < 10 ? 4 : 14));

  it('holds the state of a route with too little traffic, and logs nothing', () => {
    const store = run(2, swinging);
    const ep = store.endpoints[0];
    expect(ep.low).toBe(true);
    expect(ep.state).toBe(0);
    expect(store.events.filter((e) => e.text.includes('/v1/models'))).toHaveLength(0);
  });

  it('judges it once there is traffic', () => {
    const ep = run(20, swinging).endpoints[0];
    expect(ep.low).toBe(false);
    expect(ep.p95).toBeGreaterThan(4);
  });

  it('leaves simulated endpoints alone', () => {
    expect(run(2, swinging, {}).endpoints[0].low).toBe(false);
  });
});

describe('signal analyser on a short history', () => {
  it('finds a 5-minute rhythm in 40 minutes of data, without the 4 h reference', async () => {
    const { createSignal } = await import('../src/data/signal.js');
    vi.useFakeTimers({ now: 1793977200 * 1000 });
    const profile = createProfile({ id: 'x', name: 'X' });
    const now = () => Date.now() / 1000;
    const store = createTelemetry({ profile, hostCount: 1, now, kind: 'LIVE', getSpeed: () => 1 });
    // 40 min of a station with a batch job every 300 s (40 s bumps of +6 ms), nothing before;
    // detection is reliable from about 35 min (8 cycles at the 20-min high-pass)
    const end = Math.floor(now());
    const samples = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let t = end - 2400; t < end; t++) {
      const bump = t % 300 < 40 ? 6 : 0;
      samples.push({ t, latency: 15 + bump + (rnd() - 0.5) * 2, throughput: 30, errorRate: 0, saturation: 0.2, hostStates: Uint8Array.of(0), hostLoads: Float32Array.of(0.2), hostLatency: Float32Array.of(15), stageLatency: null, requests: null, endpoints: null, regions: null });
    }
    store.ingest(samples);
    const signal = createSignal(store, profile);
    signal.update(0);
    vi.useRealTimers();
    expect(signal.spec.ref).toBe(false);
    expect(signal.spec.searched).toBe(true);
    expect(signal.spec.peaks.map((p) => Math.round(p.period))).toContain(300);
  });
});
