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
        "quota_exhausted_cooldown_seconds": 3600,
        "auth_error_cooldown_seconds": 21600,
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

    def test_quota_exhausted_uses_long_cooldown_without_threshold(self):
        """Quota-style failures should immediately enter a long cooldown."""
        tracker = make_tracker(quota_exhausted_cooldown_seconds=1800)
        tracker.mark_unavailable("glm-5.1", reason="quota_exhausted", detail="usage limit reached")

        self.assertFalse(tracker.is_available("glm-5.1"))
        remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()
        self.assertAlmostEqual(remaining, 1800, delta=1)
        self.assertEqual(tracker.get_unavailability("glm-5.1")["reason"], "quota_exhausted")

    def test_retry_after_overrides_transient_backoff(self):
        """Provider retry-after should win over exponential backoff."""
        tracker = make_tracker()
        tracker.mark_unavailable("glm-5.1", reason="transient_rate_limit", retry_after_seconds=45)

        remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()
        self.assertAlmostEqual(remaining, 45, delta=1)

    def test_durable_reason_clears_after_success(self):
        """A successful probe should clear durable-unavailable metadata."""
        tracker = make_tracker()
        tracker.mark_unavailable("glm-5.1", reason="quota_exhausted", detail="usage limit reached")

        tracker.record("glm-5.1", 500, success=True)

        self.assertTrue(tracker.is_available("glm-5.1"))
        self.assertIsNone(tracker.get_unavailability("glm-5.1"))

    def test_reset_at_epoch_controls_cooldown(self):
        """Provider reset epochs should be converted into cooldown duration."""
        tracker = make_tracker()
        future_epoch = time.time() + 90

        tracker.mark_unavailable("glm-5.1", reason="quota_exhausted", reset_at_epoch=future_epoch)

        remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()
        self.assertAlmostEqual(remaining, 90, delta=2)

    def test_transient_mark_does_not_override_active_durable_lockout(self):
        """Transient re-marks should not shorten an active durable cooldown."""
        tracker = make_tracker(quota_exhausted_cooldown_seconds=1800)
        tracker.mark_unavailable("glm-5.1", reason="quota_exhausted", detail="usage limit reached")
        first_remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()

        tracker.mark_unavailable("glm-5.1", reason="transient_failure")
        second_remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()

        self.assertGreater(second_remaining, 1700)
        self.assertAlmostEqual(second_remaining, first_remaining, delta=2)
        self.assertEqual(tracker.get_unavailability("glm-5.1")["reason"], "quota_exhausted")

    def test_transient_mark_applies_short_cooldown_for_generic_failure(self):
        """A generic single failure should still trigger immediate short cooldown."""
        tracker = make_tracker()

        tracker.mark_unavailable("glm-5.1", reason="transient_failure")

        self.assertFalse(tracker.is_available("glm-5.1"))
        remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()
        self.assertAlmostEqual(remaining, 120, delta=1)

    def test_transient_failure_does_not_override_retry_after_window(self):
        """Fallback re-marks should not overwrite a provider-supplied retry window."""
        tracker = make_tracker()
        tracker.mark_unavailable("glm-5.1", reason="transient_rate_limit", retry_after_seconds=30)
        first_remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()

        tracker.mark_unavailable("glm-5.1", reason="transient_failure")
        second_remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()

        self.assertAlmostEqual(first_remaining, 30, delta=1)
        self.assertAlmostEqual(second_remaining, 30, delta=1)
        self.assertEqual(tracker.get_unavailability("glm-5.1")["reason"], "transient_rate_limit")

    def test_durable_lockout_is_not_shortened_by_transient_rate_limit(self):
        """A later transient rate limit should not shorten an active durable lockout."""
        tracker = make_tracker(quota_exhausted_cooldown_seconds=1800)
        tracker.mark_unavailable("glm-5.1", reason="quota_exhausted", detail="usage limit reached")
        first_remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()

        tracker.mark_unavailable("glm-5.1", reason="transient_rate_limit", retry_after_seconds=30)
        second_remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()

        self.assertGreater(second_remaining, 1700)
        self.assertAlmostEqual(second_remaining, first_remaining, delta=2)
        self.assertEqual(tracker.get_unavailability("glm-5.1")["reason"], "quota_exhausted")

    def test_same_priority_durable_mark_does_not_shorten_existing_window(self):
        """A same-priority durable reason should not shorten a longer existing cooldown."""
        tracker = make_tracker(quota_exhausted_cooldown_seconds=1800)
        tracker.mark_unavailable("glm-5.1", reason="quota_exhausted")
        first_remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()

        tracker.mark_unavailable("glm-5.1", reason="quota_exhausted", retry_after_seconds=30)
        second_remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()

        self.assertGreater(second_remaining, 1700)
        self.assertAlmostEqual(second_remaining, first_remaining, delta=2)

    def test_same_priority_retry_window_is_preserved_for_server_error(self):
        """A fallback transient mark should not overwrite retry-after on retryable 5xx errors."""
        tracker = make_tracker()
        tracker.mark_unavailable("glm-5.1", reason="server_error", retry_after_seconds=25)
        first_remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()

        tracker.mark_unavailable("glm-5.1", reason="transient_failure")
        second_remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()

        self.assertAlmostEqual(first_remaining, 25, delta=1)
        self.assertAlmostEqual(second_remaining, 25, delta=1)
        self.assertEqual(tracker.get_unavailability("glm-5.1")["reason"], "server_error")

    def test_higher_priority_shorter_window_does_not_shorten_existing_cooldown(self):
        """A later stronger signal with shorter retry-after should not reduce current lockout."""
        tracker = make_tracker()
        tracker.mark_unavailable("glm-5.1", reason="transient_failure")
        first_remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()

        tracker.mark_unavailable("glm-5.1", reason="transient_rate_limit", retry_after_seconds=30)
        second_remaining = tracker._cooldown_until["glm-5.1"] - time.monotonic()

        self.assertGreater(first_remaining, 100)
        self.assertAlmostEqual(second_remaining, first_remaining, delta=2)

    def test_preserved_transient_mark_does_not_advance_backoff_counter(self):
        """Ignored transient re-marks should not poison future exponential backoff."""
        tracker = make_tracker(quota_exhausted_cooldown_seconds=1800)
        tracker.mark_unavailable("glm-5.1", reason="quota_exhausted")

        tracker.mark_unavailable("glm-5.1", reason="transient_failure")

        self.assertEqual(tracker._backoff_count.get("glm-5.1", 0), 0)


if __name__ == "__main__":
    unittest.main()
