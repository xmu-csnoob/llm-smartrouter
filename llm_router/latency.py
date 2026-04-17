"""Passive latency tracker — records request outcomes and determines model availability."""

import time
import logging
from collections import deque
from typing import Any

from .upstream_errors import UpstreamErrorInfo

logger = logging.getLogger("llm_router")

_WINDOW_SIZE = 20  # sliding window per model


class LatencyTracker:
    """Tracks per-model latency and error rates using a sliding window."""

    def __init__(self, fallback_config: dict):
        self.latency_threshold_ms = fallback_config.get("latency_threshold_ms", 30000)
        self.error_threshold = fallback_config.get("error_threshold", 3)
        self.cooldown_seconds = fallback_config.get("cooldown_seconds", 120)
        self.cooldown_max_seconds = fallback_config.get("cooldown_max_seconds", 600)
        self.quota_exhausted_cooldown_seconds = fallback_config.get("quota_exhausted_cooldown_seconds", 3600)
        self.auth_error_cooldown_seconds = fallback_config.get("auth_error_cooldown_seconds", 21600)

        # model_id -> deque of (timestamp, latency_ms, success)
        self._records: dict[str, deque] = {}
        # model_id -> deque of ttft_ms
        self._ttft_records: dict[str, deque] = {}
        # model_id -> timestamp when marked unavailable
        self._cooldown_until: dict[str, float] = {}
        # model_id -> consecutive error count
        self._consecutive_errors: dict[str, int] = {}
        # model_id -> exponential backoff multiplier (number of consecutive cooldown cycles)
        self._backoff_count: dict[str, int] = {}
        # model_id -> unavailability reason metadata
        self._unavailable_reason: dict[str, str] = {}
        self._unavailable_detail: dict[str, str] = {}
        self._unavailable_provider_code: dict[str, str] = {}

    def record(self, model_id: str, latency_ms: float, success: bool, *, error_info: UpstreamErrorInfo | None = None):
        """Record a completed request."""
        if model_id not in self._records:
            self._records[model_id] = deque(maxlen=_WINDOW_SIZE)
        self._records[model_id].append((time.monotonic(), latency_ms, success))

        if success:
            self._consecutive_errors[model_id] = 0
            self._clear_unavailable(model_id)
        else:
            self._consecutive_errors[model_id] = self._consecutive_errors.get(model_id, 0) + 1
            if error_info and error_info.category in {
                "transient_rate_limit",
                "quota_exhausted",
                "auth_error",
                "permission_error",
                "server_error",
                "unknown_upstream_error",
            }:
                self.mark_unavailable(
                    model_id,
                    reason=error_info.category,
                    retry_after_seconds=error_info.retry_after_seconds,
                    reset_at_epoch=error_info.reset_at_epoch,
                    detail=error_info.message,
                    provider_code=error_info.provider_code or error_info.provider_type,
                )
            elif self._consecutive_errors[model_id] >= self.error_threshold:
                self.mark_unavailable(model_id)

        status = "ok" if success else "error"
        logger.debug(f"Recorded {model_id}: {latency_ms:.0f}ms ({status}), "
                     f"consecutive_errors={self._consecutive_errors.get(model_id, 0)}")

    def record_ttft(self, model_id: str, ttft_ms: float):
        """Record time-to-first-token for streaming requests."""
        if model_id not in self._ttft_records:
            self._ttft_records[model_id] = deque(maxlen=_WINDOW_SIZE)
        self._ttft_records[model_id].append(ttft_ms)

    def mark_unavailable(
        self,
        model_id: str,
        reason: str = "transient_failure",
        *,
        retry_after_seconds: float | None = None,
        reset_at_epoch: float | None = None,
        detail: str | None = None,
        provider_code: str | None = None,
    ):
        """Mark a model as unavailable with reason-aware cooldown behavior."""
        reset_backoff = None
        if reset_at_epoch is not None:
            reset_backoff = max(reset_at_epoch - time.time(), 0.0)

        if retry_after_seconds is not None:
            backoff = retry_after_seconds
        elif reset_backoff is not None:
            backoff = reset_backoff
        elif reason == "quota_exhausted":
            backoff = self.quota_exhausted_cooldown_seconds
        elif reason in {"auth_error", "permission_error"}:
            backoff = self.auth_error_cooldown_seconds
        else:
            count = self._backoff_count.get(model_id, 0) + 1
            backoff = min(self.cooldown_seconds * (2 ** (count - 1)), self.cooldown_max_seconds)

        if self._should_preserve_existing_unavailability(model_id, reason, backoff):
            return

        if reason == "transient_failure":
            self._backoff_count[model_id] = count
        until = time.monotonic() + backoff
        self._cooldown_until[model_id] = until
        self._unavailable_reason[model_id] = reason
        if detail:
            self._unavailable_detail[model_id] = detail
        else:
            self._unavailable_detail.pop(model_id, None)
        if provider_code:
            self._unavailable_provider_code[model_id] = provider_code
        else:
            self._unavailable_provider_code.pop(model_id, None)

        if reason in {"quota_exhausted", "auth_error", "permission_error"}:
            logger.warning(f"Marked {model_id} unavailable ({reason}, {backoff:.0f}s)")
            return

        count = self._backoff_count.get(model_id, 0)
        logger.warning(f"Marked {model_id} unavailable ({reason}, backoff #{count}, {backoff:.0f}s)")

    def is_available(self, model_id: str) -> bool:
        """Check if a model is available based on latency and error thresholds."""
        now = time.monotonic()

        # Check cooldown
        cooldown_end = self._cooldown_until.get(model_id)
        if cooldown_end is not None:
            if now < cooldown_end:
                return False
            else:
                # Cooldown expired, re-evaluate
                self._cooldown_until.pop(model_id, None)
                self._unavailable_reason.pop(model_id, None)
                self._unavailable_detail.pop(model_id, None)
                self._unavailable_provider_code.pop(model_id, None)
                self._consecutive_errors[model_id] = 0

        # Check consecutive errors
        if self._consecutive_errors.get(model_id, 0) >= self.error_threshold:
            return False

        # Check average latency
        records = self._records.get(model_id)
        if records and len(records) >= 3:
            recent = list(records)[-5:]  # last 5
            avg_latency = sum(r[1] for r in recent) / len(recent)
            if avg_latency > self.latency_threshold_ms:
                return False

        return True

    def get_avg_latency(self, model_id: str) -> float | None:
        """Get average latency for a model."""
        records = self._records.get(model_id)
        if not records:
            return None
        recent = list(records)[-5:]
        return sum(r[1] for r in recent) / len(recent)

    def get_avg_ttft(self, model_id: str) -> float | None:
        """Get average TTFT for a model."""
        records = self._ttft_records.get(model_id)
        if not records:
            return None
        recent = list(records)[-5:]
        return sum(recent) / len(recent)

    def get_consecutive_errors(self, model_id: str) -> int:
        """Get consecutive error count for a model."""
        return self._consecutive_errors.get(model_id, 0)

    def get_unavailability(self, model_id: str) -> dict[str, Any] | None:
        """Return current unavailability metadata for a model, if any."""
        if self.is_available(model_id):
            return None

        cooldown_end = self._cooldown_until.get(model_id)
        remaining_seconds = None
        if cooldown_end is not None:
            remaining_seconds = max(cooldown_end - time.monotonic(), 0.0)

        return {
            "reason": self._unavailable_reason.get(model_id),
            "detail": self._unavailable_detail.get(model_id),
            "provider_code": self._unavailable_provider_code.get(model_id),
            "remaining_seconds": round(remaining_seconds, 1) if remaining_seconds is not None else None,
        }

    def get_stats(self) -> list[dict]:
        """Get stats for all tracked models."""
        stats = []
        for model_id, records in self._records.items():
            recent = list(records)
            avg_lat = sum(r[1] for r in recent) / len(recent) if recent else None
            avg_ttft = self.get_avg_ttft(model_id)
            availability = self.get_unavailability(model_id)
            stats.append({
                "model_id": model_id,
                "available": availability is None,
                "avg_latency_ms": round(avg_lat, 1) if avg_lat else None,
                "avg_ttft_ms": round(avg_ttft, 1) if avg_ttft is not None else None,
                "consecutive_errors": self._consecutive_errors.get(model_id, 0),
                "total_requests": len(recent),
                "unavailable_reason": availability["reason"] if availability else None,
                "unavailable_detail": availability["detail"] if availability else None,
                "unavailable_remaining_seconds": availability["remaining_seconds"] if availability else None,
            })
        return stats

    def _clear_unavailable(self, model_id: str):
        """Clear cooldown and reason metadata after a successful probe."""
        self._cooldown_until.pop(model_id, None)
        self._backoff_count.pop(model_id, None)
        self._unavailable_reason.pop(model_id, None)
        self._unavailable_detail.pop(model_id, None)
        self._unavailable_provider_code.pop(model_id, None)

    def _should_preserve_existing_unavailability(self, model_id: str, new_reason: str, new_backoff: float) -> bool:
        """Do not let a weaker remark override an active stronger cooldown."""
        current_reason = self._unavailable_reason.get(model_id)
        cooldown_end = self._cooldown_until.get(model_id)
        if current_reason is None:
            return False
        if cooldown_end is None or time.monotonic() >= cooldown_end:
            return False
        current_remaining = max(cooldown_end - time.monotonic(), 0.0)
        current_priority = self._reason_priority(current_reason)
        new_priority = self._reason_priority(new_reason)
        if current_remaining >= new_backoff:
            return True
        if current_priority > new_priority:
            return True
        return False

    @staticmethod
    def _reason_priority(reason: str) -> int:
        """Higher priority reasons should not be shortened by weaker follow-up marks."""
        if reason in {"quota_exhausted", "auth_error", "permission_error"}:
            return 3
        if reason in {"transient_rate_limit", "server_error", "unknown_upstream_error"}:
            return 2
        if reason == "transient_failure":
            return 1
        return 0
