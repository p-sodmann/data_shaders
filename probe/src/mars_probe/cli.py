"""`mars-probe` command line. `mars-probe rules` arrives in step 03."""

from __future__ import annotations

import argparse

from ._version import __version__


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mars-probe", description="MARS instrumentation probe")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("version", help="print the probe version")
    args = parser.parse_args(argv)
    if args.command == "version":
        print(__version__)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
