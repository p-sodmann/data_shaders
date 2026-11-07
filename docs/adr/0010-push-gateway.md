# ADR-0010: Clients push to MARS through a gateway, with keys

Status: accepted · 2026-11-07 (step 14). Changes [ADR-0002](0002-prometheus-backend.md)
(Prometheus no longer reaches every client) and the resolved question *Remote servers: pull*.

## Context

Until now Prometheus pulled: it scraped every probe's and agent's `/metrics` once a second.
That needs a list of targets on the MARS machine (`deploy/site/targets/*.yml`), an open port on
every client, and a route from the MARS machine to each client, which fails for hosts behind
NAT, in another network or on a laptop that moves. The user asked (2026-11-07) for clients to
push instead, with an API key made in the web interface. Login to the web interface comes
separately, later.

Ways to push into Prometheus:

1. **Remote write** straight into Prometheus (`--web.enable-remote-write-receiver`). Needs
   protobuf and snappy in every client, and remote-written series get no staleness markers: a
   host that stops pushing keeps its last value for 5 minutes, so its lamp wouldn't go dark.
2. **Pushgateway** (the Prometheus project's). No keys, and it keeps the last push forever, so
   a dead client looks alive.
3. **A small gateway of our own** that checks keys and serves the latest push of each client to
   Prometheus as one scrape target, dropping a client that stops pushing.

## Decision

- **Option 3: `mars-gateway`** (`gateway/`, image `mars-gateway`, port 9111), Python with
  `prometheus-client` for the parsers and encoders. It runs in both compose files next to
  Prometheus, without a published port in prod.
  - `POST /push/<instance>` with `Authorization: Bearer <key>`: the body is the text format
    (0.0.4, what mars-agent writes) or OpenMetrics (what mars-probe writes, for exemplars).
    It replaces that client's last push. Only `mars_*` families are kept, at most 20 000 samples
    a push, 4 MiB a body; pushed timestamps are dropped.
  - `GET /metrics`: every client that pushed in the last `MARS_GATEWAY_TTL` (5 s) seconds,
    families merged by name, plus `mars_push_up{station, instance}`, 1 while a client pushes
    and 0 for an hour after it stopped (or its key was revoked).
  - `GET/POST /api/keys`, `DELETE /api/keys/<id>`: list, make and revoke keys.
- **A key belongs to one station.** The gateway sets `station` on every pushed sample from the
  key, whatever the client sent, and `instance` from the URL (default the client's host name).
  So a key can only write into its own station, and an agent needs no `MARS_STATION`.
- **Keys** are `mars_` + 32 random URL-safe characters, shown once when made; the gateway keeps
  their SHA-256 in `/data/keys.json` (volume `gateway-data`). `MARS_PUSH_KEYS`
  (`<station>:<key>` pairs) adds keys from the environment that the display can't revoke; the
  demo uses them.
- **Caddy** forwards `/push/*` and `/api/keys*` to the gateway on the display's own origin.
  `MARS_BASIC_AUTH` covers `/api/keys` and leaves `/push/*` out, since pushes carry their own
  key. Key creation takes `application/json` only, so a cross-site form can't make a key in a
  logged-in browser.
- **Prometheus** scrapes the gateway in a job of its own (`mars-push`, `honor_labels: true`).
  The `mars` file-SD job stays, so pulled clients keep working; a client either pushes or is
  pulled, not both.
- **Liveness:** `mars:node_up` gains a second term for pushed nodes,
  `last_over_time(mars_push_up[1h]) * on (job) group_left max by (job) (up)`: a client that
  stops reads 0 after the TTL, and every pushed node reads 0 when the gateway itself is down.
- **Clients:** `mars-agent` pushes when `MARS_PUSH_URL` and `MARS_PUSH_KEY` are set and then
  opens no port; `mars-probe` pushes from a daemon thread with `instrument(…, push_url=…,
  push_key=…)` or the same variables. Both push once a second on a fixed schedule, back off to
  10 s while the gateway can't be reached, and log only changes.
- **Display:** a *Keys* key on the service panel opens the keys plate: the keys, the clients
  pushing with each (live or not, last push), *Make key* with a station picker, and the token
  of a new key once, with what to paste on a host or an app. Revoke takes two presses.

## Consequences

- A client needs only an outgoing connection to the display's port 8080. No target files, no
  open ports on hosts, no DNS from the MARS machine to the clients.
- The display machine must be reachable from every client, and `/push` is open to anyone who
  can reach port 8080 and holds a key. Over the internet, put TLS in front (keys travel in a
  header).
- One gateway, one process: each push is parsed in Python. A few dozen clients at one push a
  second are fine; hundreds would want a faster gateway or remote write.
- Until the web interface has a login, anyone on the LAN can make and revoke keys at
  `/api/keys`, unless `MARS_BASIC_AUTH` is on.
- Exemplars survive (OpenMetrics in and out), so the trace and the sampled requests still work.
- `instance` is now a host name (`web-1`) for pushed nodes, not `host:port`. A client that
  changes from pull to push becomes a new node; the old one reads offline until a reload, and
  0 for an hour in Prometheus.
- The demo stack pushes: all three demo clients go through Caddy with keys from
  `MARS_PUSH_KEYS`, and `deploy/prometheus/targets/demo.yml` is gone.
