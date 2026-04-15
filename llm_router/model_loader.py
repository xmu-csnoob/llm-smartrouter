"""ML model loader for intelligent request routing."""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger("llm_router")


class BertTinyRouterModel:
    """Bert-tiny-llm-router model wrapper for complexity prediction.

    This model predicts request complexity and returns probability distribution
    across tiers (tier1=complex, tier2=medium, tier3=simple).

    Model: leftfield7/bert-tiny-llm-router (4.4MB, <10ms inference on CPU)
    """

    def __init__(
        self,
        model_name: str = "leftfield7/bert-tiny-llm-router",
        cache_dir: str | None = None,
    ):
        """Initialize the model loader.

        Args:
            model_name: HuggingFace model identifier
            cache_dir: Optional cache directory for downloaded models
        """
        self.model_name = model_name
        self.cache_dir = cache_dir
        self.model = None
        self.tokenizer = None
        self._lock = asyncio.Lock()
        self._load_model()

    def _load_model(self):
        """Load model and tokenizer from HuggingFace."""
        try:
            from transformers import AutoModelForSequenceClassification, AutoTokenizer

            logger.info(f"Loading ML routing model: {self.model_name}")

            # Prepare cache directory if specified
            cache_kwargs = {}
            if self.cache_dir:
                cache_path = Path(self.cache_dir)
                cache_path.mkdir(parents=True, exist_ok=True)
                os.environ["TRANSFORMERS_CACHE"] = str(cache_path)
                cache_kwargs["cache_dir"] = str(cache_path)

            # Load tokenizer and model
            self.tokenizer = AutoTokenizer.from_pretrained(
                self.model_name,
                **cache_kwargs
            )
            self.model = AutoModelForSequenceClassification.from_pretrained(
                self.model_name,
                **cache_kwargs
            )
            self.model.eval()  # Set to inference mode

            logger.info("ML routing model loaded successfully")

        except ImportError as e:
            logger.error(f"Failed to import transformers: {e}")
            raise RuntimeError(
                "transformers package is required for ML routing. "
                "Install it with: pip install transformers torch"
            ) from e
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            raise

    async def predict_complexity(self, text: str, timeout_ms: int = 50) -> dict[str, float]:
        """Predict request complexity probability distribution.

        Args:
            text: Request text to classify
            timeout_ms: Maximum time to wait for prediction (default 50ms)

        Returns:
            Dictionary with tier probabilities:
            {
                "tier1": float,  # Complex requests
                "tier2": float,  # Medium requests
                "tier3": float,  # Simple requests
            }

        Raises:
            TimeoutError: If prediction takes longer than timeout_ms
        """
        if not self.model or not self.tokenizer:
            logger.warning("Model not loaded, returning uniform distribution")
            return {"tier1": 0.33, "tier2": 0.34, "tier3": 0.33}

        # Run inference in thread pool to avoid blocking event loop
        loop = asyncio.get_event_loop()
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(None, self._predict_sync, text),
                timeout=timeout_ms / 1000.0,
            )
            return result
        except asyncio.TimeoutError:
            logger.warning(f"ML prediction timeout after {timeout_ms}ms")
            raise TimeoutError(f"ML prediction exceeded {timeout_ms}ms") from None
        except Exception as e:
            logger.error(f"ML prediction failed: {e}")
            raise

    def _predict_sync(self, text: str) -> dict[str, float]:
        """Synchronous prediction method (runs in thread pool)."""
        import torch

        # Tokenize input
        inputs = self.tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=512,
            padding=False,
        )

        # Run inference
        with torch.no_grad():
            outputs = self.model(**inputs)

        # Convert logits to probabilities
        probs = torch.nn.functional.softmax(outputs.logits, dim=-1)

        # Handle 2-class model (small_llm vs large_llm) or 3-class model
        if probs.shape[1] == 2:
            # Map 2-class to 3-tier system
            # small_llm (label 0) → tier3 (simple/routine)
            # large_llm (label 1) → tier1 (complex/important)
            # For large_llm, also add some probability to tier2 as intermediate
            small_llm_prob = float(probs[0, 0])
            large_llm_prob = float(probs[0, 1])

            # Distribute large_llm probability between tier1 and tier2
            # Give more weight to tier1 for truly complex tasks
            tier1_prob = large_llm_prob * 0.7
            tier2_prob = large_llm_prob * 0.3
            tier3_prob = small_llm_prob

            return {
                "tier1": tier1_prob,
                "tier2": tier2_prob,
                "tier3": tier3_prob,
            }
        else:
            # Assume 3 classes: complex, medium, simple
            return {
                "tier1": float(probs[0, 0]),  # Complex
                "tier2": float(probs[0, 1]),  # Medium
                "tier3": float(probs[0, 2]),  # Simple
            }

    def get_model_info(self) -> dict[str, Any]:
        """Get model information for monitoring/debugging."""
        return {
            "model_name": self.model_name,
            "cache_dir": self.cache_dir,
            "loaded": self.model is not None,
            "tokenizer_loaded": self.tokenizer is not None,
        }

    async def health_check(self) -> bool:
        """Check if model is loaded and responsive."""
        try:
            # Quick test prediction
            result = await self.predict_complexity("test", timeout_ms=100)
            return isinstance(result, dict) and "tier1" in result
        except Exception:
            return False
