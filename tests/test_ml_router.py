"""Tests for ML-based routing model."""

import unittest
from unittest.mock import MagicMock, patch

from llm_router.model_loader import BertTinyRouterModel


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

        with patch("transformers.AutoTokenizer") as mock_tokenizer_class, \
             patch("transformers.AutoModelForSequenceClassification") as mock_model_class:
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

        with patch("transformers.AutoTokenizer") as mock_tokenizer_class, \
             patch("transformers.AutoModelForSequenceClassification") as mock_model_class:
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
