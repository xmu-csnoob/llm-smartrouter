"""Core evaluation runner: orchestrates replay and metric computation."""

from __future__ import annotations

import hashlib
import logging
import time
from pathlib import Path
from typing import Any

import yaml

from ..scoring import DEFAULT_SCORING_CONFIG, merge_scoring_config, RequestScorer
from .loader import load
from .metrics import compute
from .schemas import (
    EvalMetadata,
    EvalRecord,
    EvalResult,
    ReplayMode,
)

logger = logging.getLogger("llm_router.evaluation")


def run(
    log_file: str | Path,
    config_path: str | Path,
    limit: int | None = None,
    hours: int | None = None,
    mode: ReplayMode = ReplayMode.HYBRID,
) -> EvalResult:
    """Run offline evaluation on a JSONL log file.

    Args:
        log_file: Path to the JSONL request log.
        config_path: Path to config.yaml.
        limit: Maximum entries to process (None = all).
        hours: Filter to last N hours (None = no filter).
        mode: ReplayMode (v1 only supports HYBRID).

    Returns:
        EvalResult with records, summary, and metadata.
    """
    t0 = time.monotonic()

    # 1. Load and normalize log entries
    entries, filtered_out = load(log_file, limit=limit, hours=hours)
    total_loaded = len(entries)
    logger.info("Loaded %d entries from %s (filtered_out=%d)", total_loaded, log_file, filtered_out)

    if not entries:
        metadata = EvalMetadata(
            log_file=str(log_file),
            config_path=str(config_path),
            replay_mode=mode,
            total_loaded=0,
            total_evaluated=0,
            filtered_out=filtered_out,
            evaluation_time_seconds=0.0,
        )
        return EvalResult(records=[], metadata=metadata)

    # 2. Load only scoring-relevant config — no provider env var expansion needed
    scoring_config, tier_order, config_version = _load_eval_config(config_path)
    scorer = RequestScorer(
        scoring_config=scoring_config,
        tier_order=tier_order,
    )

    # 3. Replay each entry
    records: list[EvalRecord] = []
    for entry in entries:
        record = _replay_entry(entry, scorer, config_version, mode)
        records.append(record)

    # 4. Compute metrics
    summary = compute(records)

    elapsed = time.monotonic() - t0
    metadata = EvalMetadata(
        log_file=str(log_file),
        config_path=str(config_path),
        replay_mode=mode,
        total_loaded=total_loaded,
        total_evaluated=len(records),
        filtered_out=filtered_out,
        evaluation_time_seconds=elapsed,
        config_version=config_version,
    )

    return EvalResult(records=records, summary=summary, metadata=metadata)


def _load_eval_config(config_path: str | Path) -> tuple[dict, list[str], str]:
    """Load scoring-relevant config without triggering provider env var expansion.

    Returns (scoring_config, tier_order, config_version_hash).
    Only reads the sections needed for offline scoring replay.
    """
    with open(config_path) as f:
        raw = yaml.safe_load(f)

    scoring_raw = raw.get("scoring", {})
    scoring_config = merge_scoring_config(scoring_raw)

    # Tier order: use degradation_order from fallback, or models keys
    fallback_cfg = raw.get("fallback", {})
    tier_order = fallback_cfg.get("degradation_order") or list(raw.get("models", {}).keys())

    # Config version: hash of scoring + tier order sections
    version_payload = {
        "scoring": scoring_raw,
        "tier_order": tier_order,
    }
    import json

    config_version = hashlib.sha1(
        json.dumps(version_payload, sort_keys=True, default=str).encode()
    ).hexdigest()[:12]

    return scoring_config, tier_order, config_version


def _replay_entry(
    entry: dict[str, Any],
    scorer: RequestScorer,
    config_version: str,
    mode: ReplayMode,
) -> EvalRecord:
    """Replay a single normalized log entry through the scoring layer."""
    # Extract raw replay inputs
    feature_values = entry.get("_raw_feature_values")
    legacy_matches = entry.get("_raw_legacy_rule_matches") or []

    # Run scoring directly via RequestScorer (no Router, no provider env vars)
    replay_result = None
    if feature_values and isinstance(feature_values, dict):
        result = scorer.score_feature_snapshot(feature_values, legacy_matches)
        previous_selected = entry.get("logged_routed_tier") or entry.get("selected_tier")
        replay_result = {
            "request_id": entry.get("request_id"),
            "previous_selected_tier": previous_selected,
            "replayed_selected_tier": result["selected_tier"],
            "changed": previous_selected != result["selected_tier"],
            "tier_scores": result["tier_scores"],
            "detected_features": result["detected_features"],
            "task_type": result["task_type"],
        }

    # Build EvalRecord — merge replay result with logged runtime fields
    if replay_result:
        replay_changed = (
            replay_result.get("replayed_selected_tier") != entry.get("logged_routed_tier")
        )
        replayed_tier = replay_result.get("replayed_selected_tier")
        replayed_scores = replay_result.get("tier_scores")
        replayed_features = replay_result.get("detected_features")
        replayed_task_type = replay_result.get("task_type")
    else:
        replay_changed = None
        replayed_tier = None
        replayed_scores = None
        replayed_features = None
        replayed_task_type = None

    record = EvalRecord(
        request_id=entry.get("request_id") or "",
        timestamp=entry.get("timestamp") or "",
        replayed_selected_tier=replayed_tier,
        replayed_tier_scores=replayed_scores,
        replayed_detected_features=replayed_features,
        replayed_task_type=replayed_task_type,
        replayed_config_version=config_version,
        replay_changed_vs_logged_tier=replay_changed,
        logged_routed_tier=entry.get("logged_routed_tier"),
        logged_routed_model=entry.get("logged_routed_model"),
        logged_routed_provider=entry.get("logged_routed_provider"),
        logged_latency_ms=entry.get("logged_latency_ms"),
        logged_ttft_ms=entry.get("logged_ttft_ms"),
        logged_is_fallback=entry.get("logged_is_fallback") or False,
        logged_fallback_chain=entry.get("logged_fallback_chain") or [],
        logged_estimated_tokens=entry.get("logged_estimated_tokens"),
    )
    return record
