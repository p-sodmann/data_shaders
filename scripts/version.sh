#!/usr/bin/env bash
# Prints the release version. probe/src/mars_probe/_version.py is the one place it is set: the
# wheel, the image tags and deploy/compose.prod.yaml follow it (scripts/check.sh checks that).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sed -n 's/^__version__ = "\(.*\)"$/\1/p' "$ROOT/probe/src/mars_probe/_version.py"
