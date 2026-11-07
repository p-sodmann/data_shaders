Prometheus API responses for the unit tests in `web/test/prometheus.test.js`. All except
`alerts-firing.json` were recorded from the step 03 demo stack (`station="api"`, Prometheus
v3.16.0, about 4 h after start) with `curl` against `localhost:9090/api/v1/...`; the queries are
the ones `discover.js` and `source.js` send. `alerts-firing.json` is hand-written in the same
format, because the demo stack has no alerting rules.

Added in step 09, recorded from the same stack on 2026-11-07 (Prometheus v3.16.0, after the demo
stations ran the step 09 probe): `stage-info.json` (the `mars_stage_info` query in
`discover.js`), `labels-station.json`, `readouts.json` and `buildinfo.json` (what the stations
plate asks, `stations.js`). The smoke test serves all of these for its `/prom` routes.
