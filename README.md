# MARS · Monitor Any Remote System

A cassette-futurist monitoring display for a spare screen: a Braun-style device whose screens
are CRT phosphor shaders, fed by real server metrics.

```
FastAPI app + mars-probe  ──►  Prometheus (recording rules)  ──►  MARS web app
  (Python, probe/)               (deploy/)                          (web/)
```

The probe instruments a service, Prometheus scrapes it and pre-computes the signals the
instruments need, and the display reads them. Without a backend the display runs on its
built-in simulator.

## Layout

```
web/            MARS display (Vite + React + WebGL2)        → web/README.md
probe/          mars-probe Python package                   → probe/README.md
examples/demo/  demo FastAPI service + load generator       → examples/demo/README.md
deploy/         docker compose, Prometheus config           → deploy/README.md
docs/           plan: steps, ADRs, open questions           → docs/README.md
```

## Run the display

```bash
cd web && npm i && npm run dev
```

Open the printed URL and press `F` for fullscreen. `npm run smoke` in `web/` is the headless
regression check (pages 1–5, console errors, module headers, screenshots in `web/snapshots/`).
Keys, URL parameters and the instrument reference are in [web/README.md](web/README.md).

## Run the demo service

```bash
cd examples/demo && uv sync
MARS_STATION=api uv run uvicorn demo.app:app --port 8001 &
LOADGEN_TARGETS=http://localhost:8001 uv run python -m demo.loadgen
```

Two stations, the chaos API and the Docker image are in
[examples/demo/README.md](examples/demo/README.md).

## Run the whole stack

```bash
docker compose -f deploy/compose.yaml --profile demo up -d --build
```

This starts Prometheus, two demo stations (`api`, `search`), the load generator and MARS.
Open <http://localhost:8080>. Prometheus is on <http://localhost:9090> (this machine only).
Without `--profile demo` only MARS and Prometheus start, for your own servers. Adding a
server, ports and troubleshooting are in [deploy/README.md](deploy/README.md).

The display reads both demo stations from Prometheus ([deploy/config/mars.json](deploy/config/mars.json)):
pages 1–5 are the standard pages for `api`, page 6 shows both stations, and page 7 (*Fleet*)
shows every station at once. Without Docker, `cd web && npm run dev` runs on the built-in
simulator.

## Docs

- [docs/README.md](docs/README.md): the step table and the rules for implementing a step
- [docs/adr/](docs/adr/): architecture decisions (binding contracts)
- [docs/open-questions.md](docs/open-questions.md): what is still undecided
