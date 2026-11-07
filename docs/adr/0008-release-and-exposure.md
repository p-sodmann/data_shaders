# ADR-0008: Releases, images and exposure

Status: accepted · 2026-11-07 (step 12)

## Context

MARS has to run on other people's servers: a probe they can install, images they can pull on a
PC or a Raspberry Pi, and a stack that is safe by default on a LAN. Until step 12 everything
was built from the checkout and the stack had no authentication at all.

## Decision

- **One version** for the repo, set in `probe/src/mars_probe/_version.py`. The wheel
  (hatchling reads it), the image tags (`scripts/version.sh`, `scripts/build-images.sh`, the
  release workflow) and the pin in `deploy/compose.prod.yaml` follow it. `scripts/check.sh`
  fails if the prod pin or `CHANGELOG.md` don't match. A `v<version>` tag releases.
- **The probe** is `mars-probe` (free on PyPI, checked 2026-11-07), MIT, typed (`py.typed`),
  installed from git (`git+…#subdirectory=probe`) with the wheel attached to each GitHub
  release. Publishing to PyPI is a later, manual decision.
- **Images** `ghcr.io/p-sodmann/mars-web` and `mars-demo`, for linux/amd64 and linux/arm64,
  tagged `<version>` and `latest`. The web image's build stage runs on the build platform
  (`--platform=$BUILDPLATFORM`): its output is architecture-independent, and esbuild crashes
  under QEMU x86_64 emulation on arm64 hosts.
- **Two compose files.** `deploy/compose.yaml` builds from the checkout and carries the demo
  profile (ADR-0004 unchanged). `deploy/compose.prod.yaml` runs the pinned release image (with a
  `build:` fallback), has no demo, publishes no Prometheus port, and mounts the user's files
  from `deploy/site/{targets,config}`.
- **Exposure:** LAN-only by default, no auth. `MARS_BASIC_AUTH="<user> <bcrypt hash>"` makes the
  image's entrypoint write a Caddy `basic_auth` snippet for every path except `/healthz`, which
  the healthchecks use. TLS stays out of the stack (put a reverse proxy in front).

## Consequences

- A release is: bump `_version.py`, the prod pin and `CHANGELOG.md`, run `scripts/check.sh`,
  tag `v<version>` and push the tag.
- The kiosk and the healthchecks use `/healthz`; nothing else is reachable without the password
  when auth is on, `/config/` included.
- Writing config documents over HTTP (`PUT /config/mars.json`) is still not possible; see
  [open-questions.md](../open-questions.md).
