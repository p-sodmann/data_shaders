# Open questions

Add questions as you find them, under a heading for their area. Resolve them by moving them
to **Resolved** with the answer, the date and the step or ADR that settled them.

## Data and Prometheus

- **JSON polling source in the config document.** `?source=<url>` still works, and since step 04
  it becomes a station with `source: { kind: 'poll', url, hosts }`. ADR-0005 only lists `sim`
  and `prometheus` source kinds. Should the zod schema (step 06) accept `poll`, or should the
  polling source be retired once Prometheus works (step 07)?
- **One Prometheus for all servers?** The plan assumes MARS reads from a single
  Prometheus-compatible URL. Several backends would need a `prometheus` field per station.
- **Scrape interval 1 s or 5 s?** 1 s keeps the Signal page (spectrum, rhythms) meaningful for
  short periods, at about 5× the storage. Revisit once real series counts are known.
- **Routes, stages or regions that appear at runtime.** The telemetry store allocates its arrays
  per endpoint, stage, region and node when it is created. Options: rediscover every N minutes
  and rebuild the station (which loses short-term state), or reserve spare slots. Step 07 must
  pick one and record it.
- **Node semantics for a single uvicorn process.** One station has one node, so the nodes lamp
  grid and the fleet strands are nearly empty. Should those instruments switch to "one lamp per
  station" when a station has fewer than N nodes, or is that only the job of the station board
  (step 10)?
- **Almanac source.** Page 5 keeps 30 days in browser IndexedDB, so a new display starts empty
  (for real data). Should it backfill from Prometheus (`query_range` at `step=60s` over 30 days)?
- **Alert rules.** Keep MARS's own caution and warning rules, or read Prometheus/Alertmanager
  alerts? Possibly both.
- **Time base.** `S` (×10, ×60) only makes sense for `sim`. Should it be disabled or hidden for
  Prometheus stations?

## Security and deployment

- **Exposure.** Prometheus has no auth. Is MARS LAN-only, or does Caddy need basic auth or
  forward auth?
- **Lifecycle API.** Step 03 runs Prometheus with `--web.enable-lifecycle`. Caddy refuses
  `/prom/-/reload` and `/-/quit` with 403, and :9090 is loopback-only, but the rest of the
  query API is open on :8080. Revisit together with auth.
- **Demo targets without the demo.** `deploy/prometheus/targets/demo.yml` is always mounted, so
  a stack without `--profile demo` shows two down targets until the file is deleted. Move demo
  targets into a profile-only mount, or accept it?
- **Remote servers.** Does Prometheus scrape the servers over the network (firewall, TLS), or
  should each server push via remote-write or an agent?

## UI

- **Pages per server or mixed pages?** The config document allows both. Should we ship a
  preset generator ("make the 5 standard pages for station X")?
- **Aspect ratio.** One layout per device, or responsive variants per screen size?
- **Config persistence across displays.** localStorage is per browser. Should Caddy accept a
  `PUT /config/mars.json` so several displays share one config?

## Tooling

- **CI.** Nothing runs `npm run smoke` automatically. It needs Playwright's Chromium
  (`npx playwright install --with-deps chromium` on Linux). Should step 12 add a GitHub Actions
  workflow?

## Demo

- **Podman / compose.** The dev machine runs Podman, not Docker Desktop, and has no compose
  provider. Step 03 checked the stack with plain `podman run` (same images, mounts, flags,
  healthchecks) but never ran `deploy/compose.yaml` itself. Someone needs to run
  `docker compose -f deploy/compose.yaml --profile demo up -d --build` once (Docker, or Podman
  with `docker-compose`/`podman-compose` installed) and close step 03's last criterion.
- **Daily phase in UTC.** The loadgen's daily sine uses UTC wall-clock time (low at 03:00, high
  at 15:00 UTC), while the simulator uses the browser's local time. Should the loadgen take a
  `LOADGEN_TZ` so a demo peaks in the viewer's afternoon?

## Probe

- **Licence.** No licence is chosen, so `probe/pyproject.toml` has no `license` field. It's
  needed before publishing (step 12).
- **Test client dependency.** Starlette 1.10 deprecates `httpx` in `starlette.testclient` in
  favour of `httpx2`. Switch the `dev` extra when the minimum Starlette allows it (step 01).
- **Package name** on PyPI: `mars-probe` might be taken. Check this before step 12.
- **Other frameworks.** Plain ASGI middleware works for Starlette and FastAPI. Is Flask/WSGI
  wanted?

## Resolved

- **Recording-rule edge cases:** no traffic → latency and ratio rules absent, throughput 0;
  `node_up` joins with `mars_info` as the many side so a version change doesn't break it;
  region rules leave out `region="unknown"`. 2026-11-06, step 03.

- **Repo layout:** monorepo ([ADR-0001](adr/0001-monorepo.md)), 2026-11-05.
- **Backend:** Prometheus ([ADR-0002](adr/0002-prometheus-backend.md)), 2026-11-05.
- **Run method:** Docker Compose ([ADR-0004](adr/0004-docker-compose.md)), 2026-11-05.
- **Server runtime:** plain single-process uvicorn, so no prometheus_client multiprocess mode is
  needed, 2026-11-05.
