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
probe/          mars-probe Python package                   (step 01)
examples/demo/  demo FastAPI service + load generator       (step 02)
deploy/         docker compose, Prometheus config, Caddy    (step 03)
docs/           plan: steps, ADRs, open questions           → docs/README.md
```

## Run the display

```bash
cd web && npm i && npm run dev
```

Open the printed URL and press `F` for fullscreen. `npm run smoke` in `web/` is the headless
regression check (pages 1–5, console errors, module headers, screenshots in `web/snapshots/`).
Keys, URL parameters and the instrument reference are in [web/README.md](web/README.md).

## Run the whole stack

_Placeholder: the Docker Compose stack (`docker compose -f deploy/compose.yaml up`) arrives in
step 03._

## Docs

- [docs/README.md](docs/README.md): the step table and the rules for implementing a step
- [docs/adr/](docs/adr/): architecture decisions (binding contracts)
- [docs/open-questions.md](docs/open-questions.md): what is still undecided
