"""mars-agent against a fake /proc, taken from a 4-core Linux 6.x VM."""

from __future__ import annotations

import re
import socket
import threading
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from mars_agent import __version__
from mars_agent.cli import handler, parse, serve
from mars_agent.exposition import render
from mars_agent.host import DEFAULT_IGNORE, Host, net_packets, schedstat

STAT = """\
cpu  363296 0 17075 1077651 506 4111 1900 0 0 0
cpu0 90824 0 4268 269412 126 1027 475 0 0 0
cpu1 90824 0 4269 269413 127 1028 475 0 0 0
cpu2 90824 0 4269 269413 127 1028 475 0 0 0
cpu3 90824 0 4269 269413 126 1028 475 0 0 0
intr 1 2 3
ctxt 99
"""

SCHEDSTAT = """\
version 17
timestamp 4298213711
cpu0 0 0 0 0 0 0 986430066458 1000000000 1000
domain0 MC 3 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
cpu1 0 0 0 0 0 0 986430066458 500000000 3000
"""

NET_DEV = """\
Inter-|   Receive                                                |  Transmit
 face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs ...
    lo:  500 7 0 0 0 0 0 0  500 7 0 0 0 0 0 0
enp0s1: 284347404 219449 0 0 0 0 0 0 17801810 75486 0 0 0 0 0 0
docker0: 100 5 0 0 0 0 0 0 100 5 0 0 0 0 0 0
vethab12: 100 5 0 0 0 0 0 0 100 5 0 0 0 0 0 0
"""

MEMINFO = "MemTotal:        8000000 kB\nMemFree:  100 kB\nMemAvailable:    2000000 kB\n"
PSI = "some avg10=0.00 avg60=0.00 avg300=0.00 total=2500000\nfull avg10=0 total=26\n"


@pytest.fixture
def proc(tmp_path):
    (tmp_path / "net").mkdir()
    (tmp_path / "pressure").mkdir()
    (tmp_path / "stat").write_text(STAT)
    (tmp_path / "schedstat").write_text(SCHEDSTAT)
    (tmp_path / "net" / "dev").write_text(NET_DEV)
    (tmp_path / "meminfo").write_text(MEMINFO)
    (tmp_path / "pressure" / "memory").write_text(PSI)
    return tmp_path


def test_reading(proc, tmp_path):
    r = Host(str(proc), str(tmp_path)).read()
    assert r.cpus == 4
    # busy = total - idle - iowait, at USER_HZ
    busy_ticks = 363296 + 17075 + 4111 + 1900
    assert r.cpu_busy_seconds == pytest.approx(busy_ticks / Host(str(proc)).clk_tck)
    # wait and slices from the cpuN lines only, not the domain line
    assert r.runqueue_wait_seconds == pytest.approx(1.5)
    assert r.timeslices == 4000
    assert r.packets == {"rx": 219449, "tx": 75486}
    assert (r.memory_total_bytes, r.memory_available_bytes) == (8000000 * 1024, 2000000 * 1024)
    assert r.memory_stall_seconds == pytest.approx(2.5)
    assert r.fs_used_bytes > 0 and r.fs_avail_bytes >= 0


def test_missing_sources_are_left_out(proc):
    (proc / "schedstat").unlink()
    (proc / "pressure" / "memory").unlink()
    host = Host(str(proc), "/no/such/mount")
    r = host.read()
    assert r.runqueue_wait_seconds is None and r.timeslices is None
    assert r.memory_stall_seconds is None
    assert r.fs_used_bytes is None
    assert len(host.missing()) == 3
    text = render("fleet", "0.1.0", r)
    assert "mars_host_runqueue_wait_seconds_total" not in text
    assert "mars_host_memory_stall_seconds_total" not in text
    assert "mars_host_cpus" in text


def test_packets_are_zero_without_interfaces():
    only_virtual = "\n".join(NET_DEV.splitlines()[:3])
    assert net_packets(only_virtual, re.compile(DEFAULT_IGNORE)) == {"rx": 0, "tx": 0}


def test_schedstat_needs_cpu_lines():
    with pytest.raises(ValueError):
        schedstat("version 17\ntimestamp 1\n")


def test_render(proc, tmp_path):
    text = render("fleet", "0.1.0", Host(str(proc), str(tmp_path)).read())
    assert 'mars_info{station="fleet",version="0.1.0"} 1\n' in text
    assert 'mars_host_cpus{station="fleet"} 4\n' in text
    assert 'mars_host_timeslices_total{station="fleet"} 4000\n' in text
    assert 'mars_host_network_packets_total{station="fleet",direction="rx"} 219449\n' in text
    assert "# TYPE mars_host_cpu_busy_seconds_total counter" in text
    # every sample line carries the station
    samples = [line for line in text.splitlines() if not line.startswith("#")]
    assert samples and all('station="fleet"' in line for line in samples)


def test_station_name_is_checked():
    assert parse(["--station", "web-eu"]).station == "web-eu"
    with pytest.raises(SystemExit):
        parse(["--station", "Web_EU"])


def test_server(proc, tmp_path):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler(Host(str(proc), str(tmp_path)), "f"))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with urllib.request.urlopen(f"{base}/metrics") as resp:
            assert resp.headers["Content-Type"].startswith("text/plain; version=0.0.4")
            assert f'mars_info{{station="f",version="{__version__}"}} 1' in resp.read().decode()
        with urllib.request.urlopen(f"{base}/healthz") as resp:
            assert resp.read() == b"ok\n"
        with pytest.raises(urllib.error.HTTPError):
            urllib.request.urlopen(f"{base}/nope")
    finally:
        server.shutdown()


def test_metrics_path_with_slash_or_query(proc, tmp_path):
    server = serve("127.0.0.1", 0, handler(Host(str(proc), str(tmp_path)), "f"))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        for path in ("/metrics/", "/metrics?x=1", "/healthz/"):
            with urllib.request.urlopen(base + path) as resp:
                assert resp.status == 200, path
    finally:
        server.shutdown()


@pytest.mark.skipif(not socket.has_ipv6, reason="no IPv6")
def test_listens_on_ipv6_and_ipv4(proc, tmp_path):
    server = serve("", 0, handler(Host(str(proc), str(tmp_path)), "f"))
    if server.address_family != socket.AF_INET6:
        server.server_close()
        pytest.skip("this machine has IPv6 switched off")
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    try:
        for url in (f"http://127.0.0.1:{port}/healthz", f"http://[::1]:{port}/healthz"):
            with urllib.request.urlopen(url) as resp:
                assert resp.read() == b"ok\n", url
    finally:
        server.shutdown()
