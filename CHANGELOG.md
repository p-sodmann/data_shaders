# Changelog

One version for the whole repo: the `mars-probe` package, the `mars-web` and `mars-demo`
images and `deploy/compose.prod.yaml` share it. It is set in one place,
[probe/src/mars_probe/_version.py](probe/src/mars_probe/_version.py); `scripts/check.sh` fails
if the prod compose tag or this file don't follow it. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/). Until 1.0, a minor version may change the metric contract
([ADR-0003](docs/adr/0003-metric-contract.md)) or the config document
([ADR-0005](docs/adr/0005-config-document.md)), and this file says so when it does.

## [Unreleased]

### Added

- **Push with keys** ([ADR-0010](docs/adr/0010-push-gateway.md)): `mars-gateway`
  ([gateway/](gateway/README.md), image `mars-gateway`) takes pushes at `/push/<instance>` with
  `Authorization: Bearer <key>`, gives every sample its key's station, and serves the latest
  push of each client to Prometheus (job `mars-push`). Keys are made and revoked on the new
  keys plate (`E` → **Keys**) through `/api/keys`, or come from `MARS_PUSH_KEYS`.
  `MARS_BASIC_AUTH` covers `/api/keys` and leaves `/push/*` out.
- `mars-agent` pushes when `MARS_PUSH_URL` and `MARS_PUSH_KEY` are set (no open port then), and
  has `--healthcheck`. `mars-probe` pushes OpenMetrics from a thread with
  `instrument(…, push_url=…, push_key=…)` or the same variables.
- **Layouts plate** (`E` → **Layouts**): load one of the example layouts
  ([web/public/examples/index.json](web/public/examples/index.json)) or the built-in one as this
  display's own document, kept across reloads and undoable. From a `?config=` link it saves the
  example locally and leaves the link.
- `mars:node_up` covers pushed nodes through `mars_push_up` (**metric contract change**,
  ADR-0003's rule amended; pulled nodes unchanged).

- `mars-agent` ([agent/](agent/README.md), image `mars-agent`): a Linux host as a node of a
  station, from `/proc` and `statvfs`, standard library only. A compose file for monitored
  hosts (host network, `/` read-only), and a `demo-host` agent in the demo stack.
- Recording rules for host stations (section *hosts*): run-queue wait as latency, packets as
  throughput, memory stalls (PSI) as errors, the fullest of CPU, memory and disk as load and
  saturation. **Metric contract change** (ADR-0003 amended, ADR-0009 new); service stations are
  unchanged.
- [web/public/examples/linux-fleet.json](web/public/examples/linux-fleet.json): a fleet and its
  nodes on four pages, with thresholds for host signals.

### Changed

- Node.js 26.13.0 for the web Docker build, CI checks, and local development (`.nvmrc`).

- The demo stack pushes: the demo clients send through Caddy with keys from `MARS_PUSH_KEYS`,
  and `deploy/prometheus/targets/demo.yml` is gone. Pushed nodes are named by host
  (`demo-api`), not `host:port`.
- The tutorial and the READMEs set clients up with push; pulling stays documented.
- The Fleet strands and Slices instruments scale with the station's `thresh.max` (they had
  45 ms and 40 ms built in; the default `max` of 60 gives the same values).
- The latency readout shows two decimals below 1 ms.

### Fixed

- Gateway key rotation keeps one series per station/node; reserved push metrics and duplicate
  samples are rejected, and in-flight pushes cannot restore revoked clients.
- Polling feeds time out, show stale data after an outage, and ignore responses after stopping.
- Almanac caches distinguish source kinds, endpoints, and Prometheus station labels. Old caches
  remain stored but are no longer loaded because their source identity is ambiguous; Prometheus
  history is fetched again, simulated history is regenerated, and polling history starts fresh.
- Error budgets and coverage use the configured SLO window instead of always using 30 days.
- Host-agent containers share the host UTS namespace to keep a stable node name across recreations.
- Probe route labels retain each mount prefix when a sub-app is mounted more than once.

## [0.1.0] - 2026-11-07

The first release: the simulator prototype becomes a display for real FastAPI servers, through
Prometheus. Built in steps 00–12 ([docs/steps/](docs/steps/)).

### Probe (`mars-probe`)

- `instrument(app, station=…)`: pure ASGI middleware with the ADR-0003 metrics (request
  duration by route template, method, code class and region; in-flight and its limit; process
  CPU; exemplars) and `/metrics` in OpenMetrics or text format.
- `stage("name")` as `with`, `async with` or decorator; `mars_stage_info` carries the pipeline
  order (`stages=[…]`, else the order stages are first entered).
- `probe.gauge("name")` for custom signals (`mars_signal`).
- Client regions (`RegionConfig`): a trusted region header, CDN country headers, or GeoIP
  (`mars-probe[geo]`), on a fixed table of 80 regions shared with the display; optional client
  RTT from a proxy header.
- The `mars:*` recording rules ship in the package (`mars-probe rules`), with promtool tests;
  `mars-probe scrape-config` writes a file_sd target.
- Typed (`py.typed`), MIT licensed, installable from git (`#subdirectory=probe`).

### Display (`web/`)

- One config document (ADR-0005) for stations, pages and device settings: from a `?config=`
  URL, the `/config/` volume, localStorage or the built-in default, with migrations from the
  old URL parameters.
- Several stations at once, each from the simulator, a JSON poll or Prometheus (live queries,
  a tape backfilled for up to 4 h, a 30-day almanac from `query_range`, external alerts).
- 25 instruments in a registry, on a 12 × 8 grid of pages; five standard pages per station.
- The service panel (`E`): layout editing with undo, the module bay, the stations plate
  (discover stations on Prometheus, add them with their pages, edit thresholds, SLOs and
  pipeline order) and cartridges (export and import documents).
- Cross-station instruments: the Fleet page, a stations board and an all-stations log.
- The world map, origins table and centre of traffic from the probe's regions.

### Deploy

- `deploy/compose.yaml`: MARS (Caddy, same-origin `/prom` proxy, `/config/` volume) and
  Prometheus with 1 s scrapes and the rules mounted from the probe; profile `demo` adds two demo
  stations and a load generator.
- `deploy/compose.prod.yaml`: the released images, no demo, Prometheus not published, your
  targets and config in `deploy/site/`.
- Multi-arch images (amd64, arm64) for `mars-web` and `mars-demo`: `scripts/build-images.sh`
  and the release workflow, to `ghcr.io/p-sodmann/`.
- `MARS_BASIC_AUTH` turns on basic auth for everything but `/healthz`; LAN-only otherwise.
- `deploy/KIOSK.md`: a Raspberry Pi 5 or mini PC as a wall display.
- `scripts/check.sh` runs every check; CI runs it and brings the demo stack up under Docker
  Compose.

[Unreleased]: https://github.com/p-sodmann/data_shaders/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/p-sodmann/data_shaders/releases/tag/v0.1.0
