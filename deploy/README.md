# deploy: run MARS with Docker Compose

Two compose files ([ADR-0004](../docs/adr/0004-docker-compose.md)):

- [compose.yaml](compose.yaml) builds from this checkout and has the demo (profile `demo`).
  Use it to try MARS and to develop it.
- [compose.prod.yaml](compose.prod.yaml) runs the released images for your own servers: no
  demo, Prometheus not published, your files in [site/](site/).

| Service | What | Port |
|---|---|---|
| `mars` | the display ([web/Dockerfile](../web/Dockerfile)); Caddy serves it, proxies `/prom/*` to Prometheus and serves `/config/` | `8080` |
| `mars-gateway` | [mars-gateway](../gateway/README.md): checks push keys, serves every client's latest push to Prometheus ([ADR-0010](../docs/adr/0010-push-gateway.md)); reached through `mars` at `/push` and `/api/keys` | `127.0.0.1:9111` (demo file), none (prod) |
| `prometheus` | `prom/prometheus:v3.16.0`, 1 s scrape and rules, exemplars, 35 d retention | `127.0.0.1:9090` (demo file), none (prod) |
| `demo-api`, `demo-search` | the [demo service](../examples/demo/README.md) as two stations, pushing with demo keys (profile `demo`) | – |
| `loadgen` | traffic for both, with a 10-minute "day" (profile `demo`) | – |
| `demo-host` | [mars-agent](../agent/README.md) as station `fleet`, reporting the Docker/Podman VM, pushing (profile `demo`) | – |

Commands below run from the repo root. Podman works too, see [Troubleshooting](#troubleshooting).

## Demo

```bash
docker compose -f deploy/compose.yaml --profile demo up -d --build
```

Open <http://localhost:8080>. After about 15 s the recording rules have data:

```bash
curl -s localhost:8080/prom/api/v1/query --data-urlencode 'query=mars:throughput_rps'
```

The display loads [config/mars.json](config/mars.json): both demo stations read from Prometheus,
the five standard pages for `api`, a mixed page 6 for both, and page 7 *Fleet* with the
cross-station instruments. On a reload the tape is filled from Prometheus for as long as the
stack has run (up to 4 h).

Things to try:

```bash
docker compose -f deploy/compose.yaml stop demo-search     # its node lamp goes offline, then STALE after 10 s
docker compose -f deploy/compose.yaml start demo-search
docker compose -f deploy/compose.yaml exec demo-api python -c "import urllib.request as u; \
  u.urlopen(u.Request('http://localhost:8000/_chaos', b'{\"error_rate\": 0.2}', \
  {'Content-Type': 'application/json'}))"                   # 20 % 5xx on api for 2 minutes
docker compose -f deploy/compose.yaml --profile demo down      # add -v to drop the data too
```

`demo-host` reports the VM the containers run in as a one-node fleet. To see it, open
<http://localhost:8080/?config=/examples/linux-fleet.json> (pages Fleet, Nodes, Signal,
Almanac). The load comes mostly from the VM's disk use.

## Your own servers

```bash
docker compose -f deploy/compose.prod.yaml pull     # the released multi-arch images
docker compose -f deploy/compose.prod.yaml up -d
```

`mars` is pinned to `ghcr.io/p-sodmann/mars-web:<version>` (amd64 and arm64). Without
`pull`, or before that version is published (then `pull` reports 403 or "not found"), `up`
builds the same image from this checkout.
Clients **push** to MARS with a key ([ADR-0010](../docs/adr/0010-push-gateway.md)): nothing
on the MARS machine needs to know their addresses, and they need no open port.

To add a server:

1. Make a key on the display: press `E`, then **Keys**, name it, pick or type its station
   (`shop`), **Make key**, and copy the key (it is shown once).
2. Instrument the app with [mars-probe](../probe/README.md) (`instrument(app, station="shop")`)
   and start it with `MARS_PUSH_URL=http://<mars>:8080` and `MARS_PUSH_KEY=<key>`. It pushes
   once a second and shows up on the keys plate under its host name.
3. Press **Stations** on the service panel: `shop` is listed under *Available on Prometheus*,
   and **Add** puts it on the device (with its standard pages if you like). See
   [web/README.md](../web/README.md#stations-and-cartridges).

The keys live in the `gateway-data` volume (their SHA-256 only). Keys can also come from the
environment, `MARS_PUSH_KEYS='shop:<key> web:<key>'`; those can't be revoked from the display.

Your files live in [site/](site/), which the prod file mounts:

| Path | Mounted at | |
|---|---|---|
| `site/targets/*.yml` | `/etc/prometheus/targets` | clients Prometheus pulls instead, one file per server; picked up live |
| `site/config/` | `/config` (the `mars` container) | config documents; optional, may stay empty |

To have Prometheus **pull** a server instead (it then serves `/metrics` and doesn't push):

```bash
mars-probe scrape-config --target shop.lan:8000 > deploy/site/targets/shop.yml
```

The Prometheus container must reach `shop.lan:8000` (DNS, firewall; see
[Remote servers](#remote-servers)). A server on the Docker host itself is
`host.docker.internal:8000`; the prod file maps that name on Linux too.

The display saves what you add in its own browser (localStorage). To give every display the
same stations and pages, export the document from the service panel (cartridge keys) and save
it as `site/config/mars.json`: a display without its own saved copy loads it.

Prometheus has no published port in the prod file. To look at its targets:

```bash
docker compose -f deploy/compose.prod.yaml exec prometheus wget -qO- localhost:9090/api/v1/targets
curl -s localhost:8080/prom/api/v1/targets          # the same, through MARS
```

### Linux hosts

[mars-agent](../agent/README.md) turns a Linux host into a node of a station, from `/proc`
([ADR-0009](../docs/adr/0009-linux-hosts.md)). Make a key for the station `fleet`, put
`MARS_PUSH_URL` and `MARS_PUSH_KEY` in `agent/.env` on each host and start it with
`docker compose -f agent/compose.yaml up -d`, and load
[web/public/examples/linux-fleet.json](../web/public/examples/linux-fleet.json) (`?config=` or
as `site/config/mars.json`). A host station must not share its name with a service.

### Remote servers

Pushing clients connect out to MARS's port 8080 and nothing connects back, so they work from
behind NAT and from other networks as long as they reach that port.

- **Firewall:** on the MARS machine, open 8080 to the clients' network, for example
  `ufw allow from 192.168.1.0/24 to any port 8080 proto tcp`.
- **Over the internet:** put MARS behind a reverse proxy with TLS, since the key travels in a
  header, and set `MARS_PUSH_URL=https://mars.example.com`. Turn on `MARS_BASIC_AUTH` so only
  you reach the display and `/api/keys`; `/push` stays open to holders of a key.
- **Pulled clients:** Prometheus connects to each server's `/metrics`. Open the app's port to
  the MARS host only. To scrape across the internet, put the metrics behind TLS and basic auth
  and add a second job to [prometheus/prometheus.yml](prometheus/prometheus.yml) (keep
  `honor_labels: true`):

  ```yaml
  - job_name: mars-remote
    honor_labels: true
    scheme: https
    basic_auth:
      username: mars
      password_file: /etc/prometheus/targets/remote.password
    file_sd_configs:
      - files: [/etc/prometheus/targets/remote/*.yml]
  ```

  and reload: `docker compose -f deploy/compose.prod.yaml restart prometheus`.

## Security

- **LAN only by default.** Port `8080` is published on all interfaces so a display on the LAN
  can open it, and without `MARS_BASIC_AUTH` it has no authentication. `/prom/*` is the
  Prometheus API (read-only: Caddy answers 403 to `/-/reload` and `/-/quit`). `/api/keys` makes
  and revokes push keys: without auth, anyone on the LAN can do that.
- **Push keys.** `/push/*` takes a client's metrics with `Authorization: Bearer <key>`. A key
  writes only into its own station, only `mars_*` series, at most 20 000 samples and 4 MiB a
  push. Revoking a key on the keys plate stops its clients at once. Key creation accepts JSON
  only, so a cross-site form can't make a key in a logged-in browser. Don't forward
  8080 from the internet without auth and TLS in front.
- **mars-gateway** is published on loopback only in the demo file (`127.0.0.1:9111`, for
  `npm run dev`) and not at all in the prod file.
- **Prometheus** is published on loopback only in the demo file (`127.0.0.1:9090`, for
  `npm run dev`) and not at all in the prod file; MARS reaches it over the compose network.
- **Basic auth.** Set `MARS_BASIC_AUTH` to `<user> <bcrypt hash>` and every path, `/prom`,
  `/api/keys` and `/config` included, asks for a password. Only `/healthz` (the healthcheck)
  and `/push/*` (which checks its own key) stay open. Make a
  hash, and base64-encode it so it has no `$` for the shell or Compose to expand:

  ```bash
  docker run --rm caddy:2-alpine caddy hash-password --plaintext 'your password' | base64
  export MARS_BASIC_AUTH='ops JDJhJDE0JE…'           # user "ops", the base64 output
  docker compose -f deploy/compose.prod.yaml up -d
  ```

  Or put `MARS_BASIC_AUTH='ops JDJhJDE0JE…'` in `deploy/.env`. A plain `$2a$14$…` hash works
  too, written as `$$2a$$14$$…` in a compose file. The container refuses to start if the value
  isn't two words. Basic auth sends the password with every request, so outside a trusted
  network put TLS in front (a reverse proxy with a certificate).
- **No TLS in the stack.** Caddy runs with `auto_https off` on a LAN port. For TLS, put MARS
  behind your existing reverse proxy, or change the site address in
  [web/Caddyfile](../web/Caddyfile) to a domain name and publish 443.
- **Config documents** under `/config/` are read-only over HTTP (Caddy's `file_server`); they
  change only on disk. A shared write path is an open question.

## Images

`scripts/build-images.sh` builds `mars-web`, `mars-demo`, `mars-agent` and `mars-gateway` for linux/amd64 and linux/arm64
(Raspberry Pi 4/5) with `docker buildx` or Podman, tagged with the version from
[probe/src/mars_probe/_version.py](../probe/src/mars_probe/_version.py); `--push` pushes them
to `$REGISTRY` (default `ghcr.io/p-sodmann`). A `v*` tag does the same in CI
([release.yml](../.github/workflows/release.yml)). The web image's build stage runs on the
build machine's own platform, since its output doesn't depend on the CPU.

## Files

- [compose.yaml](compose.yaml), [compose.prod.yaml](compose.prod.yaml): the services above.
- [prometheus/prometheus.yml](prometheus/prometheus.yml): 1 s intervals, job `mars-push`
  (the gateway) and job `mars` with file service discovery on `targets/*.yml`, both with
  `honor_labels: true`.
- [prometheus/targets/](prometheus/targets/): the demo file's pulled targets. Empty: the demo
  clients push.
- [site/](site/): your targets and config for the prod file.
- The recording rules are **not** in this folder: both files mount
  [probe/src/mars_probe/prometheus/](../probe/src/mars_probe/prometheus/mars.rules.yml), the
  only copy ([ADR-0003](../docs/adr/0003-metric-contract.md)). After editing them, reload
  without a restart: `curl -X POST localhost:9090/-/reload` (demo file).
- [config/](config/): mounted at `/config` by the demo file and served at
  `localhost:8080/config/` without caching. [config/mars.json](config/mars.json) is the
  document for the demo stations ([ADR-0005](../docs/adr/0005-config-document.md)). A display
  that has saved a document in localStorage keeps using that one. `/config/` itself answers 404
  (no listing).
- [KIOSK.md](KIOSK.md): a Raspberry Pi 5 or mini PC as a wall display.

## Troubleshooting

- **Podman.** `podman compose` needs a provider (`docker-compose` or `podman-compose`) on the
  `PATH`; `podman-compose -f deploy/compose.yaml --profile demo up -d --build` works as well.
  Build first and start second (`podman compose -f deploy/compose.yaml --profile demo build`,
  then `… up -d`): with `up --build`, podman-compose builds the demo image for three services
  in parallel, and those builds can hang (seen in step 12).
- **Image builds hang or fail on Podman (macOS, Windows)** with `npm error Exit handler never
  called!` or `uv` unable to reach PyPI: the Podman machine kept the DNS set-up of the network
  it was started on. After changing networks, restart it:
  `podman machine stop && podman machine start`.
- **A client doesn't show up on the keys plate.** Read its log: `401` is a wrong or revoked
  key; `connection refused` or a timeout means it can't reach port 8080 (address, firewall).
  `curl http://<mars>:8080/healthz` from the client must answer `ok`.
- **No `mars:*` series.** Look at the targets (`/prom/api/v1/targets`, or
  <http://localhost:9090/targets> with the demo file) and the rules. Latency and ratio rules are
  absent while a station gets no requests; throughput reads 0.
- **A target is down** with `connection refused` on `host.docker.internal`: the app listens on
  `127.0.0.1` only. Start uvicorn with `--host 0.0.0.0`.
- **`CLOCK SKEW … PROMETHEUS`** in the event log: the clocks of the display's machine and
  Prometheus's differ by more than 2 s. On macOS and Windows that is usually the Podman or
  Docker VM after the host slept; restarting the VM (`podman machine stop && podman machine
  start`) resyncs it. On a server, run NTP on both machines.
- **Rule tests:** `bash probe/scripts/test-rules.sh`.
