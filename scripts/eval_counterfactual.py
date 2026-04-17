#!/usr/bin/env python3
"""Counterfactual evaluation of router policy using logged data.

Implements IPS (Inverse Propensity Scoring), SNIPS (Self-Normalized IPS),
and DR (Doubly Robust) estimators for evaluating what would have happened
under a different routing policy.

Usage:
    python scripts/eval_counterfactual.py --training-dir ./training_data
    python scripts/eval_counterfactual.py --training-dir ./training_data --manifest ./models/manifest.json
"""

import argparse
import json
import logging
import sys
from pathlib import Path

import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("eval_counterfactual")


def load_samples(training_dir: Path) -> list[dict]:
    """Load training samples from JSONL files."""
    samples = []
    for path in sorted(training_dir.glob("training-*.jsonl")):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    sample = json.loads(line)
                    if sample.get("schema_version") == 1:
                        samples.append(sample)
                except json.JSONDecodeError:
                    continue
    return samples


def extract_feature_matrix(samples: list[dict]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Extract feature matrix X, labels y, and propensity scores."""
    feature_names = [
        "estimated_tokens", "message_count", "user_message_count",
        "assistant_message_count", "code_block_count", "file_path_count",
        "stacktrace_count", "tool_count", "question_count",
        "max_tokens_requested", "stream_flag", "complexity_signal_count",
        "error_signal_count", "matched_rule_count", "hour_of_day_utc",
        "tier1_health_score", "tier2_health_score", "tier3_health_score",
    ]
    for tt in ["debug", "implementation", "architecture", "analysis", "simple", "general"]:
        feature_names.append(f"task_type_{tt}")
    for bt in ["tier1", "tier2", "tier3"]:
        feature_names.append(f"baseline_tier_{bt}")

    rows = []
    labels = []
    propensities = []

    for sample in samples:
        fv = sample.get("feature_values", {})
        row = [
            fv.get("estimated_tokens", 0),
            fv.get("message_count", 0),
            fv.get("user_message_count", 0),
            fv.get("assistant_message_count", 0),
            fv.get("code_block_count", 0),
            fv.get("file_path_count", 0),
            fv.get("stacktrace_count", 0),
            fv.get("tool_count", 0),
            fv.get("question_count", 0),
            fv.get("max_tokens_requested", 0),
            int(fv.get("stream_flag", False)),
            fv.get("complexity_signal_count", 0),
            fv.get("error_signal_count", 0),
            fv.get("matched_rule_count", 0),
            fv.get("hour_of_day_utc", 0),
        ]
        for key in ["tier1_health_score", "tier2_health_score", "tier3_health_score"]:
            row.append(fv.get(key, 100.0))
        task_type = fv.get("task_type", "general")
        for tt in ["debug", "implementation", "architecture", "analysis", "simple", "general"]:
            row.append(1 if task_type == tt else 0)
        baseline = fv.get("baseline_selected_tier", "")
        for bt in ["tier1", "tier2", "tier3"]:
            row.append(1 if baseline == bt else 0)

        rows.append(row)
        labels.append(sample.get("safe_label", 0))
        propensities.append(sample.get("propensity", 1.0))

    return np.array(rows, dtype=np.float64), np.array(labels, dtype=np.int32), np.array(propensities, dtype=np.float64)


def ips_estimate(y: np.ndarray, propensities: np.ndarray) -> float:
    """Inverse Propensity Scoring estimator.

    V_IPS = (1/n) * sum(y_i / e_i)
    """
    weights = 1.0 / np.maximum(propensities, 1e-6)
    return float(np.mean(y * weights))


def snips_estimate(y: np.ndarray, propensities: np.ndarray) -> float:
    """Self-Normalized IPS estimator.

    V_SNIPS = sum(y_i / e_i) / sum(1 / e_i)
    """
    weights = 1.0 / np.maximum(propensities, 1e-6)
    weighted_outcomes = y * weights
    return float(np.sum(weighted_outcomes) / np.sum(weights))


def dr_estimate(
    y: np.ndarray,
    propensities: np.ndarray,
    X: np.ndarray,
    tier3_clf,
    tier2_clf,
    target_tier: str = "tier3",
) -> float:
    """Doubly Robust estimator.

    V_DR = (1/n) * sum(q_hat(x_i) + (y_i - q_hat(x_i)) / e_i)
    """
    clf = tier3_clf if target_tier == "tier3" else tier2_clf
    q_hat = clf.predict_proba(X)[:, 1]

    weights = 1.0 / np.maximum(propensities, 1e-6)
    dr_values = q_hat + (y - q_hat) * weights
    return float(np.mean(dr_values))


def evaluate_per_tier(samples: list[dict], X: np.ndarray, y: np.ndarray, propensities: np.ndarray) -> dict:
    """Evaluate per-tier statistics."""
    tier_stats = {}
    for tier in ["tier1", "tier2", "tier3"]:
        mask = np.array([s.get("executed_tier") == tier for s in samples])
        n = mask.sum()
        if n == 0:
            tier_stats[tier] = {"n": 0, "safe_rate": None, "avg_latency_ms": None}
            continue

        tier_y = y[mask]
        tier_props = propensities[mask]
        latencies = [samples[i].get("latency_ms") for i in range(len(samples)) if mask[i]]
        valid_latencies = [l for l in latencies if l is not None]

        tier_stats[tier] = {
            "n": int(n),
            "safe_rate": round(float(tier_y.mean()), 4),
            "avg_latency_ms": round(sum(valid_latencies) / len(valid_latencies), 1) if valid_latencies else None,
            "ips": round(ips_estimate(tier_y, tier_props), 4),
            "snips": round(snips_estimate(tier_y, tier_props), 4),
        }

    return tier_stats


def evaluate_bias_variance(y: np.ndarray, propensities: np.ndarray, n_bootstrap: int = 200) -> dict:
    """Bootstrap confidence intervals for IPS/SNIPS estimators."""
    n = len(y)
    ips_estimates = []
    snips_estimates = []

    for _ in range(n_bootstrap):
        idx = np.random.choice(n, size=n, replace=True)
        ips_estimates.append(ips_estimate(y[idx], propensities[idx]))
        snips_estimates.append(snips_estimate(y[idx], propensities[idx]))

    return {
        "ips": {
            "mean": round(float(np.mean(ips_estimates)), 4),
            "std": round(float(np.std(ips_estimates)), 4),
            "ci_lower": round(float(np.percentile(ips_estimates, 2.5)), 4),
            "ci_upper": round(float(np.percentile(ips_estimates, 97.5)), 4),
        },
        "snips": {
            "mean": round(float(np.mean(snips_estimates)), 4),
            "std": round(float(np.std(snips_estimates)), 4),
            "ci_lower": round(float(np.percentile(snips_estimates, 2.5)), 4),
            "ci_upper": round(float(np.percentile(snips_estimates, 97.5)), 4),
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Counterfactual evaluation of router policy")
    parser.add_argument("--training-dir", required=True, help="Directory with training JSONL files")
    parser.add_argument("--manifest", help="Path to model manifest for DR estimator")
    parser.add_argument("--n-bootstrap", type=int, default=200, help="Bootstrap iterations for CI")
    parser.add_argument("--output", help="Output JSON file for results")
    args = parser.parse_args()

    training_dir = Path(args.training_dir)
    samples = load_samples(training_dir)
    if not samples:
        logger.error("No training samples found")
        sys.exit(1)

    logger.info(f"Loaded {len(samples)} samples")

    X, y, propensities = extract_feature_matrix(samples)

    # Basic estimators
    ips = ips_estimate(y, propensities)
    snips = snips_estimate(y, propensities)
    logger.info(f"IPS: {ips:.4f}, SNIPS: {snips:.4f}")

    # Per-tier evaluation
    tier_stats = evaluate_per_tier(samples, X, y, propensities)
    for tier, stats in tier_stats.items():
        if stats["n"] > 0:
            logger.info(f"  {tier}: n={stats['n']}, safe_rate={stats['safe_rate']}, "
                        f"avg_latency={stats['avg_latency_ms']}ms")

    # Bootstrap CIs
    logger.info("Computing bootstrap confidence intervals...")
    bv = evaluate_bias_variance(y, propensities, n_bootstrap=args.n_bootstrap)
    logger.info(f"  IPS CI: [{bv['ips']['ci_lower']}, {bv['ips']['ci_upper']}]")
    logger.info(f"  SNIPS CI: [{bv['snips']['ci_lower']}, {bv['snips']['ci_upper']}]")

    # DR estimator (if manifest provided)
    dr_result = None
    if args.manifest:
        try:
            import joblib
            manifest_path = Path(args.manifest)
            with open(manifest_path) as f:
                manifest = json.load(f)

            tier3_clf = joblib.load(manifest["tier3_classifier_path"])
            tier2_clf = joblib.load(manifest["tier2_classifier_path"])

            dr_t3 = dr_estimate(y, propensities, X, tier3_clf, tier2_clf, target_tier="tier3")
            dr_t2 = dr_estimate(y, propensities, X, tier3_clf, tier2_clf, target_tier="tier2")

            dr_result = {
                "tier3": round(dr_t3, 4),
                "tier2": round(dr_t2, 4),
            }
            logger.info(f"DR tier3: {dr_t3:.4f}, tier2: {dr_t2:.4f}")
        except Exception as e:
            logger.warning(f"DR estimation failed: {e}")

    # Compile results
    results = {
        "n_samples": len(samples),
        "overall_safe_rate": round(float(y.mean()), 4),
        "ips": round(ips, 4),
        "snips": round(snips, 4),
        "dr": dr_result,
        "per_tier": tier_stats,
        "bootstrap_ci": bv,
        "propensity_stats": {
            "mean": round(float(propensities.mean()), 4),
            "min": round(float(propensities.min()), 4),
            "max": round(float(propensities.max()), 4),
            "n_baseline": int(np.sum(propensities >= 0.99)),
            "n_shadow": int(np.sum(propensities < 0.99)),
        },
    }

    output_path = args.output or str(training_dir / f"eval-{Path(args.training_dir).name}.json")
    with open(output_path, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    logger.info(f"Results saved to {output_path}")


if __name__ == "__main__":
    main()
