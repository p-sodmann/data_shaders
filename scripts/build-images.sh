#!/usr/bin/env bash
# Builds the mars (web) and demo images for linux/amd64 and linux/arm64 (Raspberry Pi 4/5).
#   scripts/build-images.sh            # build both platforms, keep them local
#   scripts/build-images.sh --push     # and push to $REGISTRY (log in first)
# Uses docker buildx if it is there, else podman (manifest lists). Cross-building needs QEMU
# binfmt handlers: Docker Desktop and the Podman machine have them; on Linux run
#   docker run --privileged --rm tonistiigi/binfmt --install all
# The release workflow (.github/workflows/release.yml) does the same on a v* tag.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="${REGISTRY:-ghcr.io/p-sodmann}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
VERSION="$("$ROOT/scripts/version.sh")"
PUSH=0
[[ "${1:-}" == "--push" ]] && PUSH=1

# name, context, Dockerfile
IMAGES=(
  "mars-web $ROOT/web $ROOT/web/Dockerfile"
  "mars-demo $ROOT $ROOT/examples/demo/Dockerfile"
)

if docker buildx version >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  for spec in "${IMAGES[@]}"; do
    read -r name context file <<<"$spec"
    out=(--load)
    # --load takes one platform only; a multi-platform build that isn't pushed stays in the cache.
    [[ "$PLATFORMS" == *,* ]] && out=()
    ((PUSH)) && out=(--push)
    docker buildx build --platform "$PLATFORMS" -f "$file" \
      -t "$REGISTRY/$name:$VERSION" -t "$REGISTRY/$name:latest" "${out[@]}" "$context"
  done
elif command -v podman >/dev/null 2>&1; then
  for spec in "${IMAGES[@]}"; do
    read -r name context file <<<"$spec"
    ref="$REGISTRY/$name:$VERSION"
    podman manifest rm "$ref" >/dev/null 2>&1 || true
    podman build --platform "$PLATFORMS" --manifest "$ref" -f "$file" "$context"
    podman tag "$ref" "$REGISTRY/$name:latest"
    if ((PUSH)); then
      podman manifest push --all "$ref" "docker://$ref"
      podman manifest push --all "$ref" "docker://$REGISTRY/$name:latest"
    fi
  done
else
  echo "build-images: need docker buildx or podman" >&2
  exit 1
fi
echo "built $REGISTRY/{mars-web,mars-demo}:$VERSION for $PLATFORMS"
