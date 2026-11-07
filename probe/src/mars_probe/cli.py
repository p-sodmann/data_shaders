"""`mars-probe` command line: version, the recording rules, and a scrape target snippet."""

from __future__ import annotations

import argparse
import sys
from importlib.resources import files

from ._version import __version__


def rules_text() -> str:
    """The MARS recording rules shipped in this package (ADR-0003)."""
    return files("mars_probe").joinpath("prometheus", "mars.rules.yml").read_text("utf-8")


def scrape_config(targets: list[str]) -> str:
    """A Prometheus file_sd snippet. The `mars` job in deploy/ picks up targets/*.yml."""
    quoted = ", ".join(f'"{t}"' for t in targets)
    # deploy/site/targets/ is what compose.prod.yaml mounts; the demo file mounts
    # deploy/prometheus/targets/.
    return f"# Save as deploy/site/targets/<name>.yml\n- targets: [{quoted}]\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mars-probe", description="MARS instrumentation probe")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("version", help="print the probe version")
    sub.add_parser("rules", help="print the Prometheus recording rules MARS reads")
    scrape = sub.add_parser("scrape-config", help="print a file_sd target snippet")
    scrape.add_argument(
        "--target",
        action="append",
        required=True,
        metavar="HOST:PORT",
        help="address Prometheus scrapes /metrics on (repeat for several nodes)",
    )
    args = parser.parse_args(argv)
    if args.command == "version":
        print(__version__)
    elif args.command == "rules":
        sys.stdout.write(rules_text())
    elif args.command == "scrape-config":
        sys.stdout.write(scrape_config(args.target))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
