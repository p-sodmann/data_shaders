# Step 14: Push with keys

Status: done
Depends on: 13
Read first: [ADR-0002](../adr/0002-prometheus-backend.md), [ADR-0009](../adr/0009-linux-hosts.md), [ADR-0010](../adr/0010-push-gateway.md)

## Goal

Clients push their metrics to MARS instead of Prometheus pulling them, with an API key made in
the web interface. Login to the web interface comes later.

## Decisions

- User, 2026-11-07: push from the clients, with keys spawned in the web interface.
- Made in this step (ADR-0010): a gateway of our own rather than remote write or the
  Pushgateway, so a client that stops reads as down within seconds; a key belongs to one
  station and sets it; both mars-agent and mars-probe push; pull keeps working next to it; the
  demo pushes.

## Acceptance criteria

- [x] A key made on the keys plate lets a client push; its station and node show up on the
      display, and the plate lists the client as live.
- [x] A client that stops reads `mars:node_up` 0 within seconds; a revoked key reads 0 at once
      and its agent logs a 401.
- [x] `/push` passes `MARS_BASIC_AUTH`; `/api/keys` doesn't.
- [x] Exemplars survive the gateway.
- [x] The demo stack works by push only.
- [x] `scripts/check.sh` passes.

## Handoff

### Built

- **[gateway/](../../gateway/README.md)** (`mars-gateway`, port 9111): [keys.py](../../gateway/src/mars_gateway/keys.py)
  (SHA-256 in `/data/keys.json`, `MARS_PUSH_KEYS`), [board.py](../../gateway/src/mars_gateway/board.py)
  (parse text or OpenMetrics, keep `mars_*`, set `station`/`instance`, drop timestamps, TTL 5 s,
  `mars_push_up`), [cli.py](../../gateway/src/mars_gateway/cli.py) (HTTP API). 11 tests.
- **Agent:** [push.py](../../agent/src/mars_agent/push.py), `MARS_PUSH_URL`/`MARS_PUSH_KEY`/
  `MARS_INSTANCE`, `--healthcheck`; compose reads `agent/.env` (gitignored). 3 new tests.
- **Probe:** [push.py](../../probe/src/mars_probe/push.py), `instrument(…, push_url, push_key,
  instance)` with env defaults, `Probe.push()`. 3 new tests.
- **Rules:** a second `mars:node_up` term for pushed nodes; promtool case *pushed nodes*.
- **Deploy:** gateway in both compose files (volume `gateway-data`), Prometheus job
  `mars-push`, Caddy routes `/push/*` and `/api/keys*`, `/push/*` left out of basic auth, Vite
  dev proxy; demo clients push; check.sh, build-images.sh and release.yml cover the gateway.
- **Web:** [keys.js](../../web/src/data/keys.js) (client, vitest),
  [KeysPlate.jsx](../../web/src/ui/service/KeysPlate.jsx) behind a **Keys** key on the service
  panel.
- **Docs:** ADR-0010, ADR-0002 note, the tutorial rewritten around keys, agent, probe, deploy,
  root and gateway READMEs, CHANGELOG, open questions.

### Surprises

- Re-exposing a classic-text push as OpenMetrics works through prometheus_client's parsers and
  `Metric` objects with no hand-written encoder; exemplars round-trip.
- `mars:node_up`'s join onto the gateway's `up` needs `max by (job) (up)`: a plain
  `on (job) group_left up` would be many-to-many wherever a job has several targets.

### Verification

- Demo stack (Podman): every client pushes through Caddy; `mars:node_up`, throughput, latency
  and 27 exemplar series for `api` arrive; Prometheus has one target, `mars-push`.
- Key made over `/api/keys`, local agent pushes → node 1; agent stopped → 0 after the TTL;
  restarted → 1; key revoked while pushing → 0 at once, agent logs the 401.
- `MARS_BASIC_AUTH` on: `/api/keys` 401 without the password, 200 with; `/push` goes to the
  gateway (401 bad key, 204 good key).
- Chromium against the stack: the plate lists keys and clients, makes a key (token shown once
  with the set-up lines), revokes with two presses, swaps with the stations plate; no console
  errors.
