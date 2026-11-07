# Step 11: Regions and GeoIP

Status: done
Depends on: 07
Read first: [ADR-0003](../adr/0003-metric-contract.md) (`region` label, `mars_client_rtt_seconds`)

## Context

The ground track and origins instruments (page 3) need per-region traffic. Until now the probe
always reports `region="unknown"`.

## Goal

The probe resolves a client region code per request. It can also record client RTT from a
trusted proxy header. MARS shows real regions on the ground track.

## Design (probe)

`instrument(..., regions=RegionConfig(...))` with resolution in this order (first hit wins):
1. **A trusted header holding a region code**, for example `X-Demo-Region` or a custom
   edge header (`header="X-Region"`).
2. **A country header** (`CF-IPCountry`, `CloudFront-Viewer-Country`), mapped country → region
   code through a built-in table (the nearest MARS region, from the same table as
   `web/src/data/regions.js`. Generate one from the other, or keep a shared JSON in `probe/`
   that the web build copies, and record the choice).
3. **GeoIP** with the optional extra `mars-probe[geo]` (`geoip2`) and a user-supplied GeoLite2
   Country database path. The client IP comes from `X-Forwarded-For` **only if** the immediate
   peer is in `trusted_proxies`, otherwise from the socket peer.
4. Otherwise `unknown`.

Rules:
- Region codes must come from the shared table, to keep label cardinality bounded.
- RTT: if `rtt_header` is set (for example nginx `proxy_set_header X-Client-RTT $tcpinfo_rtt;`,
  which is in µs), observe `mars_client_rtt_seconds{station, region}`. Unit conversion is
  configurable.
- Resolution must cost < 20 µs with headers. GeoIP is cached (LRU by IP).

## Tasks

1. Probe: `RegionConfig`, resolution, the RTT histogram, tests (header precedence, the
   trusted-proxy check, unknown fallback, cardinality guard), and README docs including the
   nginx snippet.
2. The demo app uses `RegionConfig(header="X-Demo-Region", rtt_header="X-Demo-RTT")`. The
   loadgen sends a plausible RTT per region (base RTT from distance to `HOME`, plus jitter, plus
   a degraded route now and then).
3. Check the step 03 recording rules for regions against real data, and fix them if needed
   (keep ADR-0003 in sync).
4. MARS: make sure the step 07 region discovery and the ground track, origins and centroid trail
   work with live regions, and that `home` from the station profile is used.

## Acceptance criteria

- [x] Page 3 on the demo stack shows arcs from the loadgen's regions, an origins table with RTT,
      and a centroid that moves with the loadgen's region mix.
- [x] A spoofed `X-Forwarded-For` from an untrusted peer is ignored (test).
- [x] The number of region label values is ≤ the size of the table plus 1 (test).
- [x] Probe tests, the promtool tests and the web tests pass.

## Out of scope

City-level geolocation and IP-level detail (deliberately excluded, for privacy and cardinality).

## Handoff

**Built**

- **Region table, shared:** [probe/src/mars_probe/regions.json](../../probe/src/mars_probe/regions.json)
  is the only source: `regions` (the 80 codes that were in `web/src/data/regions.js`, as
  code → [name, lat, lon]) and `countries` (248 ISO alpha-2 codes → the region nearest the
  country's capital). [probe/scripts/gen_regions.py](../../probe/scripts/gen_regions.py)
  recomputes `countries` from a capitals table. The web keeps a verbatim copy,
  [web/src/data/regions.json](../../web/src/data/regions.json), which
  [regions.js](../../web/src/data/regions.js) imports (a named import, so the country map is
  tree-shaken out of the bundle). The copy is checked by
  [probe/tests/test_regions.py](../../probe/tests/test_regions.py) and
  [web/test/regions.test.js](../../web/test/regions.test.js).
- **Probe:** [regions.py](../../probe/src/mars_probe/regions.py) has `RegionConfig` (exported
  from `mars_probe`) and `RegionResolver`. Resolution order: trusted `header` (a code in the
  table, any case; a code outside the table falls through), then `country_headers` (default
  `CF-IPCountry`, `CloudFront-Viewer-Country`), then `geoip` (a path, which needs
  `mars-probe[geo]` = `geoip2>=4.8`, or any object with `country(ip)`; LRU-cached per IP,
  private addresses → `unknown`), then `unknown`. The client IP is the socket peer, unless the
  peer is in `trusted_proxies`; then `X-Forwarded-For` is read from the right and the first
  untrusted hop is the client. RTT: `rtt_header` × `rtt_unit` (default 1e-6, nginx µs) →
  `mars_client_rtt_seconds{station, region}`, a histogram created only when `rtt_header` is set.
  `instrument(..., regions=RegionConfig(...))`. Without it the behaviour is unchanged (always
  `unknown`).
- **Demo:** [app.py](../../examples/demo/demo/app.py) uses
  `RegionConfig(header="X-Demo-Region", rtt_header="X-Demo-RTT", country_headers=())`.
  [loadgen.py](../../examples/demo/demo/loadgen.py) sends `X-Demo-RTT` in µs: 3 ms + 1 ms per
  95 km to `LOADGEN_HOME` (the simulator's model), 8 % log-normal jitter, and every
  ~`LOADGEN_DEGRADE_EVERY` (15 m) one region degrades ×1.6 or ×2.5 for 2–7 min. Region shares
  now follow local daylight (the simulator's curve) over the loadgen's day, so the centroid
  moves.
- **Rules:** unchanged except a comment. A promtool case for `mars:region_rtt_ms` was added
  (62.5 ms in FRA, `unknown` left out).
- **Web:** no code change needed beyond the table. A new test in
  [prometheus.test.js](../../web/test/prometheus.test.js) covers a Prometheus station with live
  regions: `home` from the doc, RTT in the store, a region arriving later taking a spare slot,
  and the centroid moving with the mix and leaving a track point.
- Docs: [probe/README.md](../../probe/README.md) (Client regions, with the nginx snippet), the
  [demo README](../../examples/demo/README.md), [web/README.md](../../web/README.md), and
  [ADR-0003](../adr/0003-metric-contract.md) (amended).

**Deviations**

- **Shared table:** a JSON in `probe/` with a *committed* copy in `web/`, checked by tests, not
  "copied by the web build". The `mars-web` image is built with context `web/` only
  (`deploy/compose.yaml`), so its build can't reach `probe/`.
- **Country → region** is "nearest to the capital", computed by a script. It is not hand-made
  and not taken from the web table (which had no countries). Large countries land on odd
  regions (open question).
- **ADR-0003 amended:** the region table and the resolution order, the RTT buckets (the ADR had
  none), and `unknown` left out of `region_error_ratio` and `region_rtt_ms` too (step 03 did it
  that way already, but the ADR said so only for `region_rps`).
- **Loadgen region mix by local daylight:** not in the task list. Without it the mix is
  constant, and the criterion "a centroid that moves with the loadgen's region mix" can't
  happen.
- `country_headers` are trusted by default, as the step's order lists them. The demo turns them
  off. Open question on whether the default should be off.

**Verification**

- Baseline before any change: probe 28 passed / 1 skipped, demo 14, web 124, build, smoke ok,
  promtool SUCCESS.
- `cd probe && uv run pytest -q` → `45 passed, 1 skipped` (the skip is the promtool wrapper,
  since there is no local promtool). `ruff check` → all passed; `ruff format --check` → 21 files
  formatted. Overhead: `overhead 2.2 µs/request`, `region resolution 0.39 µs` (limit 20).
- `bash probe/scripts/test-rules.sh` → `SUCCESS` (podman).
- `cd examples/demo && uv run pytest -q` → `18 passed`; ruff clean.
- `cd web && npm run build && npm test && npm run smoke` → built; `127 passed`; `smoke: ok`.
- `podman-compose -f deploy/compose.yaml config` → ok (the file is unchanged; there is no
  `docker compose` here).
- Live (Podman stack, new probe/demo files copied into the running containers, see below):
  `mars:region_rps{station="api"}` had 12 regions (IAD 8.8, SFO 5.9, NRT 3.4 rps …);
  `mars:region_rtt_ms` LHR 10, MAD 18.8, DXB 54, IAD 70.6, NRT 100, SYD 174 ms;
  `region_error_ratio` 0. 12 region values per station.
- Page 3 on the live stack, via Playwright (1920×1080, new build copied into the `mars`
  container): 12 live regions with RTT in the store; the centroid went from `[64.7, 148.4]` to
  `[60.0, -15.1]` in 5 min (10-minute demo day), with 10 track points; no console errors.
  Screenshots: `web/snapshots/step11-page3-a.png`, `web/snapshots/step11-page3-b.png`
  (gitignored, local only).

**Not verified / needs a person**

- **Image rebuilds:** `podman build` of `mars-demo` failed again with a DNS error in the Podman
  VM (`uv sync` can't reach PyPI), and `mars-web` has the known `npm ci` problem. The live check
  ran on files copied into the running containers (`podman cp` of the probe package, `app.py`,
  `loadgen.py` and `web/dist`), as in steps 07–09. Rebuild with
  `--profile demo up -d --build` on working Docker.
- **GeoIP with a real GeoLite2 database:** none is available here (it needs a MaxMind account).
  Covered with a fake reader. `geoip2` 5.3.0 installs and imports, and a missing database file
  raises `FileNotFoundError` at `instrument()`.
- **The nginx snippet** wasn't run against a real nginx.
- **A degraded route on the display** (`ROUTE … DEGRADED`) wasn't seen live: they come every
  ~15 min at random, and the 5-minute capture had none. The loadgen code is unit-tested, and the
  display logic is unchanged since step 07.
- A person should look at the two screenshots. The origins table text is small at 1920×1080,
  but that's unchanged.

**Notes for later steps**

- To change the region table: edit `probe/src/mars_probe/regions.json`, run
  `uv run python scripts/gen_regions.py`, then `cp` it to `web/src/data/regions.json`. Names
  ≤ 10 characters, upper case, and codes are 3 letters (the web test checks this).
- Startup artefact: right after a process starts, a region can show `region_rtt_ms` but
  `region_rps` 0, because `rate()` drops the first increment of each new route × region series,
  while the per-region RTT series already exists. It goes away once the series exist; the rules
  are fine.
- `LOADGEN_HOME` must match the stations' `home` in the config document (both default to
  Frankfurt, 50.1, 8.7). The loadgen has one home for all targets.
- Step 12: the probe now has an optional `geo` extra to document in the release notes.
