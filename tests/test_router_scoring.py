import tempfile
import textwrap
import unittest
from pathlib import Path

from llm_router.config import RouterConfig
from llm_router.latency import LatencyTracker
from llm_router.main import _build_analysis_snapshot
from llm_router.router import Router


def make_router() -> tuple[Router, LatencyTracker]:
    config_text = textwrap.dedent(
        """
        providers:
          primary:
            base_url: "https://example.com"
            api_key: "test-key"
            api_format: "anthropic"
            timeout: 120

        models:
          tier1:
            - id: "tier1-model"
              provider: primary
          tier2:
            - id: "tier2-slow"
              provider: primary
            - id: "tier2-fast"
              provider: primary
          tier3:
            - id: "tier3-model"
              provider: primary

        rules:
          - name: "legacy-complex"
            keywords: ["troubleshoot", "root cause"]
            target: tier1
          - name: "default"
            target: tier3

        fallback:
          latency_threshold_ms: 30000
          error_threshold: 3
          cooldown_seconds: 120
          cross_provider: true
          cross_tier: true
          degradation_order: [tier1, tier2, tier3]
        """
    )

    with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as handle:
        handle.write(config_text)
        config_path = Path(handle.name)

    config = RouterConfig(config_path)
    config_path.unlink(missing_ok=True)
    tracker = LatencyTracker(config.fallback)
    return Router(config, tracker), tracker


class RouterScoringTests(unittest.TestCase):
    def test_health_score_prefers_faster_model_within_same_tier(self):
        router, tracker = make_router()
        tracker.record("tier2-slow", 12000, success=True)
        tracker.record("tier2-slow", 11000, success=True)
        tracker.record("tier2-slow", 10000, success=True)
        tracker.record_ttft("tier2-slow", 3000)

        tracker.record("tier2-fast", 800, success=True)
        tracker.record("tier2-fast", 900, success=True)
        tracker.record("tier2-fast", 700, success=True)
        tracker.record_ttft("tier2-fast", 250)

        model_id, _provider, route_info = router.route({
            "model": "auto",
            "messages": [{
                "role": "user",
                "content": "Implement offset pagination for the recent logs API and update the response shape.",
            }],
        })

        self.assertEqual(route_info["selected_tier"], "tier2")
        self.assertEqual(model_id, "tier2-fast")
        self.assertEqual(route_info["model_selection"]["selected_model"], "tier2-fast")

    def test_analysis_snapshot_treats_missing_fields_as_missing_not_unknown(self):
        snapshot = _build_analysis_snapshot([
            {
                "matched_by": "passthrough",
                "matched_rule": "explicit-model",
                "routed_model": "tier1-model",
                "routed_tier": "tier1",
                "latency_ms": 1200,
                "is_stream": False,
                "status": 200,
            },
            {
                "log_schema_version": 2,
                "matched_by": "scoring",
                "matched_rule": "scoring:generation",
                "selected_tier": "tier2",
                "routed_model": "tier2-model",
                "routed_tier": "tier2",
                "task_type": "generation",
                "detected_features": ["generation_heavy"],
                "feature_values": {"estimated_tokens": 1200},
                "latency_ms": 800,
                "is_stream": False,
                "status": 200,
            },
        ])

        self.assertEqual(snapshot["selected_tier_count"], 1)
        self.assertEqual(snapshot["missing_selected_tier_count"], 1)
        self.assertEqual(snapshot["feature_snapshot_count"], 1)
        self.assertEqual(snapshot["missing_feature_snapshot_count"], 1)
        self.assertEqual(snapshot["avg_ttft_display"], "N/A (no streaming samples)")
        self.assertNotIn("unknown", snapshot["selected_tier_summary"])

    def test_route_raises_when_all_models_in_selected_tier_are_unavailable(self):
        router, tracker = make_router()
        tracker.mark_unavailable("tier3-model", reason="quota_exhausted")

        with self.assertRaises(RuntimeError):
            router.route({
                "model": "auto",
                "messages": [{"role": "user", "content": "hello"}],
            })


if __name__ == "__main__":
    unittest.main()
