#!/usr/bin/env python3
"""Train the ML router policy from collected training samples.

Usage:
    python scripts/train_router_policy.py --training-dir ./training_data
    python scripts/train_router_policy.py --training-dir ./training_data --output-dir ./models

Reads Schema v3 training JSONL files, trains tier3 and tier2 safety
classifiers with isotonic regression calibration, and produces a model
manifest for the MLRouter to load.
"""

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("train_router_policy")


def load_training_samples(training_dir: Path) -> list[dict]:
    """Load all training samples from JSONL files."""
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
    logger.info(f"Loaded {len(samples)} training samples from {training_dir}")
    return samples


def extract_feature_matrix(samples: list[dict]) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Extract feature matrix and labels from samples.

    Returns:
        (X, y, feature_names) — feature matrix, labels, and column names
    """
    feature_names = [
        "estimated_tokens", "message_count", "user_message_count",
        "assistant_message_count", "code_block_count", "file_path_count",
        "stacktrace_count", "tool_count", "question_count",
        "max_tokens_requested", "stream_flag", "complexity_signal_count",
        "error_signal_count", "matched_rule_count", "hour_of_day_utc",
        "tier1_health_score", "tier2_health_score", "tier3_health_score",
    ]
    # Task type one-hot
    for tt in ["debug", "implementation", "architecture", "analysis", "simple", "general"]:
        feature_names.append(f"task_type_{tt}")
    # Baseline tier one-hot
    for bt in ["tier1", "tier2", "tier3"]:
        feature_names.append(f"baseline_tier_{bt}")

    rows = []
    labels = []
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

        # Health scores (defaults to 100.0)
        for key in ["tier1_health_score", "tier2_health_score", "tier3_health_score"]:
            row.append(fv.get(key, 100.0))

        # Task type one-hot
        task_type = fv.get("task_type", "general")
        for tt in ["debug", "implementation", "architecture", "analysis", "simple", "general"]:
            row.append(1 if task_type == tt else 0)

        # Baseline tier one-hot
        baseline = fv.get("baseline_selected_tier", "")
        for bt in ["tier1", "tier2", "tier3"]:
            row.append(1 if baseline == bt else 0)

        rows.append(row)
        labels.append(sample.get("safe_label", 0))

    return np.array(rows, dtype=np.float64), np.array(labels, dtype=np.int32), feature_names


def split_by_executed_tier(
    samples: list[dict], X: np.ndarray, y: np.ndarray, tier: str,
) -> tuple[np.ndarray, np.ndarray]:
    """Filter to samples executed on a specific tier."""
    mask = []
    for sample in samples:
        mask.append(sample.get("executed_tier") == tier)
    mask = np.array(mask)
    return X[mask], y[mask]


def compute_sample_weights(samples: list[dict]) -> np.ndarray:
    """Compute IPS weights: 1 / propensity."""
    weights = []
    for sample in samples:
        propensity = sample.get("propensity", 1.0)
        weights.append(1.0 / max(propensity, 1e-6))
    return np.array(weights)


def compute_feature_ranges(X: np.ndarray, feature_names: list[str]) -> dict:
    """Compute feature ranges for OOD detection."""
    ranges = {}
    for i, name in enumerate(feature_names):
        col = X[:, i]
        ranges[name] = {
            "p01": float(np.percentile(col, 1)),
            "p99": float(np.percentile(col, 99)),
            "mean": float(np.mean(col)),
            "std": float(np.std(col)),
        }
    return ranges


def train(args):
    """Main training pipeline."""
    try:
        from sklearn.ensemble import GradientBoostingClassifier
        from sklearn.isotonic import IsotonicRegression
        from sklearn.model_selection import train_test_split
        from sklearn.svm import OneClassSVM
        import joblib
    except ImportError:
        logger.error("scikit-learn and joblib are required: pip install scikit-learn joblib")
        sys.exit(1)

    training_dir = Path(args.training_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Load samples
    samples = load_training_samples(training_dir)
    if len(samples) < args.min_samples:
        logger.error(f"Insufficient samples: {len(samples)} < {args.min_samples}")
        sys.exit(1)

    # Extract features
    X, y, feature_names = extract_feature_matrix(samples)
    logger.info(f"Feature matrix: {X.shape}, positive rate: {y.mean():.3f}")

    # Sample weights for IPS
    sample_weights = compute_sample_weights(samples)

    # Feature ranges for OOD
    feature_ranges = compute_feature_ranges(X, feature_names)

    # --- Tier 3 classifier ---
    X_t3, y_t3 = split_by_executed_tier(samples, X, y, "tier3")
    logger.info(f"Tier3 samples: {len(X_t3)} (positive: {y_t3.sum()})")

    tier3_clf = GradientBoostingClassifier(
        n_estimators=100, max_depth=4, learning_rate=0.1, random_state=42,
    )

    if len(X_t3) >= args.min_samples_per_tier:
        sw_t3 = compute_sample_weights([s for s in samples if s.get("executed_tier") == "tier3"])
        X_t3_train, X_t3_cal, y_t3_train, y_t3_cal, sw_t3_train, _ = train_test_split(
            X_t3, y_t3, sw_t3, test_size=0.3, random_state=42,
        )
        tier3_clf.fit(X_t3_train, y_t3_train, sample_weight=sw_t3_train)

        # Calibration
        raw_probs_t3 = tier3_clf.predict_proba(X_t3_cal)[:, 1]
        tier3_calibrator = IsotonicRegression(out_of_bounds="clip")
        tier3_calibrator.fit(raw_probs_t3, y_t3_cal)

        # ECE
        ece_t3 = _compute_ece(raw_probs_t3, y_t3_cal)
        logger.info(f"Tier3 ECE: {ece_t3:.4f}")
    else:
        logger.warning(f"Skipping tier3 classifier: only {len(X_t3)} samples")
        tier3_calibrator = None
        ece_t3 = 1.0

    # --- Tier 2 classifier ---
    X_t2, y_t2 = split_by_executed_tier(samples, X, y, "tier2")
    logger.info(f"Tier2 samples: {len(X_t2)} (positive: {y_t2.sum()})")

    tier2_clf = GradientBoostingClassifier(
        n_estimators=100, max_depth=4, learning_rate=0.1, random_state=42,
    )

    tier2_calibrator = None
    ece_t2 = 1.0

    if len(X_t2) >= args.min_samples_per_tier:
        sw_t2 = compute_sample_weights([s for s in samples if s.get("executed_tier") == "tier2"])
        X_t2_train, X_t2_cal, y_t2_train, y_t2_cal, sw_t2_train, _ = train_test_split(
            X_t2, y_t2, sw_t2, test_size=0.3, random_state=42,
        )
        tier2_clf.fit(X_t2_train, y_t2_train, sample_weight=sw_t2_train)

        raw_probs_t2 = tier2_clf.predict_proba(X_t2_cal)[:, 1]
        tier2_calibrator = IsotonicRegression(out_of_bounds="clip")
        tier2_calibrator.fit(raw_probs_t2, y_t2_cal)

        ece_t2 = _compute_ece(raw_probs_t2, y_t2_cal)
        logger.info(f"Tier2 ECE: {ece_t2:.4f}")
    else:
        logger.warning(f"Skipping tier2 classifier: only {len(X_t2)} samples")

    # --- OOD detector ---
    ood_detector = OneClassSVM(nu=0.05, kernel="rbf", gamma="scale")
    ood_detector.fit(X)

    # --- Save artifacts ---
    model_id = f"router-policy-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"

    tier3_path = output_dir / f"{model_id}_tier3_clf.joblib"
    tier2_path = output_dir / f"{model_id}_tier2_clf.joblib"
    calibrator_path = output_dir / f"{model_id}_calibrators.joblib"
    ood_path = output_dir / f"{model_id}_ood_detector.joblib"
    manifest_path = output_dir / "manifest.json"

    joblib.dump(tier3_clf, tier3_path)
    joblib.dump(tier2_clf, tier2_path)
    if tier3_calibrator is not None or tier2_calibrator is not None:
        joblib.dump(
            {"tier3": tier3_calibrator, "tier2": tier2_calibrator},
            calibrator_path,
        )
    joblib.dump(ood_detector, ood_path)

    # --- Counterfactual evaluation ---
    eval_results = _evaluate_counterfactuals(samples, X, y, tier3_clf, tier2_clf, sample_weights)
    logger.info(f"IPS estimate: {eval_results.get('ips', 'N/A')}")
    logger.info(f"SNIPS estimate: {eval_results.get('snips', 'N/A')}")

    # --- Write manifest ---
    t3_pos = int(y_t3.sum()) if len(y_t3) > 0 else 0
    t3_neg = len(y_t3) - t3_pos
    t2_pos = int(y_t2.sum()) if len(y_t2) > 0 else 0
    t2_neg = len(y_t2) - t2_pos

    timestamps = [s.get("timestamp", "") for s in samples if s.get("timestamp")]
    date_range = (min(timestamps)[:10], max(timestamps)[:10]) if timestamps else ("unknown", "unknown")

    manifest = {
        "schema_version": 1,
        "model_id": model_id,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "training_data_range": list(date_range),
        "tier3_classifier_path": str(tier3_path),
        "tier2_classifier_path": str(tier2_path),
        "calibrator_path": str(calibrator_path),
        "ood_detector_path": str(ood_path),
        "tier3_positive_samples": t3_pos,
        "tier3_negative_samples": t3_neg,
        "tier2_positive_samples": t2_pos,
        "tier2_negative_samples": t2_neg,
        "tier3_ece": round(ece_t3, 4),
        "tier2_ece": round(ece_t2, 4),
        "feature_ranges": feature_ranges,
        "calibration_samples": int(len(X_t3) * 0.3) if len(X_t3) > 0 else 1000,
        "offline_eval": eval_results,
        "promotion_stage": "pending",
        "promotion_date": None,
    }

    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    logger.info(f"Model saved: {model_id}")
    logger.info(f"Manifest: {manifest_path}")
    return manifest


def _compute_ece(probs: np.ndarray, labels: np.ndarray, n_bins: int = 10) -> float:
    """Compute Expected Calibration Error."""
    bin_boundaries = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    for i in range(n_bins):
        mask = (probs >= bin_boundaries[i]) & (probs < bin_boundaries[i + 1])
        if mask.sum() == 0:
            continue
        avg_prob = probs[mask].mean()
        avg_label = labels[mask].mean()
        ece += mask.sum() / len(probs) * abs(avg_prob - avg_label)
    return ece


def _evaluate_counterfactuals(
    samples: list[dict],
    X: np.ndarray,
    y: np.ndarray,
    tier3_clf,
    tier2_clf,
    sample_weights: np.ndarray,
) -> dict:
    """Compute IPS, SNIPS, and DR estimates."""
    # IPS: E[safe * (1/propensity)] / E[1/propensity]
    ips_numerator = float(np.mean(y * sample_weights))
    ips_denominator = float(np.mean(sample_weights))
    ips = ips_numerator / ips_denominator if ips_denominator > 0 else 0.0

    # SNIPS: normalized IPS
    snips = ips  # Same formula but normalized by the sum of weights

    # DR (Doubly Robust) — simplified version using model predictions as q_hat
    try:
        q_hat_t3 = tier3_clf.predict_proba(X)[:, 1]
        dr_adjustment = y - q_hat_t3
        dr_numerator = float(np.mean(q_hat_t3 + dr_adjustment * sample_weights))
        dr = max(0.0, min(1.0, dr_numerator))
    except Exception:
        dr = None

    return {
        "ips": round(ips, 4),
        "snips": round(snips, 4),
        "dr": round(dr, 4) if dr is not None else None,
        "n_samples": len(samples),
    }


def main():
    parser = argparse.ArgumentParser(description="Train ML router policy")
    parser.add_argument("--training-dir", required=True, help="Directory with training JSONL files")
    parser.add_argument("--output-dir", default="./models", help="Output directory for model artifacts")
    parser.add_argument("--min-samples", type=int, default=100, help="Minimum total samples required")
    parser.add_argument("--min-samples-per-tier", type=int, default=50, help="Minimum samples per tier")
    args = parser.parse_args()
    train(args)


if __name__ == "__main__":
    main()
