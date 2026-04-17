"""Dataclasses for the evaluation framework."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class ReplayMode(Enum):
    """Evaluation replay mode."""

    HYBRID = "hybrid"  # v1: scoring replay + log field reading
    FULL_ROUTING = "full_routing"  # reserved for v2


@dataclass
class EvalRecord:
    """Single evaluation record pairing replay results with logged runtime data.

    Clearly separates replay-derived fields (prefixed replayed_) from
    log-derived runtime fields (prefixed logged_).
    """

    # ---基础标识---
    request_id: str
    timestamp: str

    # ---replay侧---
    replayed_selected_tier: str | None = None
    replayed_tier_scores: dict[str, float] | None = None
    replayed_detected_features: list[str] | None = None
    replayed_task_type: str | None = None
    replayed_threshold_snapshot: dict | None = None
    replayed_config_version: str | None = None
    replay_changed_vs_logged_tier: bool | None = None

    # ---logged侧---
    logged_routed_tier: str | None = None
    logged_routed_model: str | None = None
    logged_routed_provider: str | None = None
    logged_latency_ms: float | None = None
    logged_ttft_ms: float | None = None
    logged_is_fallback: bool = False
    logged_fallback_chain: list[dict] = field(default_factory=list)
    logged_estimated_tokens: int | None = None
    logged_input_tokens: int | None = None
    logged_output_tokens: int | None = None
    logged_config_version: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "request_id": self.request_id,
            "timestamp": self.timestamp,
            "replayed_selected_tier": self.replayed_selected_tier,
            "replayed_tier_scores": self.replayed_tier_scores,
            "replayed_detected_features": self.replayed_detected_features,
            "replayed_task_type": self.replayed_task_type,
            "replayed_threshold_snapshot": self.replayed_threshold_snapshot,
            "replayed_config_version": self.replayed_config_version,
            "replay_changed_vs_logged_tier": self.replay_changed_vs_logged_tier,
            "logged_routed_tier": self.logged_routed_tier,
            "logged_routed_model": self.logged_routed_model,
            "logged_routed_provider": self.logged_routed_provider,
            "logged_latency_ms": self.logged_latency_ms,
            "logged_ttft_ms": self.logged_ttft_ms,
            "logged_is_fallback": self.logged_is_fallback,
            "logged_fallback_chain": self.logged_fallback_chain,
            "logged_estimated_tokens": self.logged_estimated_tokens,
            "logged_input_tokens": self.logged_input_tokens,
            "logged_output_tokens": self.logged_output_tokens,
            "logged_config_version": self.logged_config_version,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> EvalRecord:
        return cls(
            request_id=d.get("request_id", ""),
            timestamp=d.get("timestamp", ""),
            replayed_selected_tier=d.get("replayed_selected_tier"),
            replayed_tier_scores=d.get("replayed_tier_scores"),
            replayed_detected_features=d.get("replayed_detected_features"),
            replayed_task_type=d.get("replayed_task_type"),
            replayed_threshold_snapshot=d.get("replayed_threshold_snapshot"),
            replayed_config_version=d.get("replayed_config_version"),
            replay_changed_vs_logged_tier=d.get("replay_changed_vs_logged_tier"),
            logged_routed_tier=d.get("logged_routed_tier"),
            logged_routed_model=d.get("logged_routed_model"),
            logged_routed_provider=d.get("logged_routed_provider"),
            logged_latency_ms=d.get("logged_latency_ms"),
            logged_ttft_ms=d.get("logged_ttft_ms"),
            logged_is_fallback=d.get("logged_is_fallback", False),
            logged_fallback_chain=d.get("logged_fallback_chain") or [],
            logged_estimated_tokens=d.get("logged_estimated_tokens"),
            logged_input_tokens=d.get("logged_input_tokens"),
            logged_output_tokens=d.get("logged_output_tokens"),
            logged_config_version=d.get("logged_config_version"),
        )


@dataclass
class ReplayMetrics:
    """Replay-derived metrics."""

    total_requests: int = 0
    tier_distribution: dict[str, dict[str, Any]] = field(default_factory=dict)
    task_type_distribution: dict[str, dict[str, Any]] = field(default_factory=dict)
    detected_features_counts: dict[str, int] = field(default_factory=dict)


@dataclass
class LoggedRuntimeMetrics:
    """Log-derived runtime metrics."""

    tier_distribution: dict[str, dict[str, Any]] = field(default_factory=dict)
    model_distribution: dict[str, dict[str, Any]] = field(default_factory=dict)
    provider_distribution: dict[str, dict[str, Any]] = field(default_factory=dict)
    latency_avg_ms: float | None = None
    latency_p50_ms: float | None = None
    latency_p95_ms: float | None = None
    ttft_avg_ms: float | None = None
    fallback_rate: float = 0.0
    avg_estimated_tokens: float | None = None


@dataclass
class ReplayVsLoggedComparison:
    """Comparison between replay and logged routing decisions."""

    tier_agreement_rate: float = 0.0
    tier_change_counts: dict[str, int] = field(default_factory=dict)
    top_changed_tiers: list[dict[str, Any]] = field(default_factory=list)
    sampled_changed_records: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class EvalSummary:
    """Complete evaluation summary with three metric sections."""

    replay_metrics: ReplayMetrics = field(default_factory=ReplayMetrics)
    logged_runtime_metrics: LoggedRuntimeMetrics = field(default_factory=LoggedRuntimeMetrics)
    replay_vs_logged_comparison: ReplayVsLoggedComparison = field(
        default_factory=ReplayVsLoggedComparison
    )


@dataclass
class EvalMetadata:
    """Evaluation run metadata."""

    log_file: str = ""
    config_path: str = ""
    replay_mode: ReplayMode = ReplayMode.HYBRID
    total_loaded: int = 0
    total_evaluated: int = 0
    filtered_out: int = 0
    evaluation_time_seconds: float = 0.0
    config_version: str | None = None


@dataclass
class EvalResult:
    """Complete evaluation result returned by runner.run()."""

    records: list[EvalRecord] = field(default_factory=list)
    summary: EvalSummary = field(default_factory=EvalSummary)
    metadata: EvalMetadata = field(default_factory=EvalMetadata)

    def to_dict(self) -> dict[str, Any]:
        return {
            "metadata": {
                "log_file": self.metadata.log_file,
                "config_path": self.metadata.config_path,
                "replay_mode": self.metadata.replay_mode.value,
                "total_loaded": self.metadata.total_loaded,
                "total_evaluated": self.metadata.total_evaluated,
                "filtered_out": self.metadata.filtered_out,
                "evaluation_time_seconds": round(self.metadata.evaluation_time_seconds, 3),
                "config_version": self.metadata.config_version,
            },
            "replay_metrics": {
                "total_requests": self.summary.replay_metrics.total_requests,
                "tier_distribution": self.summary.replay_metrics.tier_distribution,
                "task_type_distribution": self.summary.replay_metrics.task_type_distribution,
                "detected_features_counts": self.summary.replay_metrics.detected_features_counts,
            },
            "logged_runtime_metrics": {
                "tier_distribution": self.summary.logged_runtime_metrics.tier_distribution,
                "model_distribution": self.summary.logged_runtime_metrics.model_distribution,
                "provider_distribution": self.summary.logged_runtime_metrics.provider_distribution,
                "latency_avg_ms": self.summary.logged_runtime_metrics.latency_avg_ms,
                "latency_p50_ms": self.summary.logged_runtime_metrics.latency_p50_ms,
                "latency_p95_ms": self.summary.logged_runtime_metrics.latency_p95_ms,
                "ttft_avg_ms": self.summary.logged_runtime_metrics.ttft_avg_ms,
                "fallback_rate": self.summary.logged_runtime_metrics.fallback_rate,
                "avg_estimated_tokens": self.summary.logged_runtime_metrics.avg_estimated_tokens,
            },
            "replay_vs_logged_comparison": {
                "tier_agreement_rate": self.summary.replay_vs_logged_comparison.tier_agreement_rate,
                "tier_change_counts": self.summary.replay_vs_logged_comparison.tier_change_counts,
                "top_changed_tiers": self.summary.replay_vs_logged_comparison.top_changed_tiers,
                "sampled_changed_records": self.summary.replay_vs_logged_comparison.sampled_changed_records,
            },
            "sampled_records": [r.to_dict() for r in self.records[:20]],
        }
