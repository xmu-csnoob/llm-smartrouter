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
    r"(traceback|exception|stack trace|stacktrace|error:|warning:|at\s+[\w.$]+|\bline\s+\d+\b)",
    re.IGNORECASE,
)


DEFAULT_SCORING_CONFIG: dict[str, Any] = {
    "enabled": True,
    "legacy_rule_bonus": 2.0,
    "tiers": {
        "tier1": {"threshold": 6.0},
        "tier2": {"threshold": 3.0},
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
            "weights": {"tier1": 2.5, "tier2": 1.5},
        },
        "architecture_design": {
            "enabled": True,
            "thresholds": {"architecture_signal_count": 1},
            "weights": {"tier1": 4.5, "tier2": 1.0},
        },
        "debugging": {
            "enabled": True,
            "thresholds": {"debug_signal_count": 1},
            "weights": {"tier1": 3.5, "tier2": 1.0},
        },
        "migration_work": {
            "enabled": True,
            "thresholds": {"migration_signal_count": 1},
            "weights": {"tier1": 3.5, "tier2": 1.0},
        },
        "performance_work": {
            "enabled": True,
            "thresholds": {"performance_signal_count": 1},
            "weights": {"tier1": 3.5, "tier2": 1.0},
        },
        "implementation": {
            "enabled": True,
            "thresholds": {"implementation_signal_count": 1},
            "weights": {"tier2": 3.0, "tier1": 0.5},
        },
        "generation_heavy": {
            "enabled": True,
            "thresholds": {"generation_signal_count": 1},
            "weights": {"tier2": 3.0},
        },
        "constraint_heavy": {
            "enabled": True,
            "thresholds": {"constraint_signal_count": 2},
            "weights": {"tier2": 1.5, "tier1": 1.0},
        },
        "comparison_reasoning": {
            "enabled": True,
            "thresholds": {"comparison_signal_count": 1, "reasoning_signal_count": 2},
            "weights": {"tier1": 2.0, "tier2": 1.5},
        },
        "simple_prompt": {
            "enabled": True,
            "thresholds": {"estimated_tokens_max": 600, "message_count_max": 3},
            "weights": {"tier3": 2.0},
        },
    },
    "keywords": {
        "architecture": [
            "architect",
            "architecture",
            "design",
            "redesign",
            "tradeoff",
            "system design",
            "架构",
            "设计",
            "方案",
            "权衡",
        ],
        "debug": [
            "debug",
            "bug",
            "fix bug",
            "root cause",
            "investigate",
            "troubleshoot",
            "报错",
            "错误",
            "异常",
            "调试",
            "修复",
            "排查",
            "定位",
            "根因",
        ],
        "migration": [
            "migrate",
            "migration",
            "upgrade",
            "rewrite",
            "重构",
            "迁移",
            "升级",
            "重写",
        ],
        "performance": [
            "performance",
            "latency",
            "optimize",
            "memory leak",
            "race condition",
            "deadlock",
            "slow",
            "性能",
            "延迟",
            "优化",
            "内存泄漏",
            "竞态",
            "死锁",
        ],
        "reasoning": [
            "analyze",
            "analysis",
            "compare",
            "reason",
            "why",
            "plan",
            "tradeoff",
            "分析",
            "比较",
            "原因",
            "为什么",
            "推导",
            "规划",
        ],
        "implementation": [
            "implement",
            "build",
            "create",
            "add",
            "feature",
            "write code",
            "实现",
            "开发",
            "新增",
            "写代码",
            "改一下",
            "修改",
        ],
        "generation": [
            "readme",
            "documentation",
            "document",
            "spec",
            "report",
            "summary",
            "summarize",
            "polish",
            "rewrite",
            "readme.md",
            "文档",
            "说明",
            "总结",
            "摘要",
            "润色",
            "改写",
            "报告",
        ],
        "constraint": [
            "must",
            "should",
            "without",
            "compatible",
            "ensure",
            "safely",
            "必须",
            "不要",
            "不能",
            "兼容",
            "保证",
            "确保",
            "同时",
        ],
        "comparison": [
            "compare",
            "vs",
            "versus",
            "pros and cons",
            "tradeoff",
            "对比",
            "比较",
            "权衡",
        ],
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

    def __init__(self, scoring_config: dict[str, Any], tier_order: list[str]):
        self.config = scoring_config
        self.tier_order = tier_order
        self.keywords = scoring_config.get("keywords", {})

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
        text_lower = combined_text.lower()

        code_marker_count = len(_CODE_BLOCK_PATTERN.findall(combined_text))
        code_block_count = code_marker_count // 2 or (1 if code_marker_count else 0)
        file_path_count = len(_FILE_PATH_PATTERN.findall(combined_text))
        stacktrace_count = len(_STACKTRACE_PATTERN.findall(combined_text))
        question_count = combined_text.count("?") + combined_text.count("？")

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
            "architecture_signal_count": self._count_hits(text_lower, self.keywords.get("architecture", [])),
            "debug_signal_count": self._count_hits(text_lower, self.keywords.get("debug", [])),
            "migration_signal_count": self._count_hits(text_lower, self.keywords.get("migration", [])),
            "performance_signal_count": self._count_hits(text_lower, self.keywords.get("performance", [])),
            "reasoning_signal_count": self._count_hits(text_lower, self.keywords.get("reasoning", [])),
            "implementation_signal_count": self._count_hits(text_lower, self.keywords.get("implementation", [])),
            "generation_signal_count": self._count_hits(text_lower, self.keywords.get("generation", [])),
            "constraint_signal_count": self._count_hits(text_lower, self.keywords.get("constraint", [])),
            "comparison_signal_count": self._count_hits(text_lower, self.keywords.get("comparison", [])),
        }
        feature_values["error_signal_count"] = (
            feature_values["debug_signal_count"] + feature_values["performance_signal_count"] + stacktrace_count
        )
        feature_values["request_shape"] = {
            "input_chars": feature_values["input_chars"],
            "estimated_tokens": feature_values["estimated_tokens"],
            "message_count": feature_values["message_count"],
            "question_count": question_count,
            "tool_count": feature_values["tool_count"],
            "code_block_count": code_block_count,
            "file_path_count": file_path_count,
            "stacktrace_count": stacktrace_count,
        }
        feature_values["task_type"] = self._classify_task_type(feature_values)
        return feature_values

    def score_feature_snapshot(
        self,
        feature_values: dict[str, Any],
        legacy_rule_matches: list[dict[str, Any]] | None = None,
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
        is_short = (
            feature_values.get("estimated_tokens", 0) <= token_limit
            and feature_values.get("message_count", 0) <= message_limit
        )
        complex_signal_count = sum(
            feature_values.get(name, 0)
            for name in (
                "architecture_signal_count",
                "debug_signal_count",
                "migration_signal_count",
                "performance_signal_count",
                "comparison_signal_count",
                "implementation_signal_count",
                "generation_signal_count",
                "reasoning_signal_count",
                "constraint_signal_count",
                "stacktrace_count",
                "code_block_count",
                "file_path_count",
            )
        )
        active = is_short and complex_signal_count == 0
        reason = (
            f"estimated_tokens<={token_limit}, message_count<={message_limit}, "
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
        task_scores = {
            "architecture": feature_values.get("architecture_signal_count", 0),
            "debug": feature_values.get("debug_signal_count", 0) + feature_values.get("stacktrace_count", 0),
            "migration": feature_values.get("migration_signal_count", 0),
            "performance": feature_values.get("performance_signal_count", 0),
            "implementation": feature_values.get("implementation_signal_count", 0),
            "generation": feature_values.get("generation_signal_count", 0),
        }
        task_type, score = max(task_scores.items(), key=lambda item: item[1])
        if score > 0:
            return task_type
        if feature_values.get("estimated_tokens", 0) <= 600 and feature_values.get("message_count", 0) <= 3:
            return "simple"
        return "general"

    @staticmethod
    def _count_hits(text: str, keywords: list[str]) -> int:
        return sum(1 for keyword in keywords if keyword and keyword.lower() in text)
