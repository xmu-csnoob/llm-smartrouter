"""影子策略控制器 — 安全地收集低层级执行样本."""

import random
import logging
import re
from typing import Literal

from .schemas import ShadowPolicyDecision, FeatureSnapshot

logger = logging.getLogger("llm_router")

DEBUG_KEYWORDS = [
    "debug", "root cause", "redesign", "refactor",
    "broken", "not working", "error", "fix",
    "bug", "crash", "fail", "issue", "problem",
]

SENSITIVE_PATTERNS = [
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",  # email
    r"\b\d{3}[-.]?\d{3}[-.]?\d{4}\b",  # phone
    r"\b[A-Za-z0-9]{32,}\b",  # API key / token
]


class ShadowPolicy:
    """影子策略控制器 — 安全地收集低层级执行样本."""

    def __init__(self, config: dict):
        self.enabled = config.get("enabled", False)
        self.observe_only_rate = config.get("observe_only_rate", 1.0)
        self.forced_tier1_to_tier2_rate = config.get("forced_tier1_to_tier2_rate", 0.01)
        self.forced_tier2_to_tier3_rate = config.get("forced_tier2_to_tier3_rate", 0.02)
        self.forbid_direct_tier1_to_tier3 = config.get("forbid_direct_tier1_to_tier3", True)
        self.hard_exclusions = config.get("hard_exclusions", {})
        self.debug_keywords = config.get("debug_keywords", DEBUG_KEYWORDS)

    def decide(
        self,
        request_body: dict,
        route_info: dict,
        feature_snapshot: FeatureSnapshot | None = None,
    ) -> ShadowPolicyDecision:
        """决定影子策略动作

        Args:
            request_body: 原始请求体
            route_info: 路由信息（包含基线 tier）
            feature_snapshot: 特征快照

        Returns:
            ShadowPolicyDecision
        """
        if not self.enabled:
            return ShadowPolicyDecision(
                enabled=False,
                mode="off",
                propensity=1.0,
            )

        baseline_tier = route_info.get("selected_tier", "")
        if not baseline_tier:
            return ShadowPolicyDecision(
                enabled=True,
                mode="observe_only",
                propensity=1.0,
            )

        # 检查硬性排除
        exclusions = self._check_hard_exclusions(
            request_body,
            route_info,
            feature_snapshot or FeatureSnapshot(**route_info.get("feature_values", {})),
        )

        if exclusions["should_exclude"]:
            return ShadowPolicyDecision(
                enabled=True,
                mode="observe_only",
                propensity=1.0,
                exclusion_reason=exclusions["reason"],
                hard_exclusions_triggered=exclusions["triggered_rules"],
            )

        # 决定采样类型和目标 tier
        decision = self._decide_sampling(baseline_tier, feature_snapshot)

        return ShadowPolicyDecision(
            enabled=True,
            mode=decision["mode"],
            candidate_tier=decision["candidate_tier"],
            propensity=decision["propensity"],
        )

    def _check_hard_exclusions(
        self,
        request_body: dict,
        route_info: dict,
        snapshot: FeatureSnapshot,
    ) -> dict:
        """检查硬性排除规则."""
        triggered = []
        reason = None

        excl = self.hard_exclusions

        # 1. 堆栈跟踪
        if snapshot.stacktrace_count >= excl.get("stacktrace_count_gte", 1):
            triggered.append("stacktrace_present")

        # 2. 代码块
        if snapshot.code_block_count >= excl.get("code_block_count_gte", 3):
            triggered.append("too_many_code_blocks")

        # 3. 文件路径
        if snapshot.file_path_count >= excl.get("file_path_count_gte", 3):
            triggered.append("too_many_file_paths")

        # 4. Token 数量
        if snapshot.estimated_tokens >= excl.get("estimated_tokens_gte", 3500):
            triggered.append("too_many_tokens")

        # 5. 消息数量
        if snapshot.message_count >= excl.get("message_count_gte", 12):
            triggered.append("too_many_messages")

        # 6. 工具使用
        if snapshot.tool_count >= excl.get("tool_count_gte", 1):
            triggered.append("tool_use_detected")

        # 7. 流式 + 大输出
        if snapshot.stream_flag and snapshot.max_tokens_requested >= 4096:
            triggered.append("streaming_large_output")

        # 8. Passthrough 规则
        if route_info.get("matched_by") == "passthrough":
            triggered.append("explicit_model_request")

        # 9. 架构任务
        if snapshot.task_type == "architecture":
            triggered.append("architecture_task")

        # 10. 调试关键词
        request_text = self._extract_request_text(request_body)
        if any(kw in request_text.lower() for kw in self.debug_keywords):
            triggered.append("debug_keywords_detected")

        # 11. 敏感信息模式
        for pattern in SENSITIVE_PATTERNS:
            if re.search(pattern, request_text):
                triggered.append("sensitive_info_detected")
                break

        if triggered:
            reason = f"排除规则触发: {', '.join(triggered[:3])}"

        return {
            "should_exclude": len(triggered) > 0,
            "reason": reason,
            "triggered_rules": triggered,
        }

    def _decide_sampling(
        self,
        baseline_tier: str,
        snapshot: FeatureSnapshot | None,
    ) -> dict:
        """决定采样类型和目标 tier."""
        # 默认观察模式
        if random.random() < self.observe_only_rate:
            return {
                "mode": "observe_only",
                "candidate_tier": None,
                "propensity": 1.0,
            }

        # tier1 → tier2
        if baseline_tier == "tier1":
            if random.random() < self.forced_tier1_to_tier2_rate:
                return {
                    "mode": "forced_lower_tier",
                    "candidate_tier": "tier2",
                    "propensity": self.forced_tier1_to_tier2_rate,
                }

        # tier2 → tier3
        if baseline_tier == "tier2":
            if random.random() < self.forced_tier2_to_tier3_rate:
                return {
                    "mode": "forced_lower_tier",
                    "candidate_tier": "tier3",
                    "propensity": self.forced_tier2_to_tier3_rate,
                }

        # tier1 → tier3 永远不允许
        if baseline_tier == "tier1" and self.forbid_direct_tier1_to_tier3:
            return {
                "mode": "observe_only",
                "candidate_tier": None,
                "propensity": 1.0,
            }

        # 默认观察
        return {
            "mode": "observe_only",
            "candidate_tier": None,
            "propensity": 1.0,
        }

    @staticmethod
    def _extract_request_text(request_body: dict) -> str:
        """提取请求文本（用于关键词检测）."""
        messages = request_body.get("messages", [])
        system = request_body.get("system", "")

        texts = []
        if isinstance(system, str):
            texts.append(system)
        elif isinstance(system, dict):
            texts.append(system.get("text", ""))

        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, str):
                texts.append(content)
            elif isinstance(content, list):
                for block in content:
                    if block.get("type") == "text":
                        texts.append(block.get("text", ""))

        return " ".join(texts)
