// A small client for the Prometheus HTTP API (ADR-0002). The browser talks to
// Prometheus through the same-origin proxy at the document's `prometheus.url`
// (`/prom` by default), so there is no CORS and no backend of our own.
//
// Every call resolves to the response's `data` or throws an Error, including
// on a timeout, so callers only need one catch.

// Prometheus refuses a range query with more than 11,000 points per series.
export const MAX_POINTS = 11000;

export function createPromClient({ url = '/prom', fetch: get = (...a) => globalThis.fetch(...a), timeout = 8000 } = {}) {
  const base = url.replace(/\/+$/, '');

  async function call(path, params, ms = timeout) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      for (const x of Array.isArray(v) ? v : [v]) if (x != null) qs.append(k, String(x));
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await get(`${base}/api/v1/${path}?${qs}`, { signal: ctrl.signal, cache: 'no-store' });
      let body = null;
      try {
        body = await r.json();
      } catch {
        // a proxy error page, not Prometheus
      }
      if (!body || body.status !== 'success') throw new Error(`prometheus ${path}: ${body?.error ?? `HTTP ${r.status}`}`);
      return body.data;
    } catch (e) {
      throw ctrl.signal.aborted ? new Error(`prometheus ${path}: timed out after ${ms} ms`) : e;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    url: base,
    // instant vector: [{ metric, value: [t, "v"] }]
    query: (query, time) => call('query', { query, time }).then((d) => d.result),
    // matrix: [{ metric, values: [[t, "v"], ...] }]
    queryRange: (query, start, end, step, ms) => call('query_range', { query, start, end, step }, ms).then((d) => d.result),
    series: (match, start, end) => call('series', { 'match[]': match, start, end }),
    labelValues: (name, match, start, end) => call(`label/${encodeURIComponent(name)}/values`, { 'match[]': match, start, end }),
    // [{ seriesLabels, exemplars: [{ labels, value, timestamp }] }]
    exemplars: (query, start, end) => call('query_exemplars', { query, start, end }),
    // [{ labels, annotations, state, activeAt, value }]
    alerts: () => call('alerts', {}).then((d) => d.alerts),
    // { version, revision, ... }: also the stations plate's connection check
    buildinfo: () => call('status/buildinfo', {}),
    // Prometheus's own clock, in seconds
    time: () => call('query', { query: 'time()' }).then((d) => +d.result[0]),
  };
}

// Splits [start, end] (inclusive, seconds) into ranges of at most MAX_POINTS
// points at `step`. Chunks share no timestamp, so their results just concatenate.
export function chunks(start, end, step, max = MAX_POINTS) {
  const out = [];
  const span = (max - 1) * step;
  for (let s = start; s <= end; s += span + step) out.push([s, Math.min(end, s + span)]);
  return out;
}

// Runs the task functions with at most `limit` in flight, results in order.
// `done(n)` is called after each one, for a progress bar.
export async function pool(tasks, limit = 4, done = () => {}) {
  const out = new Array(tasks.length);
  let next = 0, finished = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
      done(++finished);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

// A selector for one station: `{station="api"}` plus extra matchers. Label
// values are escaped, since they come from the document.
export const sel = (station, extra = '') => `{station=${JSON.stringify(station)}${extra ? `,${extra}` : ''}}`;
