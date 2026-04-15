import time
import unittest
from unittest.mock import patch

from llm_router.latency import LatencyTracker


def make_tracker(**overrides) -> LatencyTracker:
    config = {
        "latency_threshold_ms": 30000,
        "error_threshold": 3,
        "cooldown_seconds": 120,
        "cooldown_max_seconds": 600,
        "cross_provider": True,
        "cross_tier": True,
        "degradation_order": ["tier1", "tier2", "tier3"],
    }
    config.update(overrides)
    return LatencyTracker(config)


class ExponentialBackoffTests(unittest.TestCase):
    """Tests for TCP-inspired exponential backoff in cooldown."""

    def test_first_backoff_is_base_cooldown(self):
        """First 429 cycle should use base cooldown (120s)."""
        tracker = make_tracker()
        tracker.mark_unavailable("glm-5.1")

        # Should be unavailable for ~120s
        remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()
        self.assertAlmostEqual(remaining, 120, delta=1)

    def test_second_backoff_doubles(self):
        """Second consecutive 429 cycle should double to 240s."""
        tracker = make_tracker()
        tracker.mark_unavailable("glm-5.1")  # 120s
        tracker.mark_unavailable("glm-5.1")  # 240s

        remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()
        self.assertAlmostEqual(remaining, 240, delta=1)

    def test_third_backoff_quadruples(self):
        """Third consecutive 429 cycle should be 480s."""
        tracker = make_tracker()
        tracker.mark_unavailable("glm-5.1")  # 120s
        tracker.mark_unavailable("glm-5.1")  # 240s
        tracker.mark_unavailable("glm-5.1")  # 480s

        remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()
        self.assertAlmostEqual(remaining, 480, delta=1)

    def test_backoff_capped_at_max(self):
        """Backoff should cap at cooldown_max_seconds (600s)."""
        tracker = make_tracker()
        for _ in range(10):
            tracker.mark_unavailable("glm-5.1")

        remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()
        self.assertAlmostEqual(remaining, 600, delta=1)
        self.assertLessEqual(remaining, 601)

    def test_success_resets_backoff(self):
        """A successful request should reset backoff count to zero."""
        tracker = make_tracker()
        tracker.mark_unavailable("glm-5.1")  # 120s, count=1
        tracker.mark_unavailable("glm-5.1")  # 240s, count=2

        # Simulate success
        tracker.record("glm-5.1", 500, success=True)

        self.assertEqual(tracker._backoff_count.get("glm-5.1", 0), 0)

        # Next failure should start fresh at 120s
        tracker.mark_unavailable("glm-5.1")
        remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()
        self.assertAlmostEqual(remaining, 120, delta=1)

    def test_backoff_sequence_full_lifecycle(self):
        """Simulate the real-world cycle: 429→cooldown→429→cooldown→success→429."""
        tracker = make_tracker()

        # Cycle 1: 429
        tracker.mark_unavailable("glm-5.1")  # 120s
        self.assertAlmostEqual(
            tracker._cooldown_until["glm-5.1"] - time.monotonic(), 120, delta=1
        )

        # Cycle 2: still hitting 429
        tracker.mark_unavailable("glm-5.1")  # 240s
        self.assertAlmostEqual(
            tracker._cooldown_until["glm-5.1"] - time.monotonic(), 240, delta=1
        )

        # Cycle 3: still hitting 429
        tracker.mark_unavailable("glm-5.1")  # 480s
        self.assertAlmostEqual(
            tracker._cooldown_until["glm-5.1"] - time.monotonic(), 480, delta=1
        )

        # Cooldown expires, request succeeds
        tracker._cooldown_until.pop("glm-5.1", None)
        tracker._consecutive_errors["glm-5.1"] = 0
        tracker.record("glm-5.1", 2000, success=True)

        # Backoff should be reset
        self.assertEqual(tracker._backoff_count.get("glm-5.1", 0), 0)

        # New 429 → starts from 120s again
        tracker.mark_unavailable("glm-5.1")
        remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()
        self.assertAlmostEqual(remaining, 120, delta=1)

    def test_record_error_triggers_backoff_after_threshold(self):
        """record() with enough errors should trigger mark_unavailable with backoff."""
        tracker = make_tracker(error_threshold=3)

        # Record 3 consecutive failures
        tracker.record("glm-5.1", 100, success=False)
        tracker.record("glm-5.1", 100, success=False)
        tracker.record("glm-5.1", 100, success=False)

        # Should be in cooldown with first backoff (120s)
        self.assertFalse(tracker.is_available("glm-5.1"))
        remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()
        self.assertAlmostEqual(remaining, 120, delta=1)

        # Simulate cooldown expiry + immediate 429 again
        tracker._cooldown_until.pop("glm-5.1", None)
        tracker._consecutive_errors["glm-5.1"] = 0

        tracker.record("glm-5.1", 100, success=False)
        tracker.record("glm-5.1", 100, success=False)
        tracker.record("glm-5.1", 100, success=False)

        # Second backoff cycle → 240s
        remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()
        self.assertAlmostEqual(remaining, 240, delta=1)

    def test_independent_models_track_independently(self):
        """Each model should have independent backoff state."""
        tracker = make_tracker()

        tracker.mark_unavailable("glm-5.1")  # 120s
        tracker.mark_unavailable("glm-5.1")  # 240s
        tracker.mark_unavailable("glm-5")    # 120s (independent)

        remaining_51 = tracker._cooldown_until["glm-5.1"] - time.monotonic()
        remaining_5 = tracker._cooldown_until["glm-5"] - time.monotonic()

        self.assertAlmostEqual(remaining_51, 240, delta=1)
        self.assertAlmostEqual(remaining_5, 120, delta=1)

    def test_custom_max_cooldown(self):
        """cooldown_max_seconds should be configurable."""
        tracker = make_tracker(cooldown_seconds=60, cooldown_max_seconds=300)
        tracker.mark_unavailable("glm-5.1")  # 60s
        tracker.mark_unavailable("glm-5.1")  # 120s
        tracker.mark_unavailable("glm-5.1")  # 240s
        tracker.mark_unavailable("glm-5.1")  # 300s (capped)

        remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()
        self.assertAlmostEqual(remaining, 300, delta=1)

    def test_success_clears_cooldown_early(self):
        """A success during cooldown should clear it and reset backoff."""
        tracker = make_tracker()
        tracker.mark_unavailable("glm-5.1")  # 120s, count=1
        tracker.mark_unavailable("glm-5.1")  # 240s, count=2

        self.assertFalse(tracker.is_available("glm-5.1"))

        # Success clears cooldown immediately
        tracker.record("glm-5.1", 500, success=True)
        self.assertTrue(tracker.is_available("glm-5.1"))
        self.assertEqual(tracker._backoff_count.get("glm-5.1", 0), 0)


if __name__ == "__main__":
    unittest.main()
