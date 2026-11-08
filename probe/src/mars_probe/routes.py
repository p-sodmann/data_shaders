"""Route templates, with the prefixes of mounted sub-apps joined in.

The router mutates the request scope in place on the way down, so after the response the
scope says which leaf handled the request:

- `scope["route"]`: written by FastAPI's routes, and by Starlette's own router only in recent
  1.x releases. It's the innermost route, whose `path` lacks any mount prefix.
- `scope["endpoint"]`: written by every Starlette version. Used when there's no route.

Either way we need the full template, so we walk the app's route tree once to map every leaf
to its prefixed template, and walk again only when we meet something we haven't seen (routes
added after startup).
"""

from __future__ import annotations

import re

from starlette.routing import Host, Mount, compile_path

UNMATCHED = "<unmatched>"


def _template_pattern(template: str) -> re.Pattern:
    # A mount and its child may reuse a parameter name. Their individual regexes are valid,
    # but joining them would repeat a named capture group; only the converters matter here.
    position = 0

    def unique(match):
        nonlocal position
        position += 1
        return "{p" + str(position) + (match[1] or "") + "}"

    path = re.sub(r"\{[a-zA-Z_][a-zA-Z0-9_]*(:[a-zA-Z_][a-zA-Z0-9_]*)?\}", unique, template)
    return compile_path(path)[0]


class _Tree:
    def __init__(self, app):
        # Both keyed by id(): Starlette routes define __eq__ and so aren't hashable. The object
        # itself is kept alongside to rule out id reuse.
        self.by_route: dict[int, list[tuple[object, object, str]]] = {}
        self.patterns: dict[str, re.Pattern] = {}
        self.by_endpoint: dict[int, list[tuple[object, object, str]]] = {}
        self._walk(getattr(app, "routes", ()), "")

    def _add(self, route, endpoint, template: str) -> None:
        self.by_route.setdefault(id(route), []).append((endpoint, route, template))
        if template != UNMATCHED and template not in self.patterns:
            self.patterns[template] = _template_pattern(template)
        if endpoint is not None:
            self.by_endpoint.setdefault(id(endpoint), []).append((endpoint, route, template))

    def _walk(self, routes, prefix: str) -> None:
        for r in routes:
            if isinstance(r, Mount):
                path = prefix + r.path
                sub = r.routes
                # A mount of a router (sub-app) has its own leaves; a mount of a plain ASGI app
                # (StaticFiles, ...) is a leaf itself. Ending on a router mount means nothing
                # inside it matched.
                self._add(r, r.app, UNMATCHED if sub else path)
                self._walk(sub, path)
            elif isinstance(r, Host):
                self._walk(r.routes, prefix)
            else:
                self._add(r, getattr(r, "endpoint", None), prefix + getattr(r, "path", ""))


def _inner_path(scope) -> str:
    # The path as the innermost router saw it: mounts append to root_path on the way down.
    path, root = scope["path"], scope.get("root_path", "")
    return path[len(root) :] if root and path.startswith(root) else path


class RouteTemplates:
    def __init__(self):
        self._tree: _Tree | None = None

    def resolve(self, app, scope, path: str | None = None) -> str:
        found = self._lookup(scope, path)
        if found is None:
            self._tree = _Tree(app)
            found = self._lookup(scope, path)
        if found is None:
            # Not reachable from the top-level app (a router built per request?). The route's
            # own template is still better than the raw path.
            route = scope.get("route")
            return getattr(route, "path", None) or UNMATCHED
        return found

    def _lookup(self, scope, path: str | None = None) -> str | None:
        route = scope.get("route")
        endpoint = scope.get("endpoint")
        if route is None and endpoint is None:
            return UNMATCHED
        tree = self._tree
        if tree is None:
            return None
        if route is not None:
            candidates = [c for c in tree.by_route.get(id(route), ()) if c[1] is route]
        else:
            candidates = [c for c in tree.by_endpoint.get(id(endpoint), ()) if c[0] is endpoint]
        if len(candidates) == 1:
            return candidates[0][2]
        # The same route object can appear below several mounts. Match its full template
        # against the path captured before mounts rewrote the request scope.
        request_path = path if path is not None else scope["path"]
        for _, _, template in candidates:
            regex = tree.patterns.get(template)
            if regex is not None and regex.match(request_path):
                return template
        # Older Starlette exposes only the endpoint and may supply an inner path.
        inner = _inner_path(scope)
        for _, r, template in candidates:
            regex = getattr(r, "path_regex", None)
            if regex is not None and regex.match(inner):
                return template
        return None
