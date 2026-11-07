"""`mars-agent`: serves one Linux host's readings on /metrics for Prometheus (ADR-0009).

Every option has an environment variable, so the container is configured with `-e` alone.
"""

from __future__ import annotations

import argparse
import contextlib
import os
import re
import signal
import socket
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from ._version import __version__
from .exposition import render
from .host import DEFAULT_IGNORE, Host

# The same pattern as the probe's station names (ADR-0003).
STATION = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"


def handler(host: Host, station: str) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 (http.server's name)
            # /metrics/ and /metrics?… are /metrics too: a scrape job's metrics_path or a
            # proxy may add either, and a 404 there reads as a dead host on the display.
            path = urlsplit(self.path).path.rstrip("/")
            if path == "/metrics":
                body, ctype = render(station, __version__, host.read()).encode(), CONTENT_TYPE
            elif path == "/healthz":
                body, ctype = b"ok\n", "text/plain"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass  # one scrape a second would flood the log

    return Handler


class Server(ThreadingHTTPServer):
    daemon_threads = True  # a hung scrape mustn't hold up a stop

    def server_bind(self):
        # "::" takes IPv4 as well, so `localhost` works whether it resolves to ::1 or 127.0.0.1
        # (busybox wget and some Prometheus set-ups try ::1 only).
        if self.address_family == socket.AF_INET6:
            with contextlib.suppress(OSError):
                self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def serve(addr: str, port: int, handler_class: type[BaseHTTPRequestHandler]) -> Server:
    """A server on `addr`; empty means every address, IPv6 and IPv4, or IPv4 alone on a host
    without IPv6."""
    if addr in ("", "::"):
        try:
            return type("Server6", (Server,), {"address_family": socket.AF_INET6})(
                ("::", port), handler_class
            )
        except OSError:
            return Server(("0.0.0.0", port), handler_class)
    family = socket.AF_INET6 if ":" in addr else socket.AF_INET
    return type("ServerN", (Server,), {"address_family": family})((addr, port), handler_class)


def parse(argv: list[str] | None) -> argparse.Namespace:
    env = os.environ.get
    p = argparse.ArgumentParser(prog="mars-agent", description=__doc__.split("\n")[0])
    p.add_argument(
        "--station",
        default=env("MARS_STATION", "fleet"),
        help="station this host is a node of; every host of a fleet uses the same one "
        "(MARS_STATION, default fleet)",
    )
    p.add_argument(
        "--host",
        default=env("MARS_AGENT_HOST", ""),
        help="address to listen on; empty is every address, IPv6 and IPv4 (MARS_AGENT_HOST)",
    )
    p.add_argument(
        "--port", type=int, default=int(env("MARS_AGENT_PORT", "9110")), help="MARS_AGENT_PORT"
    )
    p.add_argument("--proc", default=env("MARS_PROC", "/proc"), help="procfs to read (MARS_PROC)")
    p.add_argument(
        "--rootfs",
        default=env("MARS_ROOTFS", "/"),
        help="where the host's root filesystem is mounted (MARS_ROOTFS)",
    )
    p.add_argument(
        "--ignore-interfaces",
        default=env("MARS_IGNORE_INTERFACES", DEFAULT_IGNORE),
        metavar="REGEX",
        help="interfaces left out of the packet count (MARS_IGNORE_INTERFACES)",
    )
    p.add_argument("--version", action="version", version=__version__)
    args = p.parse_args(argv)
    if not STATION.match(args.station):
        p.error(f"station {args.station!r}: lower case letters, digits and dashes, max 32")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse(argv)
    host = Host(args.proc, args.rootfs, args.ignore_interfaces)
    for what in host.missing():
        print(f"mars-agent: can't read {what}", file=sys.stderr)
    server = serve(args.host, args.port, handler(host, args.station))
    where = args.host if ":" not in args.host else f"[{args.host}]"
    print(
        f"mars-agent {__version__}: station {args.station}, "
        f"http://{where or '*'}:{server.server_address[1]}/metrics",
        file=sys.stderr,
        flush=True,
    )
    # As PID 1 in a container, Python would ignore SIGTERM and `docker stop` would wait 10 s.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    with contextlib.suppress(KeyboardInterrupt, SystemExit):
        server.serve_forever()
    server.server_close()
    return 0
