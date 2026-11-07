# mars-agent

Reports a Linux host to MARS: CPU, run-queue wait, memory, memory pressure, disk use and
network packets, on `/metrics` for Prometheus. Every host of a fleet runs one, with the same
station name, and each host shows up as a node of that station: one lamp in the Nodes bank, one
strand in Fleet, one spoke in Slices ([ADR-0009](../docs/adr/0009-linux-hosts.md)).

Standard library only; the image is `python:3.12-alpine` plus this package.

A beginner's walk-through from an empty computer to a working display:
[docs/tutorial-linux-fleet.md](../docs/tutorial-linux-fleet.md).

## Run it on a host

From a checkout of this repo on the host (or copy [compose.yaml](compose.yaml) and this folder):

```bash
MARS_STATION=fleet docker compose -f agent/compose.yaml up -d
curl -s localhost:9110/metrics | grep mars_host_cpus
```

The compose file uses the host's network (so the packet count is the host's, and Prometheus
reaches the agent at `<host>:9110`) and mounts `/` read-only at `/host` for the disk use. It
runs as `nobody` and needs no capabilities. Without Docker:

```bash
pip install "mars-agent @ git+https://github.com/p-sodmann/data_shaders#subdirectory=agent"
MARS_STATION=fleet mars-agent
```

Then, on the MARS machine, list the hosts in a target file (picked up without a restart):

```yaml
# deploy/site/targets/fleet.yml
- targets: ["web-1.lan:9110", "web-2.lan:9110", "db-1.lan:9110"]
```

Open port 9110 to the MARS machine only (`ufw allow from 192.168.1.20 to any port 9110 proto tcp`).
The metrics say nothing secret, but there's no reason to publish them.

## Show it

Load [web/public/examples/linux-fleet.json](../web/public/examples/linux-fleet.json): open
`http://<mars>:8080/?config=/examples/linux-fleet.json`, or save it as
`deploy/site/config/mars.json` for every display. Its station reads `fleet`; for another name,
change `source.station` (or add the station from the stations plate, `E` → **Stations**, and
copy the example's `thresh`).

| Page | Shows |
|---|---|
| **Fleet** | run-queue wait as the 4-hour tape, saturation meter, one lamp per host, the three readouts, the log |
| **Nodes** | lamps, per-host strands (3 min), slices (10 min), wait against load, C&W rules |
| **Signal** | rhythms in run-queue wait and packets: cron jobs, backups, batch windows |
| **Almanac** | 30 days of wait by weekday and hour, and a budget for time stalled on memory |

## What the instruments read

The display's slots are HTTP-shaped, so a host fills them like this:

| Caption on the display | For a host |
|---|---|
| Latency, *P50 · ms* | how long runnable work waited for a CPU per timeslice, ms (a mean). ~0.05 idle, a few ms when the CPUs are oversubscribed |
| Throughput, *req / s* | network packets per second, in + out, physical interfaces |
| Errors, *% of req* | share of time some task was stalled on memory (PSI) |
| Load / saturation, node fill | the fullest of CPU, memory, root filesystem. A 90 % full disk holds a lamp at warn |

The example's thresholds (warn 1 ms, crit 3 ms, memory stall 2 % / 10 %, saturation 80 % /
92 %) are starting points; tune them on the station's *Settings* plate.

## Settings

| Variable | Option | Default | |
|---|---|---|---|
| `MARS_STATION` | `--station` | `fleet` | lower case, digits, dashes; not the name of a service station |
| `MARS_AGENT_PORT` | `--port` | `9110` | |
| `MARS_AGENT_HOST` | `--host` | `0.0.0.0` | |
| `MARS_ROOTFS` | `--rootfs` | `/` | the compose file sets `/host` |
| `MARS_PROC` | `--proc` | `/proc` | |
| `MARS_IGNORE_INTERFACES` | `--ignore-interfaces` | loopback, `veth*`, `docker*`, `br-*`, … | regex of interfaces left out of the packet count |

At start the agent logs what it can't read: no `/proc/schedstat` means no latency (the tape
stays empty), no PSI (kernel without `CONFIG_PSI`, or `psi=0`) means the error ratio reads 0.

## Develop

```bash
cd agent
uv run pytest -q && uv run ruff check . && uv run ruff format --check .
```

The tests run against a fake `/proc`, so they pass on macOS too. The recording rules that turn
these metrics into `mars:*` series are in
[probe/src/mars_probe/prometheus/mars.rules.yml](../probe/src/mars_probe/prometheus/mars.rules.yml)
(section *hosts*), with promtool tests next to the probe's.
