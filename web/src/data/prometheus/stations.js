// What the stations plate (step 09) asks Prometheus: is it there, which
// stations does it know, and how is each of them doing right now. Discovery
// of a single station's tables stays in discover.js.

// Stations whose probe reported in the last hour (mars_info is set by every
// mars-probe, ADR-0003), sorted.
export async function stationValues(client, now = Date.now() / 1000) {
  const t = Math.floor(now);
  const values = await client.labelValues('station', 'mars_info', t - 3600, t);
  return [...values].sort();
}

// Live P50 (ms) and RPS of every station, in one query:
// Map(station → { p50, rps }), either one null while it has no value.
export async function readouts(client) {
  const result = await client.query('{__name__=~"mars:latency_p50_ms|mars:throughput_rps"}');
  const out = new Map();
  for (const { metric, value } of result) {
    const r = out.get(metric.station) ?? { p50: null, rps: null };
    const v = +value[1];
    if (Number.isFinite(v)) r[metric.__name__ === 'mars:latency_p50_ms' ? 'p50' : 'rps'] = v;
    out.set(metric.station, r);
  }
  return out;
}
