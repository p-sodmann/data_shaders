# ADR-0009: Linux hosts as nodes of a station

Status: accepted · 2026-11-07 (step 13)

## Context

MARS reads services: a station is a FastAPI app with `mars-probe`, its nodes are the app's
processes, and its frame is HTTP-shaped: P50 latency, requests per second, 5xx ratio and
saturation ([ADR-0003](0003-metric-contract.md)). The tape, spectrum, almanac, readouts and C&W
rules all read those four signals, and the source only pushes a second that has latency and
throughput.

People also want to watch the machines: a fleet of Linux hosts and how each of them is doing.
The options were (user's decision, 2026-11-07):

1. **Host signals in the existing slots**: new recording rules fill the same `mars:*` series
   from host readings. Every instrument works; captions keep their HTTP wording.
2. A host station kind with its own captions (CPU %, RUNQ ms): more honest labels, but changes
   to the profile, the registry and several instruments.
3. Nodes only (up and CPU): lamps and the station board work, the tape and almanac stay empty.

And for the topology: one station per fleet with each host as a node, or one station per host.

## Decision

- **Option 1, one station per fleet.** Every host of a fleet runs `mars-agent` with the same
  `MARS_STATION` (default `fleet`); each host is a node (`instance`). New hosts take spare node
  slots ([ADR-0007](0007-runtime-entities.md)), so the layout doesn't change when the fleet
  grows. Several fleets (`web`, `db`) are several stations.
- **The agent** (`agent/`, image `mars-agent`) reads `/proc` and `statvfs` at scrape time and
  serves `/metrics` on port 9110. Standard library only. It runs with the host's network
  namespace (so `/proc/net/dev` is the host's) and the host's `/` mounted read-only at `/host`.
- **Raw metrics**, every series labelled `station`:

  | Name | Type | Source |
  |---|---|---|
  | `mars_info{version}` | gauge (=1) | as the probe's, so `mars:node_up` and the stations plate work unchanged |
  | `mars_host_cpus` | gauge | `cpuN` lines of `/proc/stat` |
  | `mars_host_cpu_busy_seconds_total` | counter | `/proc/stat`: all time but idle and iowait, summed over CPUs |
  | `mars_host_runqueue_wait_seconds_total` | counter | `/proc/schedstat`: time runnable tasks waited for a CPU |
  | `mars_host_timeslices_total` | counter | `/proc/schedstat`: timeslices run |
  | `mars_host_network_packets_total{direction}` | counter | `/proc/net/dev`, `rx`/`tx`, without loopback and container bridges |
  | `mars_host_memory_total_bytes`, `mars_host_memory_available_bytes` | gauge | `/proc/meminfo` |
  | `mars_host_memory_stall_seconds_total` | counter | `/proc/pressure/memory`, `some` (PSI) |
  | `mars_host_filesystem_used_bytes`, `mars_host_filesystem_avail_bytes` | gauge | `statvfs` of the root filesystem, as `df` counts |

  A source the kernel doesn't have is left out, never sent as 0.
- **The mapping** (rules in the `hosts` section of `mars.rules.yml`):

  | Frame slot | Host signal |
  |---|---|
  | latency (`latency_p50_ms`, `node_latency_p50_ms`) | run-queue wait per timeslice, ms: how long work waited for a CPU each time it got one. A mean, not a P50. |
  | throughput (`throughput_rps`) | packets per second, both directions, over the fleet |
  | errors (`error_ratio`, `error_ratio:rate1m`) | share of time some task was stalled on memory, averaged over hosts |
  | node load (`node_load_ratio`) | the fullest of CPU busy ÷ CPUs, memory used, root filesystem used |
  | saturation (`saturation_ratio`) | the highest node load |

- **No overlap.** A host station has no `mars_http_*` series and a service has no
  `mars_host_*` series, so each kind's rules record nothing for the other, though both write the
  same names. The host saturation rule selects host nodes with `and on (station, instance)
  mars_host_cpus`. A host station must not share its name with a service.
- **Thresholds are the station's.** Host values live on other scales (an idle host waits
  ~0.05 ms per timeslice, an oversubscribed one a few ms), so a host station sets its `thresh` in
  the document. The Fleet strands and Slices instruments now scale with `thresh.max` like the
  tape does (they had 45 ms and 40 ms built in; the defaults keep those exact values).
- **Example:** [web/public/examples/linux-fleet.json](../../web/public/examples/linux-fleet.json),
  station `fleet` with warn 1 ms, crit 3 ms, full scale 6 ms, measured on a 4-core VM (0.06 ms
  idle, 1.6 ms with six busy loops).

## Consequences

- Every instrument works for a fleet, including the tape, the signal page and the 30-day
  almanac, with no new frame fields.
- Captions keep their HTTP words: the latency readout says *P50 · ms*, throughput *req / s*,
  the error budget *availability*. The example document's panel ids say what they show, and the
  agent README has the mapping. Option 2 remains the way to fix the captions.
- The almanac's "availability SLO" for a host station is the share of time not stalled on
  memory.
- Kernels without PSI (or booted with `psi=0`) have no error ratio, which the display reads as
  0. Without `/proc/schedstat` there is no latency, so the tape stays empty (the agent says so
  at start).
- Endpoints, stages, regions and exemplars are HTTP only: the Sweep page, the pipeline and the
  trace stay empty for a host station, so the example has no such panels.
