"""Tests for ML-based routing model."""

import textwrap
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from llm_router.config import RouterConfig
from llm_router.latency import LatencyTracker
from llm_router.router import Router


class TestMLRouter(unittest.TestCase):
    """Test ML routing integration."""

    def make_router(self, ml_model=None) -> tuple[Router, LatencyTracker, RouterConfig]:
        """Create a test router with optional ML model."""
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
                - id: "tier2-model"
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

            ml_routing:
              enabled: true
              model_name: "test-model"
              inference:
                timeout_ms: 50
                fallback_on_error: true
              weights:
                tier1: 2.0
                tier2: 2.0
                tier3: 2.0
            """
        )

        import tempfile
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write(config_text)
            config_path = f.name

        try:
            config = RouterConfig(config_path)
            tracker = LatencyTracker(config.fallback)
            router = Router(config, tracker, ml_model=ml_model)
            return router, tracker, config
        finally:
            import os
            os.unlink(config_path)

    def test_router_without_ml_model(self):
        """Test router works without ML model (backward compatibility)."""
        router, tracker, config = self.make_router(ml_model=None)

        request = {
            "model": "auto",
            "messages": [{"role": "user", "content": "simple question"}],
        }

        model_id, provider_cfg, route_info = router.route(request)

        # Should still route using rule-based scoring
        self.assertIsNotNone(model_id)
        self.assertIn("selected_tier", route_info)
        self.assertEqual(route_info.get("matched_by"), "scoring")

    def test_router_with_ml_model_success(self):
        """Test router successfully integrates ML prediction."""
        # Mock ML model
        ml_model = MagicMock()
        ml_model.predict_complexity = AsyncMock(return_value={
            "tier1": 0.7,
            "tier2": 0.2,
            "tier3": 0.1,
        })

        router, tracker, config = self.make_router(ml_model=ml_model)

        request = {
            "model": "auto",
            "messages": [{"role": "user", "content": "complex architecture question"}],
        }

        model_id, provider_cfg, route_info = router.route(request)

        # Should have ML prediction in route info
        self.assertIsNotNone(model_id)
        self.assertIn("selected_tier", route_info)

        # ML prediction should have been called
        ml_model.predict_complexity.assert_called_once()

    def test_ml_model_fallback_on_error(self):
        """Test router falls back to rules when ML model fails."""
        # Mock ML model that raises exception
        ml_model = MagicMock()
        ml_model.predict_complexity = AsyncMock(side_effect=Exception("ML failed"))

        router, tracker, config = self.make_router(ml_model=ml_model)

        request = {
            "model": "auto",
            "messages": [{"role": "user", "content": "test question"}],
        }

        # Should not raise exception, should fall back to rules
        model_id, provider_cfg, route_info = router.route(request)

        self.assertIsNotNone(model_id)
        self.assertIn("selected_tier", route_info)

    def test_ml_model_disabled_in_config(self):
        """Test ML model is not used when disabled in config."""
        # Mock ML model
        ml_model = MagicMock()
        ml_model.predict_complexity = AsyncMock(return_value={
            "tier1": 0.5,
            "tier2": 0.3,
            "tier3": 0.2,
        })

        # Disable ML routing in config
        config_text = textwrap.dedent(
            """
            providers:
              primary:
                base_url: "https://example.com"
                api_key: "test-key"
                api_format: "anthropic"

            models:
              tier1:
                - id: "tier1-model"
                  provider: primary

            ml_routing:
              enabled: false
            """
        )

        import tempfile
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write(config_text)
            config_path = f.name

        try:
            config = RouterConfig(config_path)
            tracker = LatencyTracker(config.fallback)
            router = Router(config, tracker, ml_model=ml_model)

            request = {
                "model": "auto",
                "messages": [{"role": "user", "content": "test"}],
            }

            router.route(request)

            # ML model should NOT have been called
            ml_model.predict_complexity.assert_not_called()
        finally:
            import os
            os.unlink(config_path)


class TestBertTinyRouterModel(unittest.TestCase):
    """Test BertTinyRouterModel class."""

    def test_model_initialization(self):
        """Test model initialization with mocked transformers."""
        # Skip if transformers is not installed
        try:
            import transformers
        except ImportError:
            self.skipTest("transformers not installed")

        from unittest.mock import patch
        from llm_router.model_loader import BertTinyRouterModel

        # Setup mocks
        mock_tokenizer = MagicMock()
        mock_model = MagicMock()

        with patch("llm_router.model_loader.AutoTokenizer") as mock_tokenizer_class, \
             patch("llm_router.model_loader.AutoModelForSequenceClassification") as mock_model_class:
            mock_tokenizer_class.from_pretrained.return_value = mock_tokenizer
            mock_model_class.from_pretrained.return_value = mock_model

            model = BertTinyRouterModel("test-model")

            # Verify model and tokenizer were loaded
            mock_tokenizer_class.from_pretrained.assert_called_once_with("test-model")
            mock_model_class.from_pretrained.assert_called_once_with("test-model")
            mock_model.eval.assert_called_once()

    def test_predict_complexity(self):
        """Test prediction method with mocked transformers."""
        # Skip if transformers or torch is not installed
        try:
            import transformers
            import torch
        except ImportError:
            self.skipTest("transformers or torch not installed")

        from unittest.mock import patch
        from llm_router.model_loader import BertTinyRouterModel
        import asyncio

        # Setup mocks
        mock_tokenizer = MagicMock()
        mock_model = MagicMock()

        with patch("llm_router.model_loader.AutoTokenizer") as mock_tokenizer_class, \
             patch("llm_router.model_loader.AutoModelForSequenceClassification") as mock_model_class:
            mock_tokenizer_class.from_pretrained.return_value = mock_tokenizer
            mock_model_class.from_pretrained.return_value = mock_model

            # Mock tokenization and model output
            mock_tokenizer.return_value = {"input_ids": [[1, 2, 3]]}

            # Mock model output
            mock_output = MagicMock()
            mock_output.logits = torch.tensor([[1.0, 2.0, 3.0]])
            mock_model.return_value = mock_output

            model = BertTinyRouterModel("test-model")

            # Test prediction
            result = asyncio.run(model.predict_complexity("test text"))

            # Should return probabilities
            self.assertIn("tier1", result)
            self.assertIn("tier2", result)
            self.assertIn("tier3", result)

            # Verify probabilities sum to approximately 1.0
            self.assertAlmostEqual(sum(result.values()), 1.0, places=5)


if __name__ == "__main__":
    unittest.main()
