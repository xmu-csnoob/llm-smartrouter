"""Run the routing benchmark and print accuracy metrics."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from llm_router.config import RouterConfig
from llm_router.latency import LatencyTracker
from llm_router.router import Router
from tests.routing_benchmark_cases import build_benchmark_cases


def _make_router(config_path: str) -> Router:
    config = RouterConfig(config_path)
    tracker = LatencyTracker(config.fallback)
    return Router(config, tracker, ml_model=None)


def _confusion_matrix(rows: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    matrix: dict[str, dict[str, int]] = {
        expected: {"tier1": 0, "tier2": 0, "tier3": 0}
        for expected in ("tier1", "tier2", "tier3")
    }
    for row in rows:
        matrix[row["expected_tier"]][row["actual_tier"]] += 1
    return matrix


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate llm-router routing accuracy on 200 benchmark cases.")
    parser.add_argument(
        "--config",
        default=str(Path(__file__).resolve().parents[1] / "config.yaml"),
        help="Path to config.yaml",
    )
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Output format",
    )
    parser.add_argument(
        "--show-failures",
        type=int,
        default=20,
        help="How many failure samples to print in text mode",
    )
    args = parser.parse_args()

    router = _make_router(args.config)
    cases = build_benchmark_cases()
    results: list[dict[str, Any]] = []

    for case in cases:
        _model_id, _provider, route_info = router.route(case["request"])
        results.append({
            "id": case["id"],
            "round": case["round"],
            "expected_tier": case["expected_tier"],
            "actual_tier": route_info["selected_tier"],
            "task_type": route_info.get("task_type"),
            "tier_scores": route_info.get("tier_scores"),
            "detected_features": route_info.get("detected_features"),
            "prompt": case["request"]["messages"][0]["content"],
        })

    total = len(results)
    correct = sum(1 for row in results if row["expected_tier"] == row["actual_tier"])
    round_stats: dict[str, dict[str, Any]] = {}
    by_round: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in results:
        by_round[row["round"]].append(row)
    for round_name, rows in sorted(by_round.items()):
        round_total = len(rows)
        round_correct = sum(1 for row in rows if row["expected_tier"] == row["actual_tier"])
        round_stats[round_name] = {
            "total": round_total,
            "correct": round_correct,
            "accuracy": round(round_correct / round_total * 100, 1),
        }

    summary = {
        "total": total,
        "correct": correct,
        "accuracy": round(correct / total * 100, 1),
        "expected_distribution": dict(Counter(row["expected_tier"] for row in results)),
        "actual_distribution": dict(Counter(row["actual_tier"] for row in results)),
        "rounds": round_stats,
        "confusion_matrix": _confusion_matrix(results),
        "failures": [row for row in results if row["expected_tier"] != row["actual_tier"]],
    }

    if args.format == "json":
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    print(f"Accuracy: {summary['accuracy']}% ({correct}/{total})")
    print("Expected distribution:", summary["expected_distribution"])
    print("Actual distribution:", summary["actual_distribution"])
    print("\nPer round:")
    for round_name, stat in summary["rounds"].items():
        print(f"  {round_name}: {stat['accuracy']}% ({stat['correct']}/{stat['total']})")

    print("\nConfusion matrix (expected -> actual):")
    for expected, cols in summary["confusion_matrix"].items():
        print(f"  {expected}: {cols}")

    failures = summary["failures"][: args.show_failures]
    if failures:
        print(f"\nFailure samples (showing {len(failures)} of {len(summary['failures'])}):")
        for row in failures:
            print(
                f"  {row['id']} {row['round']} expected={row['expected_tier']} actual={row['actual_tier']} "
                f"task={row['task_type']} features={row['detected_features']} prompt={row['prompt']}"
            )
    else:
        print("\nNo failures.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

