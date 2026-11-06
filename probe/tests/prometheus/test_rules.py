"""Runs the promtool unit tests for the recording rules, when promtool is installed.

Without a local promtool, `bash probe/scripts/test-rules.sh` runs them in the
prom/prometheus image.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

PROMTOOL = shutil.which("promtool")
HERE = Path(__file__).parent


@pytest.mark.skipif(PROMTOOL is None, reason="promtool not on PATH (see scripts/test-rules.sh)")
def test_recording_rules():
    result = subprocess.run(
        [PROMTOOL, "test", "rules", "mars.rules.test.yml"],
        cwd=HERE,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
