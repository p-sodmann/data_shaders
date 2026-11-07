from __future__ import annotations

import re
from pathlib import Path

from mars_probe.cli import main

RULES_FILE = Path(__file__).parents[1] / "src/mars_probe/prometheus/mars.rules.yml"

# ADR-0003, "Recording rules". The display reads exactly these names.
ADR_RULES = {
    "mars:latency_p50_ms",
    "mars:throughput_rps",
    "mars:error_ratio",
    "mars:error_ratio:rate1m",
    "mars:saturation_ratio",
    "mars:node_up",
    "mars:node_load_ratio",
    "mars:node_latency_p50_ms",
    "mars:endpoint_rps",
    "mars:endpoint_p95_ms",
    "mars:endpoint_error_ratio",
    "mars:stage_mean_ms",
    "mars:region_rps",
    "mars:region_error_ratio",
    "mars:region_rtt_ms",
}


def test_rules_prints_the_shipped_file(capsys):
    assert main(["rules"]) == 0
    out = capsys.readouterr().out
    assert out == RULES_FILE.read_text("utf-8")


def test_rules_file_has_exactly_the_adr_rules():
    names = re.findall(r"^\s*- record: (\S+)$", RULES_FILE.read_text("utf-8"), re.M)
    assert len(names) == len(set(names))
    assert set(names) == ADR_RULES


def test_scrape_config(capsys):
    assert main(["scrape-config", "--target", "web-1:8000", "--target", "web-2:8000"]) == 0
    out = capsys.readouterr().out
    assert '- targets: ["web-1:8000", "web-2:8000"]' in out
