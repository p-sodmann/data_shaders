#!/usr/bin/env bash
# Runs the promtool unit tests for the MARS recording rules. Uses a local `promtool` if there
# is one, otherwise the prom/prometheus image (Docker, or Podman if Docker isn't reachable).
# Set CONTAINER_ENGINE=podman|docker to choose the engine explicitly.
set -euo pipefail

# Keep in step with the image pinned in deploy/compose.yaml.
IMAGE="prom/prometheus:v3.16.0"
PROBE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTS="tests/prometheus/mars.rules.test.yml"

if command -v promtool >/dev/null 2>&1; then
  cd "$PROBE" && exec promtool test rules "$TESTS"
fi

engine="${CONTAINER_ENGINE:-}"
if [[ -z "$engine" ]]; then
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    engine=docker
  elif command -v podman >/dev/null 2>&1; then
    engine=podman
  else
    echo "test-rules: need promtool, docker or podman" >&2
    exit 1
  fi
fi

# The test file names the rules by a relative path, so mount the whole probe directory.
exec "$engine" run --rm -v "$PROBE:/probe:ro" -w /probe --entrypoint promtool "$IMAGE" \
  test rules "$TESTS"
