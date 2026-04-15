import tempfile
import textwrap
import unittest
from pathlib import Path

from llm_router.config import RouterConfig
from llm_router.latency import LatencyTracker
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
          - name: "explicit-model"
            match: "model_is_known"
            action: "passthrough"
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
    def test_simple_prompt_stays_on_tier3(self):
        router, _tracker = make_router()
        model_id, _provider, route_info = router.route({
            "model": "auto",
            "messages": [{"role": "user", "content": "Explain HTTP 200 in one sentence."}],
        })

        self.assertEqual(model_id, "tier3-model")
        self.assertEqual(route_info["selected_tier"], "tier3")
        self.assertEqual(route_info["task_type"], "simple")

    def test_readme_request_moves_to_tier2(self):
        router, _tracker = make_router()
        model_id, _provider, route_info = router.route({
            "model": "auto",
            "messages": [{
                "role": "user",
                "content": "Write a README for this FastAPI project with install, usage, and API reference sections.",
            }],
        })

        self.assertIn(model_id, {"tier2-slow", "tier2-fast"})
        self.assertEqual(route_info["selected_tier"], "tier2")
        self.assertIn("generation_heavy", route_info["detected_features"])

    def test_debugging_request_moves_to_tier1(self):
        router, _tracker = make_router()
        model_id, _provider, route_info = router.route({
            "model": "auto",
            "messages": [{
                "role": "user",
                "content": (
                    "Investigate the root cause of this race condition, review the architecture, "
                    "and propose a safe fix."
                ),
            }],
        })

        self.assertEqual(model_id, "tier1-model")
        self.assertEqual(route_info["selected_tier"], "tier1")
        self.assertGreaterEqual(route_info["tier_scores"]["tier1"], 6.0)

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


if __name__ == "__main__":
    unittest.main()
