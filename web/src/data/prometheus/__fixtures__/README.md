Prometheus API responses for the unit tests in `web/test/prometheus.test.js`. All except
`alerts-firing.json` were recorded from the step 03 demo stack (`station="api"`, Prometheus
v3.16.0, about 4 h after start) with `curl` against `localhost:9090/api/v1/...`; the queries are
the ones `discover.js` and `source.js` send. `alerts-firing.json` is hand-written in the same
format, because the demo stack has no alerting rules.
