"""The /metrics endpoint as a tiny ASGI app."""

from __future__ import annotations

from prometheus_client.exposition import choose_encoder


class MetricsApp:
    """Serves a registry. OpenMetrics when the scraper asks for it (Prometheus does, and only
    OpenMetrics carries exemplars), the classic text format otherwise."""

    def __init__(self, registry):
        self.registry = registry

    async def __call__(self, scope, receive, send):
        accept = ""
        for name, value in scope.get("headers", ()):
            if name == b"accept":
                accept = value.decode("latin-1")
                break
        encoder, content_type = choose_encoder(accept)
        body = encoder(self.registry)
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [
                    (b"content-type", content_type.encode("latin-1")),
                    (b"content-length", str(len(body)).encode("latin-1")),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
