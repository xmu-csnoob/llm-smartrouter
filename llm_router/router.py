"""Routing logic for tier selection and model choice."""

from __future__ import annotations

import logging
import re
from typing import Any

from .config import RouterConfig
from .latency import LatencyTracker
from .scoring import RequestScorer, extract_text_from_messages, extract_text_from_system

logger = logging.getLogger("llm_router")


class Router:
    """Routes requests using request scoring plus runtime model health."""

    def __init__(self, config: RouterConfig, tracker: LatencyTracker):
        self.config = config
        self.tracker = tracker

    def route(self, request_body: dict[str, Any]) -> tuple[str, dict, dict]:
        """Select the best model for a request."""
        if self.config.scoring.get("enabled", True):
            return self._route_with_scoring(request_body)
        return self._route_by_legacy_rules(request_body)

    def replay_log_entry(self, entry: dict[str, Any]) -> dict[str, Any] | None:
        """Replay scoring on a logged feature snapshot using current weights."""
        feature_values = entry.get("feature_values")
        if not isinstance(feature_values, dict) or not feature_values:
            return None

        scorer = self._make_scorer()
        result = scorer.score_feature_snapshot(feature_values, entry.get("legacy_rule_matches") or [])
        previous_selected = entry.get("selected_tier") or entry.get("routed_tier")
        return {
            "request_id": entry.get("request_id"),
            "previous_selected_tier": previous_selected,
            "replayed_selected_tier": result["selected_tier"],
            "changed": previous_selected != result["selected_tier"],
            "tier_scores": result["tier_scores"],
            "detected_features": result["detected_features"],
            "task_type": result["task_type"],
        }

    def _route_with_scoring(self, request_body: dict[str, Any]) -> tuple[str, dict, dict]:
        requested_model = request_body.get("model", "auto")
        scorer = self._make_scorer()
        feature_values = scorer.extract_feature_snapshot(request_body)
        text_lower = self._request_text(request_body).lower()
        legacy_rule_matches = self._collect_matching_rules(text_lower, feature_values)
        scoring_result = scorer.score_feature_snapshot(feature_values, legacy_rule_matches)

        matched_rule = legacy_rule_matches[0]["name"] if legacy_rule_matches else f"scoring:{scoring_result['task_type']}"
        matched_by = "legacy-rule+scoring" if legacy_rule_matches else "scoring"

        route_info = {
            "matched_rule": matched_rule,
            "matched_by": matched_by,
            "estimated_tokens": feature_values.get("estimated_tokens", 0),
            "message_count": feature_values.get("message_count", 0),
            "selected_tier": scoring_result["selected_tier"],
            "requested_model": requested_model,
            "tier_scores": scoring_result["tier_scores"],
            "score_breakdown": scoring_result["score_breakdown"],
            "detected_features": scoring_result["detected_features"],
            "feature_values": feature_values,
            "request_shape": scoring_result["request_shape"],
            "task_type": scoring_result["task_type"],
            "decision_path": scoring_result["decision_path"],
            "legacy_rule_matches": legacy_rule_matches,
        }
        logger.info(
            "Scored request: requested=%s task=%s selected_tier=%s scores=%s",
            requested_model,
            scoring_result["task_type"],
            scoring_result["selected_tier"],
            scoring_result["tier_scores"],
        )
        return self._select_model(scoring_result["selected_tier"], route_info)

    def _route_by_legacy_rules(self, request_body: dict[str, Any]) -> tuple[str, dict, dict]:
        """Fallback mode for older configs that disable scoring."""
        scorer = self._make_scorer()
        feature_values = scorer.extract_feature_snapshot(request_body)
        text_lower = self._request_text(request_body).lower()

        target_tier = None
        matched_rule = "default"
        matched_by = "default"

        for rule in self.config.rules:
            action = rule.get("action")
            if action == "passthrough":
                continue

            keywords = rule.get("keywords")
            if keywords and any(keyword.lower() in text_lower for keyword in keywords):
                target_tier = rule.get("target")
                matched_rule = rule.get("name", "unknown")
                matched_by = "keyword"
                break

            match_expr = rule.get("match")
            if match_expr and self._eval_match(match_expr, feature_values):
                target_tier = rule.get("target")
                matched_rule = rule.get("name", "unknown")
                matched_by = "expr"
                break

            if not match_expr and not keywords:
                target_tier = rule.get("target")
                matched_rule = rule.get("name", "default")
                matched_by = "default"
                break

        if not target_tier:
            target_tier = self.config.tier_order[-1] if self.config.tier_order else "tier3"

        route_info = {
            "matched_rule": matched_rule,
            "matched_by": matched_by,
            "estimated_tokens": feature_values.get("estimated_tokens", 0),
            "message_count": feature_values.get("message_count", 0),
            "selected_tier": target_tier,
            "tier_scores": {},
            "score_breakdown": {},
            "detected_features": [],
            "feature_values": feature_values,
            "request_shape": feature_values.get("request_shape", {}),
            "task_type": feature_values.get("task_type", "general"),
            "decision_path": ["legacy-rules", f"tier:{target_tier}"],
            "legacy_rule_matches": [],
        }
        return self._select_model(target_tier, route_info)

    def _collect_matching_rules(
        self,
        text_lower: str,
        feature_values: dict[str, Any],
    ) -> list[dict[str, Any]]:
        matches: list[dict[str, Any]] = []
        for rule in self.config.rules:
            action = rule.get("action")
            if action == "passthrough":
                continue

            rule_name = rule.get("name", "unknown")
            if rule_name == "default":
                continue

            keywords = rule.get("keywords")
            if keywords:
                matched_keywords = [keyword for keyword in keywords if keyword.lower() in text_lower]
                if matched_keywords:
                    matches.append({
                        "name": rule_name,
                        "target": rule.get("target"),
                        "reason": f"keywords matched: {', '.join(matched_keywords[:3])}",
                    })
                    continue

            match_expr = rule.get("match")
            if match_expr and match_expr != "model_is_known" and self._eval_match(match_expr, feature_values):
                matches.append({
                    "name": rule_name,
                    "target": rule.get("target"),
                    "reason": f"expression matched: {match_expr}",
                })
        return matches

    def _eval_match(self, expr: str, feature_values: dict[str, Any]) -> bool:
        """Evaluate simple legacy match expressions."""
        conditions = [condition.strip() for condition in expr.split(" or ")]
        for condition in conditions:
            if "estimated_tokens" in condition:
                threshold = self._extract_number(condition)
                if threshold is not None and feature_values.get("estimated_tokens", 0) > threshold:
                    return True
            elif "message_count" in condition:
                threshold = self._extract_number(condition)
                if threshold is not None and feature_values.get("message_count", 0) > threshold:
                    return True
        return False

    @staticmethod
    def _extract_number(value: str) -> int | None:
        match = re.search(r"(\d+)", value)
        return int(match.group(1)) if match else None

    def _select_model(self, tier: str, route_info: dict[str, Any]) -> tuple[str, dict, dict]:
        """Pick the healthiest model in the target tier, with optional degradation."""
        degradation_order = self.config.tier_order
        if not degradation_order:
            degradation_order = list(self.config.models.keys())

        if self.config.fallback.get("cross_tier", True):
            tier_index = next((i for i, item in enumerate(degradation_order) if item == tier), 0)
            tiers_to_try = degradation_order[tier_index:]
        else:
            tiers_to_try = [tier]

        for candidate_tier in tiers_to_try:
            candidates = self._score_model_candidates(candidate_tier)
            if not candidates:
                continue

            best = candidates[0]
            provider_cfg = self.config.get_provider(best["provider"])
            route_info = {
                **route_info,
                "degraded_to_tier": candidate_tier if candidate_tier != tier else None,
                "model_selection": {
                    "strategy": "health-score",
                    "selected_model": best["id"],
                    "selected_model_score": best["selection_score"],
                    "candidate_tier": candidate_tier,
                    "candidates": candidates,
                },
            }
            if candidate_tier != tier:
                logger.info("Tier degradation: %s -> %s using %s", tier, candidate_tier, best["id"])
            return best["id"], provider_cfg, route_info

        models = self.config.models.get(tier, [])
        if models:
            fallback_model = models[0]
            route_info = {
                **route_info,
                "degraded_to_tier": None,
                "model_selection": {
                    "strategy": "forced-config-order",
                    "selected_model": fallback_model["id"],
                    "selected_model_score": None,
                    "candidate_tier": tier,
                    "candidates": [],
                },
            }
            return fallback_model["id"], self.config.get_provider(fallback_model["provider"]), route_info

        raise RuntimeError(f"No models configured for tier {tier}")

    def _score_model_candidates(self, tier: str) -> list[dict[str, Any]]:
        candidates: list[dict[str, Any]] = []
        for model_entry in self.config.models.get(tier, []):
            model_id = model_entry["id"]
            if not self.tracker.is_available(model_id):
                continue

            avg_latency = self.tracker.get_avg_latency(model_id)
            avg_ttft = self.tracker.get_avg_ttft(model_id)
            consecutive_errors = self.tracker.get_consecutive_errors(model_id)
            selection_score = self._compute_model_selection_score(avg_latency, avg_ttft, consecutive_errors)

            candidates.append({
                "id": model_id,
                "provider": model_entry["provider"],
                "selection_score": round(selection_score, 2),
                "avg_latency_ms": round(avg_latency, 1) if avg_latency is not None else None,
                "avg_ttft_ms": round(avg_ttft, 1) if avg_ttft is not None else None,
                "consecutive_errors": consecutive_errors,
            })

        candidates.sort(
            key=lambda item: (
                -item["selection_score"],
                item["avg_latency_ms"] if item["avg_latency_ms"] is not None else float("inf"),
                item["avg_ttft_ms"] if item["avg_ttft_ms"] is not None else float("inf"),
                item["consecutive_errors"],
            )
        )
        return candidates

    def _compute_model_selection_score(
        self,
        avg_latency_ms: float | None,
        avg_ttft_ms: float | None,
        consecutive_errors: int,
    ) -> float:
        score = 100.0
        latency_threshold = max(float(self.config.fallback.get("latency_threshold_ms", 30000)), 1.0)
        ttft_threshold = max(latency_threshold / 4, 1.0)

        if avg_latency_ms is not None:
            score -= min((avg_latency_ms / latency_threshold) * 40.0, 40.0)
        if avg_ttft_ms is not None:
            score -= min((avg_ttft_ms / ttft_threshold) * 20.0, 20.0)
        score -= consecutive_errors * 15.0
        return score

    def _make_scorer(self) -> RequestScorer:
        return RequestScorer(self.config.scoring, self.config.tier_order)

    @staticmethod
    def _request_text(request_body: dict[str, Any]) -> str:
        messages = request_body.get("messages", [])
        system_text = extract_text_from_system(request_body.get("system"))
        message_text = extract_text_from_messages(messages)
        return " ".join(part for part in [system_text, message_text] if part)
