"""Compute evaluation metrics from EvalRecord list."""

from __future__ import annotations

import statistics
from collections import Counter
from typing import Any

from .schemas import (
    EvalRecord,
    EvalSummary,
    LoggedRuntimeMetrics,
    ReplayMetrics,
    ReplayVsLoggedComparison,
)


def _distribution(values: list[str]) -> dict[str, dict[str, Any]]:
    """Build {value: {count, percentage}} dict from a list of string values."""
    if not values:
        return {}
    total = len(values)
    counts = Counter(v for v in values if v)
    return {
        k: {"count": count, "percentage": round(count / total * 100, 2)}
        for k, count in counts.most_common()
    }


def _percentile(values: list[float], p: float) -> float | None:
    """Return the p-th percentile of a list of numbers, or None if empty."""
    if not values:
        return None
    sorted_vals = sorted(values)
    idx = int(len(sorted_vals) * p / 100)
    # Clamp to last element
    idx = min(idx, len(sorted_vals) - 1)
    return round(sorted_vals[idx], 2)


def compute(records: list[EvalRecord]) -> EvalSummary:
    """Compute all three metric sections from a list of EvalRecord."""
    replay_metrics = _compute_replay_metrics(records)
    logged_metrics = _compute_logged_runtime_metrics(records)
    comparison = _compute_comparison(records)
    return EvalSummary(
        replay_metrics=replay_metrics,
        logged_runtime_metrics=logged_metrics,
        replay_vs_logged_comparison=comparison,
    )


def _compute_replay_metrics(records: list[EvalRecord]) -> ReplayMetrics:
    total = len(records)
    if total == 0:
        return ReplayMetrics()

    tiers = [r.replayed_selected_tier for r in records]
    task_types = [r.replayed_task_type for r in records if r.replayed_task_type]

    # Flatten detected features
    feature_counter: Counter = Counter()
    for r in records:
        if r.replayed_detected_features:
            feature_counter.update(r.replayed_detected_features)

    return ReplayMetrics(
        total_requests=total,
        tier_distribution=_distribution(tiers),
        task_type_distribution=_distribution(task_types),
        detected_features_counts=dict(feature_counter),
    )


def _compute_logged_runtime_metrics(records: list[EvalRecord]) -> LoggedRuntimeMetrics:
    if not records:
        return LoggedRuntimeMetrics()

    tiers = [r.logged_routed_tier for r in records]
    models = [r.logged_routed_model for r in records]
    providers = [r.logged_routed_provider for r in records]

    latencies = [r.logged_latency_ms for r in records if r.logged_latency_ms is not None]
    ttfts = [r.logged_ttft_ms for r in records if r.logged_ttft_ms is not None]
    tokens = [r.logged_estimated_tokens for r in records if r.logged_estimated_tokens is not None]
    fallback_count = sum(1 for r in records if r.logged_is_fallback)

    avg_tokens = round(sum(tokens) / len(tokens), 2) if tokens else None

    return LoggedRuntimeMetrics(
        tier_distribution=_distribution(tiers),
        model_distribution=_distribution(models),
        provider_distribution=_distribution(providers),
        latency_avg_ms=round(sum(latencies) / len(latencies), 2) if latencies else None,
        latency_p50_ms=_percentile(latencies, 50),
        latency_p95_ms=_percentile(latencies, 95),
        ttft_avg_ms=round(sum(ttfts) / len(ttfts), 2) if ttfts else None,
        fallback_rate=round(fallback_count / len(records), 4) if records else 0.0,
        avg_estimated_tokens=avg_tokens,
    )


def _compute_comparison(records: list[EvalRecord]) -> ReplayVsLoggedComparison:
    if not records:
        return ReplayVsLoggedComparison()

    evaluable = [r for r in records if r.replayed_selected_tier and r.logged_routed_tier]
    if not evaluable:
        return ReplayVsLoggedComparison()

    # Tier agreement
    agreed = sum(
        1 for r in evaluable if r.replayed_selected_tier == r.logged_routed_tier
    )
    agreement_rate = round(agreed / len(evaluable), 4)

    # Tier change counts (from logged → replayed)
    change_counter: Counter = Counter()
    for r in evaluable:
        if r.replayed_selected_tier != r.logged_routed_tier:
            from_to = f"{r.logged_routed_tier}→{r.replayed_selected_tier}"
            change_counter[from_to] += 1

    top_changed = [
        {"from": k.split("→")[0], "to": k.split("→")[1], "count": count}
        for k, count in change_counter.most_common(10)
    ]

    # Sampled changed records (up to 10)
    changed_records = [
        r for r in evaluable if r.replayed_selected_tier != r.logged_routed_tier
    ][:10]
    sampled = [r.to_dict() for r in changed_records]

    return ReplayVsLoggedComparison(
        tier_agreement_rate=agreement_rate,
        tier_change_counts=dict(change_counter),
        top_changed_tiers=top_changed,
        sampled_changed_records=sampled,
    )
