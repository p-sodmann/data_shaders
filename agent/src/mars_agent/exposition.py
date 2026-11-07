"""The ADR-0009 metrics in the Prometheus text format (0.0.4)."""

from __future__ import annotations

from .host import Reading

# name, type, help, Reading attribute
_SIMPLE = [
    ("mars_host_cpus", "gauge", "Online CPUs", "cpus"),
    (
        "mars_host_cpu_busy_seconds_total",
        "counter",
        "CPU time not idle or in iowait, summed over CPUs",
        "cpu_busy_seconds",
    ),
    (
        "mars_host_runqueue_wait_seconds_total",
        "counter",
        "Time runnable tasks waited for a CPU, summed over CPUs",
        "runqueue_wait_seconds",
    ),
    ("mars_host_timeslices_total", "counter", "Timeslices run, summed over CPUs", "timeslices"),
    ("mars_host_memory_total_bytes", "gauge", "MemTotal", "memory_total_bytes"),
    ("mars_host_memory_available_bytes", "gauge", "MemAvailable", "memory_available_bytes"),
    (
        "mars_host_memory_stall_seconds_total",
        "counter",
        "Time at least one task was stalled on memory (PSI some)",
        "memory_stall_seconds",
    ),
    (
        "mars_host_filesystem_used_bytes",
        "gauge",
        "Used bytes of the root filesystem",
        "fs_used_bytes",
    ),
    (
        "mars_host_filesystem_avail_bytes",
        "gauge",
        "Bytes of the root filesystem available to users",
        "fs_avail_bytes",
    ),
]


def _num(v: float) -> str:
    return repr(float(v)) if isinstance(v, float) else str(v)


def render(station: str, version: str, r: Reading) -> str:
    st = f'station="{station}"'
    out = [
        "# HELP mars_info MARS identity and liveness",
        "# TYPE mars_info gauge",
        f'mars_info{{{st},version="{version}"}} 1',
    ]
    for name, kind, help_, attr in _SIMPLE:
        v = getattr(r, attr)
        if v is None:
            continue
        out += [f"# HELP {name} {help_}", f"# TYPE {name} {kind}", f"{name}{{{st}}} {_num(v)}"]
    if r.packets:
        name = "mars_host_network_packets_total"
        out += [f"# HELP {name} Packets over physical interfaces", f"# TYPE {name} counter"]
        out += [f'{name}{{{st},direction="{d}"}} {n}' for d, n in sorted(r.packets.items())]
    return "\n".join(out) + "\n"
