"""Readings of one Linux host, from /proc and statvfs (ADR-0009).

Every reading is taken when Prometheus scrapes, so the agent keeps no state and no thread.
A source the kernel doesn't have (no PSI, no schedstat) is left out of the reading instead of
reported as 0: the recording rules then leave the matching `mars:*` series absent, and the
display says NO DATA rather than showing a calm host that isn't measured.
"""

from __future__ import annotations

import contextlib
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

# Interfaces that only carry traffic the host already counts on a physical one (container
# bridges and veth pairs) or none at all (loopback).
DEFAULT_IGNORE = r"^(lo|veth.*|docker.*|br-.*|virbr.*|cni.*|flannel.*|cali.*|vxlan.*|podman.*)$"


@dataclass
class Reading:
    cpus: int | None = None
    cpu_busy_seconds: float | None = None
    runqueue_wait_seconds: float | None = None
    timeslices: int | None = None
    packets: dict[str, int] = field(default_factory=dict)  # direction → packets
    memory_total_bytes: int | None = None
    memory_available_bytes: int | None = None
    memory_stall_seconds: float | None = None
    fs_used_bytes: int | None = None
    fs_avail_bytes: int | None = None


def _read(path: Path) -> str | None:
    try:
        return path.read_text()
    except OSError:
        return None


def cpu(text: str, clk_tck: int) -> tuple[int, float]:
    """/proc/stat → (cpus, busy seconds summed over cores).

    Busy is everything but idle and iowait. guest and guest_nice are already inside user and
    nice, so they aren't added again.
    """
    cpus, busy = 0, None
    for line in text.splitlines():
        name, *rest = line.split()
        if name == "cpu":
            v = [int(x) for x in rest[:8]]
            busy = (sum(v) - v[3] - v[4]) / clk_tck
        elif name.startswith("cpu"):
            cpus += 1
    if busy is None:
        raise ValueError("/proc/stat has no cpu line")
    return cpus, busy


def schedstat(text: str) -> tuple[float, int]:
    """/proc/schedstat → (run-queue wait seconds, timeslices), summed over cores.

    Since schedstat version 15 each `cpuN` line ends in: time running (ns), time runnable but
    waiting for the core (ns), timeslices run. Wait ÷ timeslices is how long work waited for a
    CPU each time it got one: the host's own latency.
    """
    wait_ns, slices = 0, 0
    for line in text.splitlines():
        parts = line.split()
        if parts and re.fullmatch(r"cpu\d+", parts[0]) and len(parts) >= 10:
            wait_ns += int(parts[8])
            slices += int(parts[9])
    if not slices:
        raise ValueError("/proc/schedstat has no cpu lines")
    return wait_ns / 1e9, slices


def net_packets(text: str, ignore: re.Pattern[str]) -> dict[str, int]:
    """/proc/net/dev → packets received and sent over every interface `ignore` lets through.

    Both directions are always there, at 0 with no interface left: throughput is a real
    reading at 0, and the display only shows a second whose throughput exists.
    """
    rx = tx = 0
    for line in text.splitlines()[2:]:
        name, _, data = line.partition(":")
        if ignore.match(name.strip()):
            continue
        v = data.split()
        rx += int(v[1])
        tx += int(v[9])
    return {"rx": rx, "tx": tx}


def meminfo(text: str) -> tuple[int, int]:
    """/proc/meminfo → (MemTotal, MemAvailable) in bytes."""
    kb = {}
    for line in text.splitlines():
        key, _, rest = line.partition(":")
        kb[key] = int(rest.split()[0])
    return kb["MemTotal"] * 1024, kb["MemAvailable"] * 1024


def psi_some(text: str) -> float:
    """/proc/pressure/<resource> → seconds in which at least one task was stalled on it."""
    for line in text.splitlines():
        if line.startswith("some "):
            return int(line.rsplit("total=", 1)[1]) / 1e6
    raise ValueError("no 'some' line")


def filesystem(path: str) -> tuple[int, int]:
    """(used, available to users) bytes of the filesystem at `path`, as df counts them.

    Used + available is less than the size by the blocks reserved for root, so used ÷ (used +
    available) is df's Use%.
    """
    s = os.statvfs(path)
    return (s.f_blocks - s.f_bfree) * s.f_frsize, s.f_bavail * s.f_frsize


class Host:
    """Reads the host under `proc` (usually /proc) and the filesystem mounted at `rootfs`."""

    def __init__(self, proc: str = "/proc", rootfs: str = "/", ignore: str = DEFAULT_IGNORE):
        self.proc = Path(proc)
        self.rootfs = rootfs
        self.ignore = re.compile(ignore)
        self.clk_tck = os.sysconf("SC_CLK_TCK")

    def missing(self) -> list[str]:
        """Sources this host can't read, for the start-up log."""
        r = self.read()
        out = []
        if r.runqueue_wait_seconds is None:
            out.append("schedstat (no latency: the display shows NO DATA)")
        if r.memory_stall_seconds is None:
            out.append("PSI (no error ratio: reads as 0)")
        if r.fs_used_bytes is None:
            out.append(f"filesystem at {self.rootfs}")
        return out

    def read(self) -> Reading:
        r = Reading()
        if text := _read(self.proc / "stat"):
            r.cpus, r.cpu_busy_seconds = cpu(text, self.clk_tck)
        if text := _read(self.proc / "schedstat"):
            with contextlib.suppress(ValueError):
                r.runqueue_wait_seconds, r.timeslices = schedstat(text)
        if text := _read(self.proc / "net" / "dev"):
            r.packets = net_packets(text, self.ignore)
        if text := _read(self.proc / "meminfo"):
            r.memory_total_bytes, r.memory_available_bytes = meminfo(text)
        if text := _read(self.proc / "pressure" / "memory"):
            with contextlib.suppress(ValueError):
                r.memory_stall_seconds = psi_some(text)
        with contextlib.suppress(OSError):
            r.fs_used_bytes, r.fs_avail_bytes = filesystem(self.rootfs)
        return r
