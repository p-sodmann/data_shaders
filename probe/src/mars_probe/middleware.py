"""Pure ASGI middleware: one histogram observation per HTTP request.

Pure ASGI rather than BaseHTTPMiddleware, so streaming responses and background tasks behave
exactly as without the probe. The request is timed by wrapping `send`: the clock stops when the
last body chunk has been handed to the server, not when the app returns, so background tasks
don't count towards request latency.
"""

from __future__ import annotations

from time import perf_counter

from . import stages
from .routes import RouteTemplates

CODE_CLASSES = {c: f"{c}xx" for c in (2, 3, 4, 5)}


def code_class(status: int) -> str:
    # ADR-0003 only knows 2xx–5xx. 1xx never ends an HTTP response here; fold it into 2xx.
    return CODE_CLASSES.get(status // 100, "2xx" if status < 200 else "5xx")


def route_path(scope) -> str:
    """The request path without the server's root_path, as the app's routes see it."""
    path = scope["path"]
    root = scope.get("root_path", "")
    if root and path.startswith(root):
        return path[len(root) :] or "/"
    return path


class MarsMiddleware:
    def __init__(self, app, probe):
        self.app = app
        self.probe = probe
        self.routes = RouteTemplates()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            # websocket and lifespan pass straight through.
            await self.app(scope, receive, send)
            return

        probe = self.probe
        path = route_path(scope)
        if probe.metrics_path is not None and path == probe.metrics_path:
            # Served here rather than as a route, so a catch-all route can't shadow it.
            await probe.metrics_app(scope, receive, send)
            return
        if path in probe.exclude_paths:
            await self.app(scope, receive, send)
            return

        start = perf_counter()
        # Mounted sub-apps overwrite scope["app"]; route templates are resolved from the top.
        root_app = scope.get("app")
        status = 0
        done = False

        def finish(cls: str) -> None:
            nonlocal done
            if done:
                return
            done = True
            elapsed = perf_counter() - start
            probe.in_flight.dec()
            # The routers have written into scope by now (it's the same dict all the way down).
            route = self.routes.resolve(root_app, scope)
            method = scope["method"].upper()
            region, rtt = probe.resolve_region(scope)
            probe.observe_request(route, method, cls, region, elapsed, status or 500)
            if rtt is not None:
                probe.observe_rtt(region, rtt)

        async def send_wrapper(message):
            nonlocal status
            kind = message["type"]
            if kind == "http.response.start":
                status = message["status"]
            await send(message)
            if kind == "http.response.body" and not message.get("more_body", False):
                finish(code_class(status))

        probe.in_flight.inc()
        token = stages.enter(probe)
        try:
            await self.app(scope, receive, send_wrapper)
        except BaseException:
            finish("5xx")
            raise
        else:
            # Returned without completing a response: the server will answer 500.
            finish("5xx")
        finally:
            stages.leave(token)
