# MARS documentation

MARS (Monitor Any Remote System) is a cassette-futurist monitoring display for a spare
screen. This folder holds the plan for turning the simulator prototype into a system that
monitors real servers:

```
FastAPI app + mars-probe  ──►  Prometheus (recording rules)  ──►  MARS web app
  (Python, probe/)               (deploy/)                          (web/)
Linux host + mars-agent   ──►
  (agent/)
```

- [steps/](steps/): the implementation packages, one file per agent session, run in order.
- [adr/](adr/): architecture decision records. These are the binding contracts that steps refer to.
- [tutorial-linux-fleet.md](tutorial-linux-fleet.md): a beginner's tutorial for watching Linux
  computers with mars-agent (step 13).
- [open-questions.md](open-questions.md): unresolved questions. Add to it, and resolve
  entries as you go.
- [implementation_prompt.md](implementation_prompt.md): the prompt to paste into a fresh agent
  session to run the next step.

## Target repository layout

```
/
├── web/                 MARS display (Vite + React + WebGL2), moved from the repo root in step 00
├── probe/               mars-probe Python package (FastAPI/ASGI instrumentation)
├── agent/               mars-agent: a Linux host as a node of a station (step 13)
├── examples/demo/       demo FastAPI service + load generator
├── deploy/              docker compose, Prometheus config, Caddy
└── docs/                this folder
```

## Steps

| # | Step | Area | Depends on |
|---|---|---|---|
| 00 | [Monorepo restructure](steps/00-monorepo.md) | repo | – |
| 01 | [Probe core](steps/01-probe-core.md) | probe | 00 |
| 02 | [Demo service and load generator](steps/02-demo-and-loadgen.md) | examples | 01 |
| 03 | [Docker stack and recording rules](steps/03-docker-stack.md) | deploy | 02 |
| 04 | [Station refactor (no global config)](steps/04-station-refactor.md) | web | 00 |
| 05 | [Instrument registry and grid pages](steps/05-registry-and-grid.md) | web | 04 |
| 06 | [Config document and multi-station runtime](steps/06-config-and-multistation.md) | web | 05 |
| 07 | [Prometheus source](steps/07-prometheus-source.md) | web | 03, 06 |
| 08 | [Service panel: layout editing](steps/08-service-panel.md) | web | 06 |
| 09 | [Stations plate and cartridges](steps/09-stations-plate.md) | web | 07, 08 |
| 10 | [Cross-station instruments](steps/10-cross-station-instruments.md) | web | 07 |
| 11 | [Regions and GeoIP](steps/11-regions-geoip.md) | probe, web | 07 |
| 12 | [Release hardening and docs](steps/12-release.md) | all | all |
| 13 | [Linux host agent and fleet example](steps/13-host-agent.md) | agent, probe, web | 12 |

Steps 01–03 (Python and deploy) and 04–06 (web) are independent, so the two tracks can run
in parallel. Step 07 is where they join.

## Rules for an agent running a step

1. Read this file, the step file, and every ADR the step lists under **Read first**.
2. Stay inside the step's scope. If something outside it needs to change, write it down in
   [open-questions.md](open-questions.md) and don't do it.
3. Contracts in ADRs (metric names, recording rules, config schema) are binding. If a
   contract has to change, update the ADR in the same step and say so in the handoff.
4. Every acceptance criterion must be checked. Run the commands under **Verification** and
   paste the relevant output into the handoff.
5. When you finish:
   - set `Status: done` at the top of the step file
   - append a `## Handoff` section with what was built, deviations, anything that
     surprised you, and what the next step should know
   - move any newly answered open questions to the "Resolved" section
   - commit with the message `step NN: <title>`
6. If you make an architectural decision that isn't in an ADR, add a new ADR
   (next free number, using the format of the existing ones).

## Conventions

- Web: plain JS (no TypeScript), React 18, Vite. Match the existing code style: small modules
  and comments that explain *why*.
- Python: 3.11+, managed with `uv`, `pyproject.toml` with hatchling, `ruff` for lint and format,
  `pytest`.
- Keep the design rules: colour is signal only (mint, amber, orange), the housing is a physical
  device, and every screen goes through the shared CRT pipeline.
