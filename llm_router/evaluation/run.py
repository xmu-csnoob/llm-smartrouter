"""CLI entry point for the offline evaluation framework.

Usage:
    python -m llm_router.evaluation.run \
        --log-file logs/requests-2025-03-15.jsonl \
        --config config.yaml \
        --limit 1000 \
        --format table \
        --output report.json
"""

from __future__ import annotations

import argparse
import logging
import sys

from .reporter import render_json, render_table
from .runner import run
from .schemas import ReplayMode

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Offline evaluation for llm-router routing decisions.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--log-file",
        required=True,
        metavar="PATH",
        help="Path to the JSONL request log file.",
    )
    parser.add_argument(
        "--config",
        required=True,
        metavar="PATH",
        help="Path to config.yaml.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Maximum number of log entries to process (default: all).",
    )
    parser.add_argument(
        "--hours",
        type=int,
        default=None,
        metavar="N",
        help="Only process log entries from the last N hours (default: all).",
    )
    parser.add_argument(
        "--format",
        choices=["table", "json"],
        default="table",
        help="Output format (default: table).",
    )
    parser.add_argument(
        "--output",
        metavar="PATH",
        help="Write JSON report to this path (optional).",
    )
    args = parser.parse_args(argv)

    try:
        result = run(
            log_file=args.log_file,
            config_path=args.config,
            limit=args.limit,
            hours=args.hours,
            mode=ReplayMode.HYBRID,
        )
    except FileNotFoundError as e:
        sys.stderr.write(f"Error: {e}\n")
        sys.exit(1)
    except Exception as e:
        sys.stderr.write(f"Error during evaluation: {e}\n")
        raise

    # Write JSON output if requested
    if args.output:
        try:
            with open(args.output, "w", encoding="utf-8") as f:
                render_json(result, f)
            print(f"JSON report written to {args.output}")
        except Exception as e:
            sys.stderr.write(f"Warning: could not write JSON output: {e}\n")

    # Render to console
    if args.format == "table":
        print(render_table(result))
    else:
        # JSON to stdout
        print(render_json(result))


if __name__ == "__main__":
    main()
