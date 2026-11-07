import { region } from '../regions.js';
import { sel } from './client.js';

// What a Prometheus station consists of: its nodes, routes, pipeline stages and
// client regions, read from the label values of the `mars:*` series
// (ADR-0003). It runs before the station's telemetry store exists, because the
// store sizes its tables from it. Labels that appear later fill spare slots in
// the store (ADR-0007).
//
// overrides (from the document's station entry, all optional):
//   endpoints: [{ route, slo }]   P95 SLO in ms per route
//   stages:    ['ingress', ...]   pipeline order

const HOUR = 3600;
const SPAN = 4 * HOUR;

// Without an override, an endpoint's P95 SLO is twice what it was observed to
// be over the last 4 hours: wide enough that normal traffic sits at about half
// of it on the radar, tight enough that a real slowdown closes in. `floor` is
// the station's thresh.warn: a small, fast route would otherwise get an SLO of
// a few ms, which the P95 of a handful of requests crosses all the time.
export const SLO_FACTOR = 2;
export const defaultSlo = (p95, floor = 1) => Math.max(1, floor, Math.round(SLO_FACTOR * p95));

// Without an override, stages are ordered by what their names usually mean
// (the way in first, the way out last), then alphabetically. The metrics carry
// no order of their own: exemplars are per request, not per stage.
const FIRST = /^(ingress|gateway|edge|recv|receive|accept|parse|decode|auth)/i;
const LAST = /^(egress|respond|response|send|encode|serialize|render|write)/i;
const rank = (s) => (FIRST.test(s) ? (/^auth/i.test(s) ? 1 : 0) : LAST.test(s) ? 3 : 2);
export function orderStages(names, override = []) {
  const known = override.filter((s) => names.includes(s));
  const rest = names.filter((s) => !known.includes(s)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return [...known, ...rest];
}

// Unknown region codes are logged once per session, not on every rediscovery.
const warned = new Set();

// `now` defaults to Prometheus's own clock, which may differ from the browser's.
export async function discover(client, station, { endpoints: epOverride = [], stages: stOverride = [] } = {}, now) {
  const end = Math.floor(now ?? (await client.time()));
  const s = sel(station);
  const [series, routes, stageNames, regionCodes, p95s, stageMeans] = await Promise.all([
    client.series(`mars:node_up${s}`, end - HOUR, end),
    client.labelValues('route', `mars:endpoint_rps${s}`, end - SPAN, end),
    client.labelValues('stage', `mars:stage_mean_ms${s}`, end - SPAN, end),
    client.labelValues('region', `mars:region_rps${s}`, end - SPAN, end),
    // the observed 4-hour P95 of each route, from the raw histogram
    client.query(`histogram_quantile(0.95, sum by (route, le) (increase(mars_http_request_duration_seconds_bucket${s}[4h]))) * 1000`, end),
    client.query(`avg_over_time(mars:stage_mean_ms${s}[4h])`, end),
  ]);

  const nodes = [...new Set(series.map((m) => m.instance).filter(Boolean))].sort();

  const p95Of = new Map(p95s.map((r) => [r.metric.route, +r.value[1]]));
  const sloOf = new Map(epOverride.map((e) => [e.route, e.slo]));
  // overridden routes keep their document order and are listed even before they have traffic
  const routeList = [...new Set([...epOverride.map((e) => e.route), ...[...routes].sort()])];
  const endpoints = routeList.map((route) => {
    if (sloOf.has(route)) return { route, slo: sloOf.get(route), observed: p95Of.get(route) ?? null, source: 'doc' };
    const p95 = p95Of.get(route);
    return Number.isFinite(p95) && p95 > 0
      ? { route, slo: defaultSlo(p95), observed: p95, source: 'auto' }
      : { route, slo: null, observed: null, source: 'auto' };
  });

  const stages = orderStages(stageNames, stOverride);
  const meanOf = new Map(stageMeans.map((r) => [r.metric.stage, +r.value[1]]));
  const means = stages.map((st) => (Number.isFinite(meanOf.get(st)) ? meanOf.get(st) : 0));
  const total = means.reduce((a, b) => a + b, 0);
  const stageShare = means.map((m) => (total > 0 ? m / total : 1 / stages.length));

  const regions = [];
  for (const code of [...regionCodes].sort((a, b) => a.toUpperCase().localeCompare(b.toUpperCase()))) {
    const r = region(code);
    if (r) regions.push(r);
    else if (!warned.has(code)) {
      warned.add(code);
      console.warn(`[MARS] station "${station}": unknown region code "${code}" skipped (add it to data/regions.js)`);
    }
  }

  return { nodes, endpoints, stages, stageShare, regions };
}
