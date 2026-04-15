"""Rule-based router — selects model based on request content and latency tracking."""

import logging
import re

from .config import RouterConfig
from .latency import LatencyTracker

logger = logging.getLogger("llm_router")

# Tier 1 keywords — high-complexity tasks
_TIER1_KEYWORDS = {
    "refactor", "design", "architect", "debug", "fix bug", "root cause",
    "redesign", "rewrite", "migrate", "investigate", "analyze", "troubleshoot",
    "performance issue", "memory leak", "race condition", "deadlock",
}

# Approximate token estimation
_CJK_RANGE = re.compile(r'[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]')


def _estimate_tokens(text: str) -> int:
    """Rough token estimation without tokenizer."""
    if not text:
        return 0
    cjk_count = len(_CJK_RANGE.findall(text))
    ascii_count = len(text) - cjk_count
    # CJK: ~1.5 chars/token, ASCII: ~4 chars/token
    return int(cjk_count / 1.5 + ascii_count / 4)


def _extract_text_from_messages(messages: list[dict]) -> str:
    """Extract all text content from messages."""
    parts = []
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            # Multimodal content
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    parts.append(item.get("text", ""))
    return " ".join(parts)


class Router:
    """Routes requests to models based on rules + availability."""

    def __init__(self, config: RouterConfig, tracker: LatencyTracker):
        self.config = config
        self.tracker = tracker

    def route(self, request_body: dict) -> tuple[str, dict, dict]:
        """
        Select the best model for a request.

        Returns (model_id, provider_config, route_info).
        """
        requested_model = request_body.get("model", "auto")
        messages = request_body.get("messages", [])

        # Rule 1: Explicit model passthrough
        if requested_model != "auto" and requested_model in self.config.model_registry:
            provider_cfg = self.config.get_provider_for_model(requested_model)
            logger.info(f"Passthrough: model={requested_model}")
            return requested_model, provider_cfg, {
                "matched_rule": "explicit-model",
                "matched_by": "passthrough",
                "estimated_tokens": 0,
                "message_count": len(messages),
            }

        # Analyze request
        text = _extract_text_from_messages(messages)
        estimated_tokens = _estimate_tokens(text)
        message_count = len(messages)
        text_lower = text.lower()

        # Evaluate rules in order
        target_tier = None
        matched_rule = "default"
        matched_by = "default"

        for rule in self.config.rules:
            action = rule.get("action")

            # Passthrough for known models
            if action == "passthrough":
                continue  # already handled above

            keywords = rule.get("keywords")

            if keywords:
                # Keyword matching
                if any(kw in text_lower for kw in keywords):
                    target_tier = rule.get("target")
                    matched_rule = rule.get("name", "unknown")
                    matched_by = "keyword"
                    logger.info(f"Rule '{matched_rule}' matched (keywords), target={target_tier}")
                    break

            match_expr = rule.get("match")
            if match_expr:
                # Simple expression evaluation
                if self._eval_match(match_expr, estimated_tokens, message_count):
                    target_tier = rule.get("target")
                    matched_rule = rule.get("name", "unknown")
                    matched_by = "expr"
                    logger.info(f"Rule '{matched_rule}' matched (expr), target={target_tier}")
                    break

            # Default rule
            if not match_expr and not keywords:
                target_tier = rule.get("target")
                matched_rule = rule.get("name", "default")
                matched_by = "default"
                logger.info(f"Default rule matched, target={target_tier}")
                break

        if not target_tier:
            # Ultimate fallback: lowest tier
            tiers = list(self.config.models.keys())
            target_tier = tiers[-1] if tiers else "tier3"

        route_info = {
            "matched_rule": matched_rule,
            "matched_by": matched_by,
            "estimated_tokens": estimated_tokens,
            "message_count": message_count,
        }
        return self._select_model(target_tier, route_info)

    def _eval_match(self, expr: str, tokens: int, msg_count: int) -> bool:
        """Evaluate a simple match expression."""
        # Support: estimated_tokens > N, message_count > N, with 'or'
        conditions = [c.strip() for c in expr.split(" or ")]

        for cond in conditions:
            if "estimated_tokens" in cond:
                threshold = self._extract_number(cond)
                if threshold is not None and tokens > threshold:
                    return True
            elif "message_count" in cond:
                threshold = self._extract_number(cond)
                if threshold is not None and msg_count > threshold:
                    return True
        return False

    @staticmethod
    def _extract_number(s: str) -> int | None:
        """Extract the number from a comparison expression."""
        import re as _re
        match = _re.search(r'(\d+)', s)
        return int(match.group(1)) if match else None

    def _select_model(self, tier: str, route_info: dict) -> tuple[str, dict, dict]:
        """Select the best available model in a tier, with cross-tier fallback."""
        degr_order = self.config.fallback.get("degradation_order", [])
        if not degr_order:
            degr_order = list(self.config.models.keys())

        # Determine which tiers to try
        if self.config.fallback.get("cross_tier", True):
            tier_idx = next((i for i, t in enumerate(degr_order) if t == tier), 0)
            tiers_to_try = degr_order[tier_idx:]
        else:
            tiers_to_try = [tier]

        for t in tiers_to_try:
            models = self.config.models.get(t, [])
            # Sort by availability and latency
            available = []
            for m in models:
                if self.tracker.is_available(m["id"]):
                    avg_lat = self.tracker.get_avg_latency(m["id"]) or float('inf')
                    available.append((m, avg_lat))

            if available:
                # Pick lowest latency
                available.sort(key=lambda x: x[1])
                best = available[0][0]
                provider_cfg = self.config.get_provider(best["provider"])
                if t != tier:
                    logger.info(f"Cross-tier: downgraded from {tier} to {t}, using {best['id']}")
                    route_info = {**route_info, "matched_by": "cross-tier", "matched_rule": "fallback"}
                return best["id"], provider_cfg, route_info

            if not self.config.fallback.get("cross_tier", True):
                break

        # All tiers exhausted — return first model from target tier anyway
        models = self.config.models.get(tier, [])
        if models:
            m = models[0]
            return m["id"], self.config.get_provider(m["provider"]), route_info

        raise RuntimeError(f"No models configured for tier {tier}")
