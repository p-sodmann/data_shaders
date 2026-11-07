#!/usr/bin/env bash
# Runs every check in the repo, the same as CI (.github/workflows/check.yml):
#   release version, probe tests + lint, promtool rule tests, agent, gateway and demo tests + lint,
#   web vitest, web build, headless smoke, shell syntax, compose file validation.
# Works on a fresh clone. Needs uv, Node 22 + npm, and for the rule tests and compose files
# promtool or Docker/Podman (with docker compose, podman compose or podman-compose).
#   scripts/check.sh            # everything
#   SKIP_SMOKE=1 scripts/check.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { echo "check: $*" >&2; exit 1; }

step "release version"
VERSION="$(scripts/version.sh)"
[[ -n "$VERSION" ]] || fail "no __version__ in probe/src/mars_probe/_version.py"
grep -q "ghcr.io/p-sodmann/mars-web:$VERSION\$" deploy/compose.prod.yaml \
  || fail "deploy/compose.prod.yaml doesn't pin mars-web:$VERSION"
grep -q "^## \[$VERSION\]" CHANGELOG.md || fail "CHANGELOG.md has no '## [$VERSION]' section"
grep -q "^__version__ = \"$VERSION\"\$" agent/src/mars_agent/_version.py \
  || fail "agent/src/mars_agent/_version.py isn't $VERSION"
grep -q "ghcr.io/p-sodmann/mars-agent:$VERSION\$" agent/compose.yaml \
  || fail "agent/compose.yaml doesn't pin mars-agent:$VERSION"
grep -q "^__version__ = \"$VERSION\"\$" gateway/src/mars_gateway/_version.py \
  || fail "gateway/src/mars_gateway/_version.py isn't $VERSION"
grep -q "ghcr.io/p-sodmann/mars-gateway:$VERSION\$" deploy/compose.prod.yaml \
  || fail "deploy/compose.prod.yaml doesn't pin mars-gateway:$VERSION"
echo "$VERSION"

step "probe: pytest, ruff"
(
  cd probe
  uv run --extra dev pytest -q
  uv run --extra dev ruff check .
  uv run --extra dev ruff format --check .
)

step "probe: promtool rule tests"
bash probe/scripts/test-rules.sh

step "agent: pytest, ruff"
(
  cd agent
  uv run pytest -q
  uv run ruff check .
  uv run ruff format --check .
)

step "gateway: pytest, ruff"
(
  cd gateway
  uv run pytest -q
  uv run ruff check .
  uv run ruff format --check .
)

step "demo: pytest, ruff"
(
  cd examples/demo
  uv run pytest -q
  uv run ruff check .
  uv run ruff format --check .
)

step "web: vitest, build, smoke"
(
  cd web
  [[ -d node_modules ]] || npm ci
  npm test
  npm run build
  if [[ -z "${SKIP_SMOKE:-}" ]]; then
    npx playwright install chromium
    SMOKE_SKIP_BUILD=1 npm run smoke
  fi
)

step "shell scripts: syntax"
for f in scripts/*.sh probe/scripts/*.sh; do bash -n "$f"; done
sh -n web/mars-entrypoint.sh
echo ok

step "compose files"
if docker compose version >/dev/null 2>&1; then
  compose=(docker compose)
elif podman compose version >/dev/null 2>&1; then
  compose=(podman compose)
elif command -v podman-compose >/dev/null 2>&1; then
  compose=(podman-compose)
else
  fail "need docker compose, podman compose or podman-compose to validate deploy/*.yaml"
fi
"${compose[@]}" -f agent/compose.yaml config >/dev/null
"${compose[@]}" -f deploy/compose.yaml --profile demo config >/dev/null
"${compose[@]}" -f deploy/compose.prod.yaml config >/dev/null
# The prod file must not publish Prometheus (deploy/README.md#security).
if "${compose[@]}" -f deploy/compose.prod.yaml config | grep -Eq '9090:9090|published: "?9090'; then
  fail "deploy/compose.prod.yaml publishes Prometheus port 9090"
fi
echo "ok (${compose[*]})"

printf '\n\033[1mall checks passed\033[0m\n'
