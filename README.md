# MARS · Monitor Any Remote System

A cassette-futurist monitoring display for a spare screen: a Braun-style device whose screens
are CRT phosphor shaders, fed by the metrics of your own FastAPI servers.

```
FastAPI app + mars-probe  ──►  Prometheus (recording rules)  ──►  MARS web app
  (Python, probe/)               (deploy/)                          (web/)
Linux host + mars-agent   ──►
  (agent/)
```

The probe instruments a service, Prometheus scrapes it and pre-computes the signals the
instruments need, and the display reads them. Without a backend the display runs on its
built-in simulator.

## Quick start

Needs Docker with Compose v2. With Podman and `podman-compose`, run the last command as
`podman compose -f deploy/compose.yaml --profile demo build` and then `… up -d`: a single
`up --build` builds the demo image three times in parallel and can hang
([troubleshooting](deploy/README.md#troubleshooting)).

```bash
git clone https://github.com/p-sodmann/data_shaders.git mars
cd mars
docker compose -f deploy/compose.yaml --profile demo up -d --build
```

Open <http://localhost:8080> and press `F` for fullscreen. This runs Prometheus, two demo
stations (`api`, `search`) with a load generator, and MARS. The data starts after about 15 s,
and the daily swing is compressed into 10 minutes. `docker compose -f deploy/compose.yaml
--profile demo down` stops it.

## The pages

The demo's [config document](deploy/config/mars.json) has the five standard pages for `api`, a
page for both stations and one for every station. Keys `1`–`7` switch between them, and `E`
opens the service panel for editing pages and stations.

| | |
|---|---|
| [![Tape](docs/img/page-1.jpg)](docs/img/page-1.jpg) **1 Tape**: four hours of P50 as a tape archive, load, nodes, the readouts and the event log | [![Orbit](docs/img/page-2.jpg)](docs/img/page-2.jpg) **2 Orbit**: service topology, per-node latency, the request pipeline by stage, caution & warning rules, sampled requests |
| [![Sweep](docs/img/page-3.jpg)](docs/img/page-3.jpg) **3 Sweep**: routes against their SLOs on a radar, and where the traffic comes from on a world map | [![Signal](docs/img/page-4.jpg)](docs/img/page-4.jpg) **4 Signal**: latency spectrum and waterfall, latency against load, correlations, rhythms such as a batch job |
| [![Almanac](docs/img/page-5.jpg)](docs/img/page-5.jpg) **5 Almanac**: 30 days: the week dial, habits, error budget, burn rate, logbook | [![Twin](docs/img/page-6.jpg)](docs/img/page-6.jpg) **6 Twin**: two stations side by side on one page |
| [![Fleet](docs/img/page-7.jpg)](docs/img/page-7.jpg) **7 Fleet**: every station at once: board, radar, strands and a shared log | |

Every instrument is described in [web/README.md](web/README.md).

## Monitor your own FastAPI server

From the cloned repo, with the demo stopped. Your app needs Python 3.11 or newer and runs as a
single uvicorn process.

1. **Install the probe** in your app's environment (it isn't on PyPI yet):

   ```bash
   pip install "mars-probe @ git+https://github.com/p-sodmann/data_shaders#subdirectory=probe"
   ```

2. **Instrument the app.** One call adds the middleware and serves `/metrics`:

   ```python
   from fastapi import FastAPI
   from mars_probe import instrument

   app = FastAPI()
   instrument(app, station="hello")  # lower case, digits and dashes


   @app.get("/")
   def hello():
       return {"hello": "world"}
   ```

3. **Run it** where Prometheus can reach it: `uvicorn main:app --host 0.0.0.0 --port 8000`.
   `curl localhost:8000/metrics` should list `mars_info{station="hello",…}`.

4. **Tell Prometheus** about it with a target file (picked up without a restart):

   ```bash
   mars-probe scrape-config --target host.docker.internal:8000 > deploy/site/targets/hello.yml
   ```

   `host.docker.internal` is the machine running Docker. For a server elsewhere, use its
   address (`shop.lan:8000`) and open that port to the MARS host only.

5. **Start MARS and add the station:**

   ```bash
   docker compose -f deploy/compose.prod.yaml up -d
   ```

   Open <http://localhost:8080>, send your app a few requests, press `E`, then **Stations**:
   `hello` is listed under *Available on Prometheus*. **Add** puts it on the device, together
   with its five standard pages if you like.

## Monitor a fleet of Linux hosts

New to all of this? The [step-by-step tutorial](docs/tutorial-linux-fleet.md) starts from
installing Docker. The short version:

Run [mars-agent](agent/README.md) on every host with the same station name, list the hosts in
a target file, and load the fleet example:

```bash
MARS_STATION=fleet docker compose -f agent/compose.yaml up -d      # on each host
echo '- targets: ["web-1.lan:9110", "web-2.lan:9110"]' > deploy/site/targets/fleet.yml
```

Then open <http://localhost:8080/?config=/examples/linux-fleet.json>. Each host is a node of
station `fleet`: a lamp, a strand and a slice. The latency slot shows how long work waits for a
CPU, throughput is packets per second, errors are memory stalls, and load is the fullest of CPU,
memory and disk ([ADR-0009](docs/adr/0009-linux-hosts.md)). The demo stack runs one agent too,
so the example works there as well.

Stages, custom signals and client regions are in [probe/README.md](probe/README.md). Several
servers, a shared config for all displays, basic auth and the security notes are in
[deploy/README.md](deploy/README.md). A Raspberry Pi as a wall display:
[deploy/KIOSK.md](deploy/KIOSK.md).

## Repository

```
web/            MARS display (Vite + React + WebGL2)        → web/README.md
probe/          mars-probe Python package                   → probe/README.md
agent/          mars-agent: Linux hosts as fleet nodes      → agent/README.md
examples/demo/  demo FastAPI service + load generator       → examples/demo/README.md
deploy/         Docker Compose, Prometheus config, kiosk    → deploy/README.md, deploy/KIOSK.md
scripts/        check.sh (every check), build-images.sh     
docs/           plan: steps, ADRs, open questions           → docs/README.md
```

Without Docker: `cd web && npm i && npm run dev` runs the display on its simulator; the demo
service runs with `uv` ([examples/demo/README.md](examples/demo/README.md)).

## Develop

```bash
scripts/check.sh
```

runs every check, the same as CI: probe tests and lint, the promtool rule tests, agent and demo tests,
web unit tests and build, the headless smoke test, and the compose files. It needs `uv`,
Node 22, and Docker or Podman (or a local `promtool`). Releases: [CHANGELOG.md](CHANGELOG.md);
a `v*` tag builds the multi-arch images and the probe wheel.

- [docs/README.md](docs/README.md): the step table and the rules for implementing a step
- [docs/adr/](docs/adr/): architecture decisions (binding contracts)
- [docs/open-questions.md](docs/open-questions.md): what is still undecided

MIT licensed, see [LICENSE](LICENSE).
