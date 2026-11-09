"""`mars-gateway`: takes pushes from mars-agent and mars-probe, serves them to Prometheus
(ADR-0010).

  POST   /push/<instance>    a client's metrics, `Authorization: Bearer <key>`
  GET    /metrics            every client's latest push, for Prometheus (compose network only)
  GET    /api/keys           the keys and the clients pushing with each
  POST   /api/keys           {"name", "station"} → a new key, shown this once
  PATCH  /api/keys/<id>      {"station"} → change a display key’s station
  DELETE /api/keys/<id>      revoke a key
  GET    /healthz

The display reaches /push and /api/keys through Caddy. /api/keys sits behind the display's
auth (MARS_BASIC_AUTH); /push carries its own key.

Every option has an environment variable, so the container is configured with `-e` alone.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import signal
import socket
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

from prometheus_client import CollectorRegistry
from prometheus_client.exposition import choose_encoder

from ._version import __version__
from .board import Board
from .keys import KeyStore

INSTANCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")
MAX_BODY = 4 << 20


def handler(keys: KeyStore, board: Board) -> type[BaseHTTPRequestHandler]:
    registry = CollectorRegistry(auto_describe=False)
    registry.register(board)

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, body: bytes = b"", ctype: str = "text/plain") -> None:
            self.send_response(status)
            if body:
                self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, data) -> None:
            self._send(status, json.dumps(data).encode(), "application/json")

        def _error(self, status: int, message: str) -> None:
            self._json(status, {"error": message})

        def _body(self) -> bytes | None:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                self._error(413, f"at most {MAX_BODY} bytes")
                return None
            return self.rfile.read(length)

        def _path(self) -> str:
            return urlsplit(self.path).path.rstrip("/")

        def do_GET(self):  # noqa: N802 (http.server's names)
            path = self._path()
            if path == "/metrics":
                encoder, ctype = choose_encoder(self.headers.get("Accept", ""))
                self._send(200, encoder(registry), ctype)
            elif path == "/healthz":
                self._send(200, b"ok\n")
            elif path == "/api/keys":
                self._json(
                    200,
                    {"keys": [{**k.public(), "clients": board.clients(k.id)} for k in keys.all()]},
                )
            else:
                self._error(404, "not found")

        def do_POST(self):  # noqa: N802
            path = self._path()
            if path.startswith("/push/"):
                return self._push(unquote(path[len("/push/") :]))
            if path != "/api/keys":
                return self._error(404, "not found")
            # JSON only: a cross-site form can't send it without a CORS preflight, which this
            # server never answers, so a logged-in browser can't be made to create a key.
            if not self.headers.get("Content-Type", "").startswith("application/json"):
                return self._error(415, "send application/json")
            body = self._body()
            if body is None:
                return
            try:
                req = json.loads(body)
                key, token = keys.create(str(req.get("name", "")), str(req.get("station", "")))
            except (ValueError, AttributeError) as e:
                return self._error(400, str(e))
            self._json(201, {"key": {**key.public(), "clients": []}, "token": token})

        def do_PATCH(self):  # noqa: N802
            path = self._path()
            if not path.startswith("/api/keys/"):
                return self._error(404, "not found")
            if not self.headers.get("Content-Type", "").startswith("application/json"):
                return self._error(415, "send application/json")
            body = self._body()
            if body is None:
                return
            try:
                req = json.loads(body)
                key = board.update_station(
                    keys, path[len("/api/keys/") :], str(req.get("station", ""))
                )
            except (ValueError, AttributeError) as e:
                return self._error(400, str(e))
            if key is None:
                return self._error(404, "no such key, or one from MARS_PUSH_KEYS")
            self._json(200, {"key": {**key.public(), "clients": board.clients(key.id)}})

        def do_DELETE(self):  # noqa: N802
            path = self._path()
            if not path.startswith("/api/keys/"):
                return self._error(404, "not found")
            key_id = path[len("/api/keys/") :]
            if not keys.revoke(key_id):
                return self._error(404, "no such key, or one from MARS_PUSH_KEYS")
            board.revoke(key_id)
            self._send(204)

        def _push(self, instance: str) -> None:
            auth = self.headers.get("Authorization", "")
            key = keys.check(auth[7:].strip()) if auth[:7].lower() == "bearer " else None
            if key is None:
                return self._error(401, "unknown key")
            if not INSTANCE.match(instance):
                return self._error(400, "instance: letters, digits, '.', '_', ':', '-', max 64")
            body = self._body()
            if body is None:
                return
            try:
                text = body.decode()
                board.push(key, instance, text, self.headers.get("Content-Type", ""))
            except PermissionError:
                return self._error(401, "revoked key")
            except (UnicodeDecodeError, ValueError) as e:
                return self._error(400, str(e))
            self._send(204)

        def log_message(self, *_):
            pass  # a push a second per client would flood the log

    return Handler


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def server_bind(self):
        # "::" takes IPv4 as well, as in mars-agent.
        if self.address_family == socket.AF_INET6:
            with contextlib.suppress(OSError):
                self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def serve(addr: str, port: int, handler_class: type[BaseHTTPRequestHandler]) -> Server:
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
    p = argparse.ArgumentParser(prog="mars-gateway", description=__doc__.split("\n")[0])
    p.add_argument("--host", default=env("MARS_GATEWAY_HOST", ""), help="MARS_GATEWAY_HOST")
    p.add_argument(
        "--port", type=int, default=int(env("MARS_GATEWAY_PORT", "9111")), help="MARS_GATEWAY_PORT"
    )
    p.add_argument(
        "--keys",
        default=env("MARS_GATEWAY_KEYS", "/data/keys.json"),
        help="file for the keys made on the display (MARS_GATEWAY_KEYS)",
    )
    p.add_argument(
        "--ttl",
        type=float,
        default=float(env("MARS_GATEWAY_TTL", "5")),
        help="seconds without a push before a client reads as down (MARS_GATEWAY_TTL)",
    )
    p.add_argument("--version", action="version", version=__version__)
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse(argv)
    try:
        keys = KeyStore(args.keys, os.environ.get("MARS_PUSH_KEYS", ""))
    except ValueError as e:
        print(f"mars-gateway: {e}", file=sys.stderr)
        return 2
    server = serve(args.host, args.port, handler(keys, Board(args.ttl)))
    print(
        f"mars-gateway {__version__}: {len(keys.all())} keys, "
        f"port {server.server_address[1]}, keys in {args.keys}",
        file=sys.stderr,
        flush=True,
    )
    # As PID 1 in a container, Python would ignore SIGTERM and `docker stop` would wait 10 s.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    with contextlib.suppress(KeyboardInterrupt, SystemExit):
        server.serve_forever()
    server.server_close()
    return 0
