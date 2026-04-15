"""Request scoring and feature extraction for tier selection."""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any


_CJK_RANGE = re.compile(r"[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]")
_CODE_BLOCK_PATTERN = re.compile(r"```")
_FILE_PATH_PATTERN = re.compile(
    r"(?:^|[\s(])(?:/?[\w.\-]+/)+[\w.\-]+\.\w+|[A-Za-z]:\\(?:[\w.\-]+\\)+[\w.\-]+\.\w+"
)
_STACKTRACE_PATTERN = re.compile(
    r"(traceback|exception|stack trace|stacktrace|error:|warning:|\bat\s+[\w.$]+|\bline\s+\d+\b)",
    re.IGNORECASE,
)


DEFAULT_SCORING_CONFIG: dict[str, Any] = {
    "enabled": True,
    "legacy_rule_bonus": 0.5,
    "tiers": {
        "tier1": {"threshold": 5.5},
        "tier2": {"threshold": 2.5},
    },
    "features": {
        "large_context": {
            "enabled": True,
            "thresholds": {"estimated_tokens": 4000, "message_count": 20},
            "weights": {"tier1": 4.0, "tier2": 1.5},
        },
        "medium_context": {
            "enabled": True,
            "thresholds": {"estimated_tokens": 2000, "message_count": 10},
            "weights": {"tier2": 3.0, "tier1": 1.0},
        },
        "multi_turn_context": {
            "enabled": True,
            "thresholds": {"message_count": 8},
            "weights": {"tier2": 2.0, "tier1": 1.0},
        },
        "code_context": {
            "enabled": True,
            "thresholds": {"code_block_count": 1, "file_path_count": 1},
            "weights": {"tier2": 2.0, "tier1": 1.0},
        },
        "error_investigation": {
            "enabled": True,
            "thresholds": {"stacktrace_count": 1, "error_signal_count": 2},
            "weights": {"tier1": 2.0, "tier2": 1.5},
        },
        "substantial_prompt": {
            "enabled": True,
            "thresholds": {"input_chars": 20},
            "weights": {"tier2": 2.0},
        },
        "exploratory_request": {
            "enabled": True,
            "thresholds": {"question_count": 2, "tool_count": 1},
            "weights": {"tier2": 1.5, "tier1": 0.5},
        },
        "deep_context": {
            "enabled": True,
            "thresholds": {"complexity_signal_count": 4},
            "weights": {"tier1": 2.5, "tier2": 1.5},
        },
        "large_output_budget": {
            "enabled": True,
            "thresholds": {"max_tokens_requested": 2048},
            "weights": {"tier2": 2.0, "tier1": 0.5},
        },
        "simple_prompt": {
            "enabled": True,
            "thresholds": {"estimated_tokens_max": 600, "message_count_max": 3, "input_chars_max": 18},
            "weights": {"tier3": 2.0},
        },
    },
}


def merge_scoring_config(override: dict[str, Any] | None) -> dict[str, Any]:
    """Return default scoring config merged with caller overrides."""
    return _deep_merge(DEFAULT_SCORING_CONFIG, override or {})


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def estimate_tokens(text: str) -> int:
    """Rough token estimation without a tokenizer."""
    if not text:
        return 0
    cjk_count = len(_CJK_RANGE.findall(text))
    ascii_count = len(text) - cjk_count
    return int(cjk_count / 1.5 + ascii_count / 4)


def extract_text_from_messages(messages: list[dict]) -> str:
    """Extract all textual content from messages."""
    parts: list[str] = []
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str):
            parts.append(content)
            continue
        if not isinstance(content, list):
            continue
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(item.get("text", ""))
    return " ".join(part for part in parts if part)


def extract_text_from_system(system: Any) -> str:
    """Extract textual content from Anthropic's system field."""
    if isinstance(system, str):
        return system
    if not isinstance(system, list):
        return ""

    parts: list[str] = []
    for item in system:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, dict) and item.get("type") == "text":
            parts.append(item.get("text", ""))
    return " ".join(part for part in parts if part)


class RequestScorer:
    """Extracts request features and maps them to tier scores."""

    def __init__(
        self,
        scoring_config: dict[str, Any],
        tier_order: list[str],
        ml_model=None,
        ml_weights: dict[str, float] | None = None,
    ):
        self.config = scoring_config
        self.tier_order = tier_order
        self.ml_model = ml_model
        # ML weights: probability multiplier for each tier (default 2.0)
        self.ml_weights = ml_weights or {"tier1": 2.0, "tier2": 2.0, "tier3": 2.0}

    def analyze_request(
        self,
        request_body: dict[str, Any],
        legacy_rule_matches: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        feature_values = self.extract_feature_snapshot(request_body)
        result = self.score_feature_snapshot(feature_values, legacy_rule_matches or [])
        result["feature_values"] = feature_values
        return result

    def extract_feature_snapshot(self, request_body: dict[str, Any]) -> dict[str, Any]:
        messages = request_body.get("messages", [])
        system_text = extract_text_from_system(request_body.get("system"))
        message_text = extract_text_from_messages(messages)
        combined_text = " ".join(part for part in [system_text, message_text] if part)
        code_marker_count = len(_CODE_BLOCK_PATTERN.findall(combined_text))
        code_block_count = code_marker_count // 2 or (1 if code_marker_count else 0)
        file_path_count = len(_FILE_PATH_PATTERN.findall(combined_text))
        stacktrace_count = len(_STACKTRACE_PATTERN.findall(combined_text))
        question_count = combined_text.count("?") + combined_text.count("？")
        max_tokens_requested = int(request_body.get("max_tokens") or 0)
        complexity_signal_count = sum(
            (
                1 if code_block_count > 0 else 0,
                1 if file_path_count > 0 else 0,
                1 if stacktrace_count > 0 else 0,
                1 if question_count >= 2 else 0,
                1 if len(messages) >= 4 else 0,
                1 if estimate_tokens(combined_text) >= 800 else 0,
                1 if max_tokens_requested >= 2048 else 0,
                1 if (request_body.get("tools") or []) else 0,
            )
        )
        error_signal_count = stacktrace_count + (1 if code_block_count and file_path_count else 0)

        feature_values = {
            "input_chars": len(combined_text),
            "estimated_tokens": estimate_tokens(combined_text),
            "message_count": len(messages),
            "user_message_count": sum(1 for msg in messages if msg.get("role") == "user"),
            "assistant_message_count": sum(1 for msg in messages if msg.get("role") == "assistant"),
            "tool_count": len(request_body.get("tools") or []),
            "question_count": question_count,
            "code_block_count": code_block_count,
            "file_path_count": file_path_count,
            "stacktrace_count": stacktrace_count,
            "max_tokens_requested": max_tokens_requested,
            "complexity_signal_count": complexity_signal_count,
        }
        feature_values["error_signal_count"] = error_signal_count
        feature_values["request_shape"] = {
            "input_chars": feature_values["input_chars"],
            "estimated_tokens": feature_values["estimated_tokens"],
            "message_count": feature_values["message_count"],
            "question_count": question_count,
            "tool_count": feature_values["tool_count"],
            "code_block_count": code_block_count,
            "file_path_count": file_path_count,
            "stacktrace_count": stacktrace_count,
            "max_tokens_requested": max_tokens_requested,
        }
        feature_values["task_type"] = self._classify_task_type(feature_values)
        feature_values["request_text"] = combined_text  # Add for ML model
        return feature_values

    def score_feature_snapshot(
        self,
        feature_values: dict[str, Any],
        legacy_rule_matches: list[dict[str, Any]] | None = None,
        ml_prediction: dict[str, float] | None = None,
    ) -> dict[str, Any]:
        tier_scores = {tier: 0.0 for tier in self.tier_order}
        score_breakdown = {tier: [] for tier in self.tier_order}
        detected_features: list[str] = []
        decision_path = ["request-scoring"]

        for feature_name, feature_cfg in self.config.get("features", {}).items():
            if not feature_cfg.get("enabled", True):
                continue
            active, reason = self._evaluate_feature(feature_name, feature_values, feature_cfg)
            if not active:
                continue
            detected_features.append(feature_name)
            for tier, weight in feature_cfg.get("weights", {}).items():
                if tier not in tier_scores or not weight:
                    continue
                tier_scores[tier] += float(weight)
                score_breakdown[tier].append({
                    "feature": feature_name,
                    "weight": float(weight),
                    "reason": reason,
                })

        if legacy_rule_matches:
            decision_path.append("legacy-rule-bonus")
            bonus = float(self.config.get("legacy_rule_bonus", 2.0))
            for match in legacy_rule_matches:
                target = match.get("target")
                if target not in tier_scores:
                    continue
                detected_features.append(f"legacy_rule:{match.get('name', 'unknown')}")
                tier_scores[target] += bonus
                score_breakdown[target].append({
                    "feature": f"legacy_rule:{match.get('name', 'unknown')}",
                    "weight": bonus,
                    "reason": match.get("reason") or f"legacy rule matched target={target}",
                })

        # Apply ML prediction if available
        if ml_prediction:
            decision_path.append("ml-prediction")
            detected_features.append("ml_prediction")
            for tier, prob in ml_prediction.items():
                if tier in tier_scores and tier in self.ml_weights:
                    weight = self.ml_weights[tier]
                    tier_scores[tier] += prob * weight
                    score_breakdown[tier].append({
                        "feature": "ml_prediction",
                        "weight": prob * weight,
                        "reason": f"ML model predicts {tier} with probability {prob:.3f}",
                    })

        selected_tier = self._select_tier(tier_scores)
        decision_path.append(f"tier:{selected_tier}")

        return {
            "selected_tier": selected_tier,
            "tier_scores": {tier: round(score, 2) for tier, score in tier_scores.items()},
            "score_breakdown": score_breakdown,
            "detected_features": detected_features,
            "request_shape": feature_values.get("request_shape", {}),
            "task_type": feature_values.get("task_type", "general"),
            "decision_path": decision_path,
        }

    def _evaluate_feature(
        self,
        feature_name: str,
        feature_values: dict[str, Any],
        feature_cfg: dict[str, Any],
    ) -> tuple[bool, str]:
        thresholds = feature_cfg.get("thresholds", {})

        if feature_name == "simple_prompt":
            return self._is_simple_prompt(feature_values, thresholds)

        reasons = []
        for key, threshold in thresholds.items():
            value = feature_values.get(key, 0)
            if value >= threshold:
                reasons.append(f"{key}>={threshold} (actual={value})")
        return (bool(reasons), ", ".join(reasons))

    def _is_simple_prompt(
        self,
        feature_values: dict[str, Any],
        thresholds: dict[str, Any],
    ) -> tuple[bool, str]:
        token_limit = thresholds.get("estimated_tokens_max", 600)
        message_limit = thresholds.get("message_count_max", 3)
        char_limit = thresholds.get("input_chars_max", 18)
        is_short = (
            feature_values.get("estimated_tokens", 0) <= token_limit
            and feature_values.get("message_count", 0) <= message_limit
            and feature_values.get("input_chars", 0) <= char_limit
        )
        complex_signal_count = sum(
            feature_values.get(name, 0)
            for name in (
                "complexity_signal_count",
                "stacktrace_count",
                "code_block_count",
                "file_path_count",
                "tool_count",
            )
        )
        active = is_short and complex_signal_count == 0
        reason = (
            f"estimated_tokens<={token_limit}, message_count<={message_limit}, "
            f"input_chars<={char_limit}, "
            f"complex_signal_count={complex_signal_count}"
        )
        return active, reason

    def _select_tier(self, tier_scores: dict[str, float]) -> str:
        lowest_tier = self.tier_order[-1]
        thresholds = self.config.get("tiers", {})

        for tier in self.tier_order[:-1]:
            threshold = thresholds.get(tier, {}).get("threshold")
            if threshold is None:
                continue
            if tier_scores.get(tier, 0.0) >= float(threshold):
                return tier

        # When nothing crosses a hard threshold, prefer the non-lowest tier
        # whose score is closest to its threshold. This avoids routing
        # "medium-hard" requests straight down to tier3.
        ratio_candidates: list[tuple[float, float, str]] = []
        for tier in self.tier_order[:-1]:
            threshold = thresholds.get(tier, {}).get("threshold")
            score = tier_scores.get(tier, 0.0)
            if threshold is None or score <= 0:
                continue
            ratio_candidates.append((score / float(threshold), score, tier))

        if ratio_candidates:
            best_ratio, _best_score, best_tier = max(ratio_candidates)
            if best_ratio >= 0.75:
                return best_tier

        positive_candidates = [tier for tier, score in tier_scores.items() if score > 0]
        if not positive_candidates:
            return lowest_tier

        ranked = sorted(
            positive_candidates,
            key=lambda tier: (tier_scores[tier], -self.tier_order.index(tier)),
            reverse=True,
        )
        best_tier = ranked[0]
        if best_tier == lowest_tier:
            return lowest_tier

        if thresholds.get(best_tier, {}).get("threshold") is None:
            return best_tier
        return lowest_tier

    def _classify_task_type(self, feature_values: dict[str, Any]) -> str:
        if feature_values.get("stacktrace_count", 0) > 0:
            return "debug"
        if feature_values.get("code_block_count", 0) > 0 or feature_values.get("file_path_count", 0) > 0:
            return "implementation"
        if feature_values.get("message_count", 0) >= 8 or feature_values.get("complexity_signal_count", 0) >= 4:
            return "architecture"
        if feature_values.get("input_chars", 0) >= 40 or feature_values.get("tool_count", 0) > 0:
            return "analysis"
        if feature_values.get("estimated_tokens", 0) <= 600 and feature_values.get("message_count", 0) <= 3:
            return "simple"
        return "general"

    async def get_ml_prediction(self, text: str, timeout_ms: int = 50) -> dict[str, float] | None:
        """Get ML model prediction for request complexity.

        Args:
            text: Request text to classify
            timeout_ms: Maximum time to wait for prediction

        Returns:
            Dictionary with tier probabilities, or None if ML model unavailable
        """
        if not self.ml_model:
            return None

        try:
            return await self.ml_model.predict_complexity(text, timeout_ms=timeout_ms)
        except Exception as e:
            # Log but don't fail - will fall back to rule-based scoring
            import logging
            logger = logging.getLogger("llm_router")
            logger.warning(f"ML prediction failed: {e}, using rule-based scoring")
            return None
