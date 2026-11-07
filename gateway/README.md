# mars-gateway

Takes metrics that [mars-agent](../agent/README.md) and [mars-probe](../probe/README.md) push,
checks each client's key, and serves the latest push of every client to Prometheus as one
scrape target ([ADR-0010](../docs/adr/0010-push-gateway.md)). It runs in both compose files in
[deploy/](../deploy/README.md); the display reaches it through Caddy, so clients push to the
display's own address.

## How it works

- A **key** belongs to one station. Make one on the display (`E` → **Keys** → *Make key*); the
  token is shown once. Every sample pushed with it gets that `station`, whatever the client
  sent, and `instance` from the push URL.
- A client `POST`s its metrics once a second to `http://<mars>:8080/push/<instance>` with
  `Authorization: Bearer <key>`, in the Prometheus text format or OpenMetrics. Only `mars_*`
  families are kept.
- Prometheus scrapes `mars-gateway:9111/metrics` once a second (job `mars-push`). A client that
  hasn't pushed for 5 s is left out, so its series go stale and its lamp goes dark;
  `mars_push_up{station, instance}` reads 0 for it for an hour.

## API

| | | |
|---|---|---|
| `POST /push/<instance>` | `Authorization: Bearer <key>`, body in the text format or OpenMetrics | `204`; `401` unknown key; `400` bad body or instance name; `413` over 4 MiB |
| `GET /metrics` | for Prometheus, over the compose network only | |
| `GET /api/keys` | the keys (never their tokens) and the clients pushing with each | |
| `POST /api/keys` | `{"name": "web hosts", "station": "web"}`, `Content-Type: application/json` | `201` `{key, token}` |
| `DELETE /api/keys/<id>` | revoke; its clients read as down at once | `204`; `404` for an unknown key or one from `MARS_PUSH_KEYS` |
| `GET /healthz` | | |

Caddy forwards `/push/*` and `/api/keys*`. With `MARS_BASIC_AUTH` on, `/api/keys` asks for the
password and `/push/*` doesn't (the key is its password).

Push by hand, for a test:

```bash
printf 'mars_info{version="test"} 1\n' | curl -X POST --data-binary @- \
  -H "Authorization: Bearer $KEY" http://localhost:8080/push/my-laptop
```

## Settings

| Variable | Option | Default | |
|---|---|---|---|
| `MARS_PUSH_KEYS` | | – | keys from the environment, `<station>:<key>` pairs separated by spaces or commas (keys of 8+ characters); not revocable from the display |
| `MARS_GATEWAY_KEYS` | `--keys` | `/data/keys.json` | where the keys made on the display are kept (their SHA-256 only) |
| `MARS_GATEWAY_TTL` | `--ttl` | `5` | seconds without a push before a client reads as down |
| `MARS_GATEWAY_PORT` | `--port` | `9111` | |
| `MARS_GATEWAY_HOST` | `--host` | every address | |

## Develop

```bash
cd gateway
uv run pytest -q && uv run ruff check . && uv run ruff format --check .
```
