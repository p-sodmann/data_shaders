# Step 12: Release hardening and docs

Status: done
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

- [x] On a fresh clone, `scripts/check.sh` passes.
- [x] On a fresh clone, the README quick start gets to a live demo in under 5 minutes, not
      counting image downloads.
- [x] Following the "monitor your own server" guide with a fresh FastAPI hello-world app makes it
      appear in MARS's stations plate.
- [x] Every step file is marked `Status: done` and has a Handoff section.

## Handoff

### Built

- **Probe packaging.** `mars-probe` is still free on PyPI (404 on 2026-11-07), so the name stays
  (ADR-0001 amended, [ADR-0008](../adr/0008-release-and-exposure.md) new). The version is set
  once, in [_version.py](../../probe/src/mars_probe/_version.py); hatchling, `mars_info`,
  [scripts/version.sh](../../scripts/version.sh) and the image tags read it. MIT
  [LICENSE](../../LICENSE) (a copy in `probe/` for the wheel), `license`, classifiers and project
  URLs in [pyproject.toml](../../probe/pyproject.toml), `py.typed`, and type hints on the public
  API: `instrument(app: Starlette, …)`, `Probe.__init__`, and `stage` (`probe: Probe | None`,
  `__enter__`/`__exit__` with `Literal[False]`, the decorator keeps the function's type).
  [CHANGELOG.md](../../CHANGELOG.md) at the root, one version for the repo. Install from git is
  in the root and probe READMEs.
- **Images.** [scripts/build-images.sh](../../scripts/build-images.sh) builds `mars-web` and
  `mars-demo` for linux/amd64 + linux/arm64 (docker buildx, else Podman manifest lists), tagged
  `<version>` and `latest` under `ghcr.io/p-sodmann`; `--push` pushes.
  [web/Dockerfile](../../web/Dockerfile)'s build stage is `--platform=$BUILDPLATFORM` (see
  Deviations). [deploy/compose.prod.yaml](../../deploy/compose.prod.yaml): pinned
  `ghcr.io/p-sodmann/mars-web:0.1.0` with a `build: ../web` fallback, no demo, no Prometheus
  port, `extra_hosts: host.docker.internal:host-gateway`, `/healthz` healthcheck, user files in
  [deploy/site/](../../deploy/site/) (`targets/`, `config/`).
- **Kiosk guide:** [deploy/KIOSK.md](../../deploy/KIOSK.md): Pi 5 / mini PC, Chromium kiosk
  flags, an `fps`/`dpr` table for 1080p and 4K (with `--force-device-scale-factor=2`, because
  `dpr` only caps `devicePixelRatio`), measuring with `__mars.frames()`, blanking off
  (raspi-config, xset, GNOME), autostart (labwc, XDG) with a restart loop that waits for
  `/healthz`, and basic auth on kiosks.
- **Security.** [web/mars-entrypoint.sh](../../web/mars-entrypoint.sh) turns
  `MARS_BASIC_AUTH="<user> <bcrypt hash>"` into `/etc/caddy/auth.caddy`, which the
  [Caddyfile](../../web/Caddyfile) imports: `basic_auth` on every path except the new
  `/healthz`. Values that aren't two words of hash/user characters stop the container. Both
  compose files pass `MARS_BASIC_AUTH` through and healthcheck `/healthz`. The
  [deploy README](../../deploy/README.md#security) has the LAN-only default, hashes (base64, so
  no `$` escaping), TLS via a reverse proxy, and remote scraping (firewall, an https +
  basic-auth job). `deploy/.env` is gitignored.
- **Checks.** [scripts/check.sh](../../scripts/check.sh): release version (prod pin and
  CHANGELOG section match `_version.py`), probe pytest + ruff, promtool rule tests, demo pytest
  + ruff, web vitest + build + smoke (installs Chromium; `SKIP_SMOKE=1` skips), shell syntax,
  `compose config` for both files (docker compose, podman compose or podman-compose), and a
  guard that the prod file publishes no 9090. A remote exists, so also CI:
  [check.yml](../../.github/workflows/check.yml) (check.sh, plus a `stack` job that runs the
  demo under real Docker Compose with `--wait` and polls `mars:throughput_rps` through `/prom`)
  and [release.yml](../../.github/workflows/release.yml) (on `v*`: tag = version, QEMU + buildx
  multi-arch push to GHCR, `uv build`, a GitHub release with this version's CHANGELOG section
  and the wheel).
- **Docs.** Root [README.md](../../README.md): what MARS is, the 3-command quick start, a
  screenshot of each of the 7 demo pages ([docs/img/](../img/), JPEG, 1280 px, taken on the live
  stack), "monitor your own FastAPI server" in 5 steps. deploy, probe, demo and web READMEs
  updated (prod file, site/, security, images, Podman notes, `dpr` on 4K). `mars-probe
  scrape-config` now says `deploy/site/targets/`.
- **Open questions swept** (user's decisions, 2026-11-07): the config `PUT` is deferred and back
  under *Config and stations* with its design; `LOADGEN_TZ`, demo targets in their own folder
  and the 5 s scrape interval were decided but never built and are reopened under *Deploy*; the
  narrow-screen and long-station-name follow-ups (steps 05/06) were never built either and are
  reopened under *Display*; every "→ step 12" entry in Resolved now says what step 12 built. New:
  the 404 console error on a fresh prod display.

### Deviations

- **Web image build stage on the build platform.** Under QEMU x86_64 emulation on this arm64
  host, esbuild (Go) crashes in `vite build` (`fatal error: lfstack.push`). The build output
  doesn't depend on the CPU, so `FROM --platform=$BUILDPLATFORM node:26.13.0-alpine AS build`; only
  the Caddy stage is per-arch. Also faster (39 s for both images, both arches, warm cache).
- **`compose.prod.yaml` has a `build:` fallback** next to the pinned image, because the image
  isn't published until a `v0.1.0` tag is pushed. `pull` then reports 403 and `up` builds.
- **Basic auth is an env var in the image**, not only a snippet to paste (user's choice): this
  is the "Exposure" decision in open-questions. `/healthz` is new so healthchecks work with auth.
- **The config `PUT` handler is not built** (user's choice, deferred; see open-questions).
- **The three step 02/03 follow-ups and two 05/06 follow-ups are reopened, not built**
  (user's choice).
- **Licence file twice** (root and `probe/`): hatchling's `license-files` can't point outside
  the package directory.

### Verification

- `scripts/check.sh` on the working tree: all passed, 2 min 17 s. On a **fresh clone**
  (`git clone` of commit 3cb4faa into the scratchpad, no node_modules, no venvs): all passed,
  2 min 19 s. Probe `45 passed, 1 skipped`, ruff clean, promtool `SUCCESS`, demo `18 passed`,
  vitest `127 passed (127)`, `smoke: ok`, `ok (podman compose)`, `all checks passed`.
- Guards: a prod file with `ports: ["9090:9090"]` on Prometheus trips the 9090 check; a prod pin
  of `0.0.9` trips the version check.
- Wheel: `uv build` → `mars_probe-0.1.0-py3-none-any.whl` with `py.typed`, `regions.json`,
  `prometheus/mars.rules.yml`, `licenses/LICENSE`; metadata `License-Expression: MIT`,
  `Typing :: Typed`. A user file using `instrument`, `stage` (with, async with, decorator),
  `probe.gauge`, `RegionConfig` passes `mypy --strict` against the installed wheel.
- Multi-arch: `podman manifest inspect` → `mars-web ['arm64', 'amd64']`,
  `mars-demo ['arm64', 'amd64']`; run per platform: amd64 `x86_64 0.1.0` (demo) and `x86_64`,
  Caddy `v2.11.9` (web); arm64 `aarch64` likewise.
- Basic auth (container and via `compose.prod.yaml` with a base64 hash exported in the shell):
  `/` 401 without, 200 with, 401 with a wrong password; `/prom/…` 401; `/healthz` 200; the
  container is healthy; unset → `/` 200. `MARS_BASIC_AUTH` values `ops`, `ops `, ` x`,
  `o{p} …`, `ops $2a$14$a b` are refused at start.
- **Quick start, fresh clone, Podman:** `build --no-cache` (0 cache hits: npm ci 51 packages,
  vite build, uv 19 packages ×3) 21 s, `up -d` → 31 s, `mars:throughput_rps` for both `api`
  and `search` through `localhost:8080/prom` at **36 s**. All containers healthy (mars on
  `/healthz`). Base images were already local (excluded by the criterion).
- **Own-server guide, literally:** a new venv, `pip install "mars-probe @
  git+https://github.com/p-sodmann/data_shaders#subdirectory=probe"` (from GitHub `main`,
  0.1.0), the README's `main.py`, `uvicorn main:app --host 0.0.0.0 --port 8000` (`/metrics` has
  `mars_info{station="hello",version="0.1.0"}`), `mars-probe scrape-config --target
  host.docker.internal:8000 > deploy/site/targets/hello.yml`, `compose.prod.yaml up -d` with no
  local image (pull 403 → built). Prometheus target `host.docker.internal:8000 up`; 9090 not
  reachable from the host. In Chromium (ANGLE Metal): `E` → Stations → *Available on
  Prometheus* = `['hello']` → Add + standard pages → `HELLO-01` live, pages
  `hello-tape…hello-almanac`; page 6 shows P50 0.5 ms, 14 req/s, 1 node OK. One console error:
  the 404 for the absent `/config/mars.json` (expected, now an open question).
- Every step file: `grep '^Status' docs/steps/*.md` → all `done`; every file has `## Handoff`.
- `actionlint` on both workflows: clean.

### Not verified / needs a person

- **CI and the release workflow haven't run on GitHub**: nothing was pushed (the step's
  instructions). The first push runs `check.yml`; its `stack` job is the first run under real
  Docker Compose (only Podman here). The first `v0.1.0` tag runs `release.yml`, and only then
  does `ghcr.io/p-sodmann/mars-web:0.1.0` exist; the GHCR packages may need to be made public
  in the GitHub package settings once.
- **The quick start under Docker** (no Docker daemon here); it was timed with Podman, as
  `build` then `up -d`. A single podman-compose `up -d --build` hung in the parallel demo builds
  once (documented in both READMEs).
- **The kiosk guide on real hardware**: no Raspberry Pi 5 or 4K panel here. The flags, the
  raspi-config calls and the labwc autostart path are from the documentation, not tried. Frame
  time on a Pi 5 is still unmeasured (step 10).
- The remote https + basic-auth scrape job and the `ufw` example weren't run.
- Publishing to PyPI is deliberately not done.

### Notes for later steps

- **To release:** bump `_version.py`, the pin in `compose.prod.yaml`, and a `## [x.y.z]`
  section in CHANGELOG.md (check.sh fails otherwise), run `scripts/check.sh`, tag `vx.y.z`, push
  the tag.
- `scripts/build-images.sh` with Podman also tags the manifest lists `ghcr.io/…:latest` locally;
  `podman manifest rm` removes them.
- `podman-compose` reports a failed pull and then builds. How Docker Compose treats the
  `image:` + `build:` pair before the release exists wasn't checked here (no Docker daemon);
  `pull` is the explicit step either way.
- The 4K advice in KIOSK.md rests on `dpr = min(devicePixelRatio, cap)` in
  `web/src/gl/engine.js`; if that changes, update the table.
