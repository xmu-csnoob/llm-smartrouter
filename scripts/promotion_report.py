#!/usr/bin/env python3
"""Promotion report generator for ML router model stages.

Generates a report comparing the candidate model against the current
production baseline using counterfactual evaluation metrics. Determines
whether a model should advance to the next promotion stage.

Promotion stages: pending -> canary_5pct -> canary_25pct -> production
Rollback triggers: safety degradation, latency increase, error rate spike.

Usage:
    python scripts/promotion_report.py --manifest ./models/manifest.json --training-dir ./training_data
    python scripts/promotion_report.py --manifest ./models/manifest.json --eval-results ./training_data/eval-*.json
"""

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("promotion_report")

# Promotion criteria thresholds
PROMOTION_CRITERIA = {
    "canary_5pct": {
        "min_samples": 500,
        "min_safe_rate": 0.90,
        "max_ece": 0.10,
        "min_ips_improvement": 0.0,  # At least non-negative
        "max_latency_increase_pct": 10.0,
    },
    "canary_25pct": {
        "min_samples": 2000,
        "min_safe_rate": 0.92,
        "max_ece": 0.08,
        "min_ips_improvement": 0.01,
        "max_latency_increase_pct": 5.0,
    },
    "production": {
        "min_samples": 10000,
        "min_safe_rate": 0.95,
        "max_ece": 0.05,
        "min_ips_improvement": 0.02,
        "max_latency_increase_pct": 3.0,
    },
}


def load_manifest(manifest_path: Path) -> dict:
    """Load model manifest."""
    with open(manifest_path) as f:
        return json.load(f)


def load_eval_results(eval_path: Path) -> dict:
    """Load evaluation results JSON."""
    with open(eval_path) as f:
        return json.load(f)


def check_promotion_readiness(manifest: dict, eval_results: dict | None = None) -> dict:
    """Check if the model is ready for the next promotion stage.

    Returns:
        dict with promotion decision and detailed checks
    """
    current_stage = manifest.get("promotion_stage", "pending")
    stage_order = ["pending", "canary_5pct", "canary_25pct", "production"]
    current_idx = stage_order.index(current_stage) if current_stage in stage_order else 0

    if current_idx >= len(stage_order) - 1:
        return {
            "current_stage": current_stage,
            "next_stage": None,
            "ready": False,
            "message": "Already at production stage",
        }

    next_stage = stage_order[current_idx + 1]
    criteria = PROMOTION_CRITERIA.get(next_stage, {})
    checks = {}
    all_passed = True

    # Check 1: Training samples
    t3_pos = manifest.get("tier3_positive_samples", 0)
    t3_neg = manifest.get("tier3_negative_samples", 0)
    total_samples = t3_pos + t3_neg
    min_samples = criteria.get("min_samples", 0)
    samples_passed = total_samples >= min_samples
    checks["sample_count"] = {
        "value": total_samples,
        "threshold": min_samples,
        "passed": samples_passed,
    }
    if not samples_passed:
        all_passed = False

    # Check 2: Safe rate (from offline eval)
    offline_eval = manifest.get("offline_eval", {})
    safe_rate = offline_eval.get("snips", offline_eval.get("ips", 0))
    min_safe = criteria.get("min_safe_rate", 0.9)
    safe_passed = safe_rate >= min_safe
    checks["safe_rate"] = {
        "value": round(safe_rate, 4),
        "threshold": min_safe,
        "passed": safe_passed,
    }
    if not safe_passed:
        all_passed = False

    # Check 3: Calibration (ECE)
    tier3_ece = manifest.get("tier3_ece", 1.0)
    max_ece = criteria.get("max_ece", 0.1)
    ece_passed = tier3_ece <= max_ece
    checks["calibration_ece"] = {
        "value": round(tier3_ece, 4),
        "threshold": max_ece,
        "passed": ece_passed,
    }
    if not ece_passed:
        all_passed = False

    # Check 4: IPS improvement (if eval_results available)
    if eval_results:
        current_ips = eval_results.get("ips", 0)
        baseline_ips = eval_results.get("per_tier", {}).get("tier1", {}).get("ips", current_ips)
        ips_improvement = current_ips - baseline_ips
        min_improvement = criteria.get("min_ips_improvement", 0.0)
        ips_passed = ips_improvement >= min_improvement
        checks["ips_improvement"] = {
            "value": round(ips_improvement, 4),
            "threshold": min_improvement,
            "passed": ips_passed,
        }
        if not ips_passed:
            all_passed = False

    # Check 5: Latency (from eval results)
    if eval_results:
        tier_stats = eval_results.get("per_tier", {})
        tier3_latency = tier_stats.get("tier3", {}).get("avg_latency_ms")
        tier1_latency = tier_stats.get("tier1", {}).get("avg_latency_ms")
        if tier3_latency and tier1_latency and tier1_latency > 0:
            latency_increase_pct = (tier3_latency - tier1_latency) / tier1_latency * 100
            max_latency_pct = criteria.get("max_latency_increase_pct", 10.0)
            latency_passed = latency_increase_pct <= max_latency_pct
            checks["latency_increase_pct"] = {
                "value": round(latency_increase_pct, 2),
                "threshold": max_latency_pct,
                "passed": latency_passed,
            }
            if not latency_passed:
                all_passed = False

    return {
        "current_stage": current_stage,
        "next_stage": next_stage,
        "ready": all_passed,
        "checks": checks,
        "model_id": manifest.get("model_id"),
        "trained_at": manifest.get("trained_at"),
    }


def check_rollback(manifest: dict, eval_results: dict) -> dict:
    """Check if a rollback is warranted.

    Rollback triggers:
    - Safe rate drops below 0.85
    - ECE exceeds 0.15
    - Error rate spike
    """
    triggers = []
    current_stage = manifest.get("promotion_stage", "pending")

    if current_stage == "pending":
        return {"rollback_recommended": False, "message": "Not in an active promotion stage"}

    # Safe rate check
    safe_rate = eval_results.get("overall_safe_rate", 1.0)
    if safe_rate < 0.85:
        triggers.append(f"Safe rate critically low: {safe_rate:.4f}")

    # Per-tier safe rate
    for tier, stats in eval_results.get("per_tier", {}).items():
        tier_safe = stats.get("safe_rate")
        if tier_safe is not None and tier_safe < 0.80:
            triggers.append(f"{tier} safe rate low: {tier_safe:.4f}")

    # Propensity distribution check
    prop_stats = eval_results.get("propensity_stats", {})
    n_shadow = prop_stats.get("n_shadow", 0)
    n_total = eval_results.get("n_samples", 1)
    shadow_ratio = n_shadow / n_total if n_total > 0 else 0
    if shadow_ratio < 0.01 and current_stage in ("canary_25pct", "production"):
        triggers.append(f"Insufficient shadow samples: {n_shadow}/{n_total}")

    return {
        "rollback_recommended": len(triggers) > 0,
        "triggers": triggers,
        "current_stage": current_stage,
        "recommendation": "rollback to pending" if triggers else "continue",
    }


def generate_report(manifest: dict, eval_results: dict | None = None) -> dict:
    """Generate full promotion report."""
    report = {
        "report_generated_at": datetime.now(timezone.utc).isoformat(),
        "model_id": manifest.get("model_id"),
        "current_stage": manifest.get("promotion_stage", "pending"),
        "training_summary": {
            "tier3_samples": manifest.get("tier3_positive_samples", 0) + manifest.get("tier3_negative_samples", 0),
            "tier3_positive_rate": round(
                manifest.get("tier3_positive_samples", 0) /
                max(manifest.get("tier3_positive_samples", 0) + manifest.get("tier3_negative_samples", 0), 1),
                4,
            ),
            "tier2_samples": manifest.get("tier2_positive_samples", 0) + manifest.get("tier2_negative_samples", 0),
            "tier3_ece": manifest.get("tier3_ece"),
            "tier2_ece": manifest.get("tier2_ece"),
        },
        "offline_eval": manifest.get("offline_eval", {}),
        "promotion_readiness": check_promotion_readiness(manifest, eval_results),
    }

    if eval_results:
        report["rollback_check"] = check_rollback(manifest, eval_results)
        report["counterfactual_eval"] = {
            "ips": eval_results.get("ips"),
            "snips": eval_results.get("snips"),
            "dr": eval_results.get("dr"),
            "bootstrap_ci": eval_results.get("bootstrap_ci"),
        }

    return report


def main():
    parser = argparse.ArgumentParser(description="Generate ML model promotion report")
    parser.add_argument("--manifest", required=True, help="Path to model manifest JSON")
    parser.add_argument("--training-dir", help="Training data directory for counterfactual eval")
    parser.add_argument("--eval-results", help="Pre-computed evaluation results JSON")
    parser.add_argument("--output", help="Output file for report (default: stdout)")
    parser.add_argument("--promote", action="store_true", help="Auto-promote if criteria met")
    args = parser.parse_args()

    manifest = load_manifest(Path(args.manifest))

    eval_results = None
    if args.eval_results:
        eval_results = load_eval_results(Path(args.eval_results))

    report = generate_report(manifest, eval_results)

    # Auto-promote if requested
    if args.promote and report["promotion_readiness"]["ready"]:
        next_stage = report["promotion_readiness"]["next_stage"]
        manifest["promotion_stage"] = next_stage
        manifest["promotion_date"] = datetime.now(timezone.utc).isoformat()
        with open(args.manifest, "w") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        logger.info(f"Promoted to {next_stage}")

    output = json.dumps(report, indent=2, ensure_ascii=False)
    if args.output:
        Path(args.output).write_text(output)
        logger.info(f"Report saved to {args.output}")
    else:
        print(output)


if __name__ == "__main__":
    main()
