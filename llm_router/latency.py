"""Passive latency tracker — records request outcomes and determines model availability."""

import time
import logging
from collections import deque

logger = logging.getLogger("llm_router")

_WINDOW_SIZE = 20  # sliding window per model


class LatencyTracker:
    """Tracks per-model latency and error rates using a sliding window."""

    def __init__(self, fallback_config: dict):
        self.latency_threshold_ms = fallback_config.get("latency_threshold_ms", 30000)
        self.error_threshold = fallback_config.get("error_threshold", 3)
        self.cooldown_seconds = fallback_config.get("cooldown_seconds", 120)

        # model_id -> deque of (timestamp, latency_ms, success)
        self._records: dict[str, deque] = {}
        # model_id -> timestamp when marked unavailable
        self._cooldown_until: dict[str, float] = {}
        # model_id -> consecutive error count
        self._consecutive_errors: dict[str, int] = {}

    def record(self, model_id: str, latency_ms: float, success: bool):
        """Record a completed request."""
        if model_id not in self._records:
            self._records[model_id] = deque(maxlen=_WINDOW_SIZE)
        self._records[model_id].append((time.monotonic(), latency_ms, success))

        if success:
            self._consecutive_errors[model_id] = 0
            # Clear cooldown on success
            self._cooldown_until.pop(model_id, None)
        else:
            self._consecutive_errors[model_id] = self._consecutive_errors.get(model_id, 0) + 1
            if self._consecutive_errors[model_id] >= self.error_threshold:
                self.mark_unavailable(model_id)

        status = "ok" if success else "error"
        logger.debug(f"Recorded {model_id}: {latency_ms:.0f}ms ({status}), "
                     f"consecutive_errors={self._consecutive_errors.get(model_id, 0)}")

    def mark_unavailable(self, model_id: str):
        """Explicitly mark a model as unavailable (e.g. after fallback)."""
        until = time.monotonic() + self.cooldown_seconds
        self._cooldown_until[model_id] = until
        logger.warning(f"Marked {model_id} unavailable until cooldown ({self.cooldown_seconds}s)")

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

    def get_consecutive_errors(self, model_id: str) -> int:
        """Get consecutive error count for a model."""
        return self._consecutive_errors.get(model_id, 0)

    def get_stats(self) -> list[dict]:
        """Get stats for all tracked models."""
        stats = []
        for model_id, records in self._records.items():
            recent = list(records)
            avg_lat = sum(r[1] for r in recent) / len(recent) if recent else None
            stats.append({
                "model_id": model_id,
                "available": self.is_available(model_id),
                "avg_latency_ms": round(avg_lat, 1) if avg_lat else None,
                "consecutive_errors": self._consecutive_errors.get(model_id, 0),
                "total_requests": len(recent),
            })
        return stats
