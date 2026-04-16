#!/usr/bin/env python3
"""Unit tests for aggregate_shadow_policy_stats (the pure function behind /api/shadow-policy/stats)."""

import unittest

from llm_router.main import aggregate_shadow_policy_stats


def sp(mode=None, enabled=True, exclusion_reason=None, hard_exclusions_triggered=None, candidate_tier=None):
    """Build a shadow_policy_decision dict."""
    d = {"enabled": enabled}
    if mode is not None:
        d["mode"] = mode
    if exclusion_reason is not None:
        d["exclusion_reason"] = exclusion_reason
    if hard_exclusions_triggered is not None:
        d["hard_exclusions_triggered"] = hard_exclusions_triggered
    if candidate_tier is not None:
        d["candidate_tier"] = candidate_tier
    return d


def entry(routed_tier="tier2", latency_ms=500.0, shadow_policy_decision=None, timestamp="2026-04-16T10:00:00+00:00"):
    e = {
        "timestamp": timestamp,
        "routed_model": "gpt-4o",
        "routed_tier": routed_tier,
        "latency_ms": latency_ms,
        "status": 200,
    }
    if shadow_policy_decision is not None:
        e["shadow_policy_decision"] = shadow_policy_decision
    return e


class TestShadowPolicyStatsAggregation(unittest.TestCase):

    def test_empty_entries(self):
        result = aggregate_shadow_policy_stats([], True, 24)
        self.assertEqual(result["total_requests"], 0)
        self.assertEqual(result["shadow_requests"], 0)
        self.assertEqual(result["mode_counts"], {})
        self.assertEqual(result["exclusion_count"], 0)
        self.assertEqual(result["forced_lower_tier_count"], 0)
        self.assertIsNone(result["avg_latency_shadow_ms"])
        self.assertEqual(result["recent_exclusion_events"], [])

    def test_disabled_shadow_policy_returns_zeros(self):
        result = aggregate_shadow_policy_stats([entry()], False, 24)
        self.assertEqual(result["total_requests"], 1)
        self.assertEqual(result["shadow_enabled"], False)
        self.assertEqual(result["shadow_requests"], 0)

    def test_entry_without_shadow_policy_decision_skipped(self):
        # Entry with no shadow_policy_decision at all — not counted as shadow
        result = aggregate_shadow_policy_stats([entry()], True, 24)
        self.assertEqual(result["total_requests"], 1)
        self.assertEqual(result["shadow_requests"], 0)
        self.assertEqual(result["mode_counts"], {})

    def test_entry_with_disabled_shadow_policy_skipped(self):
        result = aggregate_shadow_policy_stats(
            [entry(shadow_policy_decision=sp(enabled=False))], True, 24
        )
        self.assertEqual(result["shadow_requests"], 0)

    def test_mode_counts_single_mode(self):
        entries = [
            entry(shadow_policy_decision=sp(mode="observe_only")),
            entry(shadow_policy_decision=sp(mode="observe_only")),
        ]
        result = aggregate_shadow_policy_stats(entries, True, 24)
        self.assertEqual(result["mode_counts"], {"observe_only": 2})
        self.assertEqual(result["shadow_requests"], 2)

    def test_mode_counts_multiple_modes(self):
        entries = [
            entry(shadow_policy_decision=sp(mode="observe_only")),
            entry(shadow_policy_decision=sp(mode="forced_lower_tier")),
            entry(shadow_policy_decision=sp(mode="forced_lower_tier")),
        ]
        result = aggregate_shadow_policy_stats(entries, True, 24)
        self.assertEqual(result["mode_counts"], {"observe_only": 1, "forced_lower_tier": 2})
        self.assertEqual(result["shadow_requests"], 3)

    def test_exclusion_count_and_reasons(self):
        entries = [
            entry(shadow_policy_decision=sp(
                mode="forced_lower_tier",
                exclusion_reason="high_value",
                hard_exclusions_triggered=["rule_a"],
            )),
            entry(shadow_policy_decision=sp(
                mode="forced_lower_tier",
                exclusion_reason="high_value",
                hard_exclusions_triggered=["rule_b"],
            )),
            entry(shadow_policy_decision=sp(
                mode="forced_lower_tier",
                exclusion_reason="pII_detected",
                hard_exclusions_triggered=[],
            )),
        ]
        result = aggregate_shadow_policy_stats(entries, True, 24)
        self.assertEqual(result["exclusion_count"], 3)
        self.assertEqual(result["exclusion_reasons"]["high_value"], 2)
        self.assertEqual(result["exclusion_reasons"]["pII_detected"], 1)

    def test_exclusion_reason_missing_mode_still_counts_exclusion(self):
        # exclusion_reason present but mode missing — still counts
        entries = [
            entry(shadow_policy_decision=sp(
                exclusion_reason="high_value",
                hard_exclusions_triggered=["rule_a"],
            )),
        ]
        result = aggregate_shadow_policy_stats(entries, True, 24)
        self.assertEqual(result["exclusion_count"], 1)

    def test_recent_exclusion_events_limited_to_20(self):
        events = []
        for i in range(25):
            events.append(entry(
                timestamp=f"2026-04-16T{i:02d}:00:00+00:00",
                shadow_policy_decision=sp(
                    mode="forced_lower_tier",
                    exclusion_reason=f"reason_{i}",
                    hard_exclusions_triggered=[f"rule_{i}"],
                ),
            ))
        result = aggregate_shadow_policy_stats(events, True, 24)
        self.assertEqual(len(result["recent_exclusion_events"]), 20)
        # Should be the last 20 in insertion order
        self.assertEqual(result["recent_exclusion_events"][0]["reason"], "reason_5")

    def test_forced_lower_tier_count_and_transitions(self):
        entries = [
            entry(
                routed_tier="tier2",
                shadow_policy_decision=sp(mode="forced_lower_tier", candidate_tier="tier3"),
            ),
            entry(
                routed_tier="tier2",
                shadow_policy_decision=sp(mode="forced_lower_tier", candidate_tier="tier3"),
            ),
            entry(
                routed_tier="tier1",
                shadow_policy_decision=sp(mode="forced_lower_tier", candidate_tier="tier2"),
            ),
            # observe_only should NOT count as forced
            entry(shadow_policy_decision=sp(mode="observe_only")),
        ]
        result = aggregate_shadow_policy_stats(entries, True, 24)
        self.assertEqual(result["forced_lower_tier_count"], 3)
        self.assertEqual(result["forced_tier_transitions"]["tier2_to_tier3"], 2)
        self.assertEqual(result["forced_tier_transitions"]["tier1_to_tier2"], 1)

    def test_transition_skipped_when_from_or_to_tier_missing(self):
        entries = [
            entry(
                routed_tier="",  # missing from tier
                shadow_policy_decision=sp(mode="forced_lower_tier", candidate_tier="tier3"),
            ),
            entry(
                routed_tier="tier2",
                shadow_policy_decision=sp(mode="forced_lower_tier", candidate_tier=""),  # missing to tier
            ),
        ]
        result = aggregate_shadow_policy_stats(entries, True, 24)
        self.assertEqual(result["forced_lower_tier_count"], 2)
        self.assertEqual(result["forced_tier_transitions"], {})

    def test_latency_percentiles_single_value(self):
        entries = [
            entry(
                latency_ms=100.0,
                shadow_policy_decision=sp(mode="forced_lower_tier"),
            ),
        ]
        result = aggregate_shadow_policy_stats(entries, True, 24)
        self.assertEqual(result["avg_latency_shadow_ms"], 100.0)
        self.assertEqual(result["p50_shadow_ms"], 100.0)
        self.assertEqual(result["p95_shadow_ms"], 100.0)

    def test_latency_percentiles_multiple_values(self):
        entries = [
            entry(latency_ms=100.0, shadow_policy_decision=sp(mode="forced_lower_tier")),
            entry(latency_ms=200.0, shadow_policy_decision=sp(mode="forced_lower_tier")),
            entry(latency_ms=300.0, shadow_policy_decision=sp(mode="forced_lower_tier")),
        ]
        result = aggregate_shadow_policy_stats(entries, True, 24)
        self.assertEqual(result["avg_latency_shadow_ms"], 200.0)
        self.assertEqual(result["p50_shadow_ms"], 200.0)
        self.assertEqual(result["p95_shadow_ms"], 300.0)

    def test_primary_latency_for_observe_only(self):
        entries = [
            entry(
                latency_ms=150.0,
                shadow_policy_decision=sp(mode="observe_only"),
            ),
        ]
        result = aggregate_shadow_policy_stats(entries, True, 24)
        self.assertEqual(result["avg_latency_primary_ms"], 150.0)
        self.assertEqual(result["p50_primary_ms"], 150.0)
        self.assertIsNone(result["avg_latency_shadow_ms"])

    def test_mixed_shadow_and_primary_latencies(self):
        entries = [
            entry(latency_ms=100.0, shadow_policy_decision=sp(mode="forced_lower_tier")),
            entry(latency_ms=200.0, shadow_policy_decision=sp(mode="forced_lower_tier")),
            entry(latency_ms=400.0, shadow_policy_decision=sp(mode="observe_only")),
        ]
        result = aggregate_shadow_policy_stats(entries, True, 24)
        # Shadow: 100, 200 — nearest-rank: p50 idx=int(2*0.5)=1 → 200.0
        self.assertEqual(result["avg_latency_shadow_ms"], 150.0)
        self.assertEqual(result["p50_shadow_ms"], 200.0)
        self.assertEqual(result["p95_shadow_ms"], 200.0)
        # Primary: 400
        self.assertEqual(result["avg_latency_primary_ms"], 400.0)
        self.assertEqual(result["p50_primary_ms"], 400.0)
        self.assertEqual(result["p95_primary_ms"], 400.0)

    def test_null_latency_skipped(self):
        entries = [
            entry(latency_ms=None, shadow_policy_decision=sp(mode="forced_lower_tier")),
            entry(latency_ms=200.0, shadow_policy_decision=sp(mode="forced_lower_tier")),
        ]
        result = aggregate_shadow_policy_stats(entries, True, 24)
        self.assertEqual(result["avg_latency_shadow_ms"], 200.0)
        self.assertEqual(result["p50_shadow_ms"], 200.0)

    def test_window_hours_passed_through(self):
        result = aggregate_shadow_policy_stats([], True, 72)
        self.assertEqual(result["window_hours"], 72)

    def test_total_requests_equals_all_entries(self):
        entries = [
            entry(),
            entry(),
            entry(shadow_policy_decision=sp(mode="observe_only")),
        ]
        result = aggregate_shadow_policy_stats(entries, True, 24)
        self.assertEqual(result["total_requests"], 3)

    def test_unknown_mode(self):
        entries = [
            entry(shadow_policy_decision=sp(mode="unknown_mode")),
        ]
        result = aggregate_shadow_policy_stats(entries, True, 24)
        self.assertEqual(result["mode_counts"]["unknown_mode"], 1)

    def test_observe_only_entries_have_no_shadow_latency(self):
        entries = [
            entry(latency_ms=100.0, shadow_policy_decision=sp(mode="observe_only")),
            entry(latency_ms=200.0, shadow_policy_decision=sp(mode="observe_only")),
        ]
        result = aggregate_shadow_policy_stats(entries, True, 24)
        self.assertIsNone(result["avg_latency_shadow_ms"])
        self.assertIsNone(result["p50_shadow_ms"])
        self.assertIsNone(result["p95_shadow_ms"])
        # Primary latency should be set
        self.assertEqual(result["avg_latency_primary_ms"], 150.0)

    def test_forced_lower_tier_only_has_no_primary_latency(self):
        entries = [
            entry(latency_ms=100.0, shadow_policy_decision=sp(mode="forced_lower_tier")),
            entry(latency_ms=200.0, shadow_policy_decision=sp(mode="forced_lower_tier")),
        ]
        result = aggregate_shadow_policy_stats(entries, True, 24)
        self.assertIsNone(result["avg_latency_primary_ms"])
        self.assertIsNone(result["p50_primary_ms"])
        self.assertIsNone(result["p95_primary_ms"])
        # Shadow latency should be set
        self.assertEqual(result["avg_latency_shadow_ms"], 150.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
