# Step 11: Regions and GeoIP

Status: todo
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

- [ ] Page 3 on the demo stack shows arcs from the loadgen's regions, an origins table with RTT,
      and a centroid that moves with the loadgen's region mix.
- [ ] A spoofed `X-Forwarded-For` from an untrusted peer is ignored (test).
- [ ] The number of region label values is ≤ the size of the table plus 1 (test).
- [ ] Probe tests, the promtool tests and the web tests pass.

## Out of scope

City-level geolocation and IP-level detail (deliberately excluded, for privacy and cardinality).
