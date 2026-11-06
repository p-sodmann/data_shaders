# Step 12: Release hardening and docs

Status: todo
Depends on: all previous steps
Read first: [docs/README.md](../README.md), [open-questions.md](../open-questions.md)

## Goal

Make the monorepo something another person can install and run on their own servers, and leave
the open questions in a clean state.

## Tasks

1. **Probe packaging:** check whether the PyPI name is taken, and settle the name (update ADR-0003
   or ADR-0001 if it changes). Add a version in one place, a wheel build, `CHANGELOG.md`,
   installation from git as documented (`pip install "git+…#subdirectory=probe"`), and a
   `py.typed` marker plus type hints on the public API.
2. **Images:** multi-arch builds (amd64, arm64 for Raspberry Pi) for `mars` and `demo`. A
   `deploy/compose.prod.yaml` example without the demo, with a pinned image tag and the config
   and targets volumes.
3. **Kiosk guide** (`deploy/KIOSK.md`): Raspberry Pi 5 or mini PC, Chromium `--kiosk` flags,
   which `fps`/`dpr` to use for a 4K panel, screen blanking off, and auto-start.
4. **Security notes:** a LAN-only default. An optional Caddy basic-auth snippet for `/` and
   `/prom/*`. Don't expose Prometheus port 9090 in the prod compose file.
5. **CI**, if a remote exists. Otherwise a `scripts/check.sh` at the root that runs everything:
   probe tests, promtool tests, web vitest, web build, smoke, and compose config validation.
6. **Docs:**
   - The root README: what MARS is, a screenshot of each page, a 3-command quick start, and
     "monitor your own FastAPI server" in 5 steps.
   - Make sure `web/README.md`, `probe/README.md`, `examples/demo/README.md` and
     `deploy/README.md` are accurate.
7. **Open questions:** go through every entry. Resolve the ones that were settled along the way,
   and make sure the rest have enough context for a later decision.

## Acceptance criteria

- [ ] On a fresh clone, `scripts/check.sh` passes.
- [ ] On a fresh clone, the README quick start gets to a live demo in under 5 minutes, not
      counting image downloads.
- [ ] Following the "monitor your own server" guide with a fresh FastAPI hello-world app makes it
      appear in MARS's stations plate.
- [ ] Every step file is marked `Status: done` and has a Handoff section.
