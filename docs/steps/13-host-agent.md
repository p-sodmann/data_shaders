# Step 13: Linux host agent and fleet example

Status: done
Depends on: 12
Read first: [ADR-0003](../adr/0003-metric-contract.md), [ADR-0007](../adr/0007-runtime-entities.md), [ADR-0009](../adr/0009-linux-hosts.md)

## Goal

A small Docker tool that reports a Linux host's metrics to MARS, and an example layout that
shows a fleet and its individual nodes.

## Decisions (user, 2026-11-07)

- Host signals fill the existing `mars:*` slots through recording rules, with no new frame
  fields (ADR-0009, option 1).
- A fleet is one station; each host is a node.

## Acceptance criteria

- [x] `docker compose -f agent/compose.yaml up -d` on a Linux host serves `/metrics` with
      `mars_info` and the `mars_host_*` family, read from the host (host network, `/` read-only).
- [x] The recording rules turn those into the station's `mars:*` series without touching
      service stations (promtool tests, both kinds in one test).
- [x] `?config=/examples/linux-fleet.json` shows a live fleet on the demo stack, and reacts to
      CPU contention.
- [x] `scripts/check.sh` passes.

## Handoff

### Built

- **[agent/](../../agent/README.md)** (`mars-agent`, image `mars-agent`, port 9110): standard
  library only. [host.py](../../agent/src/mars_agent/host.py) reads `/proc/stat`,
  `/proc/schedstat`, `/proc/net/dev` (minus loopback and container bridges),
  `/proc/meminfo`, `/proc/pressure/memory` and `statvfs` at scrape time; a missing source is
  left out and logged at start. [exposition.py](../../agent/src/mars_agent/exposition.py)
  writes the text format; [cli.py](../../agent/src/mars_agent/cli.py) serves `/metrics` and
  `/healthz`, every option also an env var, station names checked against the ADR-0003
  pattern, SIGTERM handled (PID 1). [Dockerfile](../../agent/Dockerfile) is
  `python:3.12-alpine` plus the package, `USER nobody`. [compose.yaml](../../agent/compose.yaml)
  for monitored hosts: `network_mode: host`, `/:/host:ro,rslave`, pinned
  `ghcr.io/p-sodmann/mars-agent:0.1.0` with a `build:` fallback. 7 tests on a fake `/proc`.
- **Rules:** a *hosts* section in
  [mars.rules.yml](../../probe/src/mars_probe/prometheus/mars.rules.yml) records
  `node_load_ratio`, `node_latency_p50_ms`, `latency_p50_ms`, `throughput_rps`, `error_ratio`,
  `error_ratio:rate1m` and `saturation_ratio` from `mars_host_*`. Two promtool cases: two hosts
  next to a service, and a host without PSI or schedstat.
  [test_cli.py](../../probe/tests/test_cli.py) now checks each section's names separately.
- **Example:** [linux-fleet.json](../../web/public/examples/linux-fleet.json), station `fleet`
  with host thresholds; pages Fleet, Nodes, Signal, Almanac. A vitest case checks it parses
  and every panel exists at its minimum size.
- **Display:** Fleet strands and Slices scale with `thresh.max` (unchanged at the defaults);
  the latency readout shows two decimals below 1 ms.
- **Wiring:** `demo-host` in the demo profile (target in `deploy/prometheus/targets/demo.yml`);
  check.sh runs the agent's tests, validates `agent/compose.yaml` and checks its version and
  pin; build-images.sh and release.yml build and push `mars-agent`; the CI stack job also waits
  for `fleet`'s throughput.
- **Docs:** ADR-0009 (new), ADR-0003 amended, agent README, root, deploy, web and docs READMEs,
  CHANGELOG *Unreleased*, three new open questions under *Hosts*. A beginner's tutorial,
  [tutorial-linux-fleet.md](../tutorial-linux-fleet.md), from installing Docker to reading the
  screen, with troubleshooting and two screenshots of the live stack.

### Deviations

- Two small display changes although option 1 said "no display code changes": without them the
  Fleet strands lay flat at the bottom (45 ms scale for values under 2 ms) and the latency
  readout read `0.0` on an idle host. Both keep the old output at the default thresholds.
- `demo-host` runs on the compose network, not the host network, so its packet count is the
  container's; its CPU, memory, PSI, schedstat and disk are the VM's.

### Surprises

- `/proc/schedstat` lines carry 9 fields after `cpuN` since version 15; run time, wait and
  timeslices are the last three, not fields 7–9 counted from 1 as older docs say.
- `rate(…[1m])` 20 s after a series starts reads about a third of the true rate (it only
  extrapolates part way into the empty window), so the `rate1m` promtool case is read at 80 s.
- podman-compose doesn't recreate a container when its image changes; `--force-recreate` does.

### Verification

- `scripts/check.sh` (Podman): probe `45 passed, 1 skipped`, promtool `SUCCESS`, agent
  `7 passed`, demo `18 passed`, vitest `128 passed`, `smoke: ok`, compose `ok`,
  `all checks passed`.
- Calibration on the 4-core Podman VM: 0.058 ms wait per timeslice idle, 1.57 ms with six
  busy loops (warn 1, crit 3, max 6 in the example).
- Host mode in the VM (`--network host -v /:/host:ro,rslave`, as `nobody`): filesystem used and
  available match `df -B1 /` to the byte; packets are `enp0s1`'s only.
- Demo stack: `mars:node_up`, `node_load_ratio`, `latency_p50_ms` (0.048), `throughput_rps`,
  `error_ratio` (0) and `saturation_ratio` for `fleet` through `/prom`. In Chromium, all four
  example pages render with no console errors. With six busy loops: wait 1.63 ms, load 1,
  station DEGRADED, the node lamp CRIT, the tape and strands above warn, the X-Y scope draws
  the knee.
- `podman stop` of the agent: 0.18 s. `uv build` gives a wheel with the package and licence.
