"""Semantic feature extraction for intent/difficulty classification."""

from typing import Any


def extract_semantic_features(
    messages: list[dict],
    request_text: str,
    raw_features: dict[str, Any],
) -> dict[str, Any]:
    """Extract semantic features from request for ML training data.

    Args:
        messages: List of message dicts from the request
        request_text: Combined text from system + messages
        raw_features: RawFeatures dict already extracted from the request

    Returns:
        dict matching SemanticFeatures schema
    """
    text_lower = request_text.lower()
    combined = f"{request_text}"

    # --- Intent classification (priority order: first match wins) ---
    intent_type = _classify_intent(text_lower, raw_features)

    # --- Task domain ---
    task_domain = _classify_domain(text_lower, raw_features)

    # --- Tool usage pattern ---
    tool_usage_pattern = _classify_tool_usage(messages)

    # --- Error pattern type ---
    error_pattern_type = _classify_error_pattern(text_lower)

    # --- Multi-file / cross-file analysis ---
    file_paths = raw_features.get("file_path_count", 0)
    cross_file_analysis = file_paths >= 2

    # --- Recursive depth ---
    recursive_depth = _classify_recursive_depth(text_lower, raw_features)

    # --- Multi-turn depth ---
    message_count = raw_features.get("message_count", 0)
    if message_count >= 10:
        multi_turn_depth = "high"
    elif message_count >= 4:
        multi_turn_depth = "medium"
    else:
        multi_turn_depth = "low"

    # --- Requires reasoning ---
    requires_reasoning = (
        intent_type in ("design", "architecture", "analysis")
        or raw_features.get("code_block_count", 0) >= 3
        or raw_features.get("stacktrace_count", 0) >= 2
    )

    # --- Clarification needed score ---
    clarification_needed_score = _calc_clarification_score(text_lower, raw_features)

    # --- Is followup ---
    is_followup = raw_features.get("is_followup", False)

    # --- Signal counts ---
    architecture_signal_count = _count_signals(text_lower, ARCHITECTURE_KEYWORDS)
    debug_signal_count = _count_signals(text_lower, DEBUG_KEYWORDS)
    migration_signal_count = _count_signals(text_lower, MIGRATION_KEYWORDS)
    performance_signal_count = _count_signals(text_lower, PERFORMANCE_KEYWORDS)
    reasoning_signal_count = _count_signals(text_lower, REASONING_KEYWORDS)
    implementation_signal_count = _count_signals(text_lower, IMPLEMENTATION_KEYWORDS)
    generation_signal_count = _count_signals(text_lower, GENERATION_KEYWORDS)
    constraint_signal_count = _count_signals(text_lower, CONSTRAINT_KEYWORDS)
    comparison_signal_count = _count_signals(text_lower, COMPARISON_KEYWORDS)

    return {
        "intent_type": intent_type,
        "task_domain": task_domain,
        "tool_usage_pattern": tool_usage_pattern,
        "error_pattern_type": error_pattern_type,
        "cross_file_analysis": cross_file_analysis,
        "recursive_depth": recursive_depth,
        "multi_turn_depth": multi_turn_depth,
        "requires_reasoning": requires_reasoning,
        "clarification_needed_score": clarification_needed_score,
        "is_followup": is_followup,
        "architecture_signal_count": architecture_signal_count,
        "debug_signal_count": debug_signal_count,
        "migration_signal_count": migration_signal_count,
        "performance_signal_count": performance_signal_count,
        "reasoning_signal_count": reasoning_signal_count,
        "implementation_signal_count": implementation_signal_count,
        "generation_signal_count": generation_signal_count,
        "constraint_signal_count": constraint_signal_count,
        "comparison_signal_count": comparison_signal_count,
    }


# --- Keyword sets for signal counting ---

ARCHITECTURE_KEYWORDS = [
    "architecture", "design pattern", "system design", "high-level",
    "microservice", "monolith", "layered", "modular",
]

DEBUG_KEYWORDS = [
    "debug", "bug", "error", "crash", "fail", "exception",
    "stacktrace", "traceback", "not working", "broken", "issue",
]

MIGRATION_KEYWORDS = [
    "migrate", "migration", "upgrade", "port", "convert",
    "refactor", "replacement", "deprecation",
]

PERFORMANCE_KEYWORDS = [
    "performance", "latency", "throughput", "optimize", "bottleneck",
    "slow", "cache", "parallel", "concurrent",
]

REASONING_KEYWORDS = [
    "reason", "explain", "why", "how does", "understand",
    "analysis", "compare", "evaluate", "assess",
]

IMPLEMENTATION_KEYWORDS = [
    "implement", "write code", "function", "class", "method",
    "algorithm", "data structure", "api endpoint", "handler",
]

GENERATION_KEYWORDS = [
    "generate", "create", "make a", "build", "new file",
    "scaffold", "boilerplate", "template",
]

CONSTRAINT_KEYWORDS = [
    "must", "require", "constraint", "limit", "only allow",
    "only use", "should not", "cannot", "cannot use",
]

COMPARISON_KEYWORDS = [
    "compare", "difference between", "vs", "versus",
    "advantage", "disadvantage", "pros and cons", "better",
]


def _classify_intent(text_lower: str, raw_features: dict[str, Any]) -> str:
    """Classify intent type by priority (first match wins)."""
    if any(kw in text_lower for kw in ["debug", "fix", "bug", "error", "crash", "fail"]):
        return "debug"
    if any(kw in text_lower for kw in ["design", "architecture", "system design", "pattern"]):
        return "design"
    if any(kw in text_lower for kw in ["implement", "write code", "create function", "add feature"]):
        return "implementation"
    if any(kw in text_lower for kw in ["review", "refactor", "improve", "optimize"]):
        return "review"
    if any(kw in text_lower for kw in ["explain", "why does", "how does", "what is", "understand"]):
        return "explain"
    if any(kw in text_lower for kw in ["generate", "create", "make a", "write a"]):
        return "generate"
    if any(kw in text_lower for kw in ["question", "help", "?"]) and raw_features.get("question_count", 0) >= 2:
        return "question"
    return "general"


def _classify_domain(text_lower: str, raw_features: dict[str, Any]) -> str:
    """Classify task domain."""
    if any(kw in text_lower for kw in ["api", "endpoint", "http", "rest", "graphql", "grpc"]):
        return "api"
    if any(kw in text_lower for kw in ["database", "sql", "query", "schema", "migration"]):
        return "database"
    if any(kw in text_lower for kw in ["frontend", "ui", "css", "html", "react", "component"]):
        return "frontend"
    if any(kw in text_lower for kw in ["backend", "server", "service", "microservice"]):
        return "backend"
    if any(kw in text_lower for kw in ["devops", "docker", "kubernetes", "deployment", "ci/cd"]):
        return "devops"
    if any(kw in text_lower for kw in ["testing", "test", "unit test", "integration test"]):
        return "testing"
    return "general"


def _classify_tool_usage(messages: list[dict]) -> str:
    """Classify tool usage pattern."""
    tools_seen = set()
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    tools_seen.add(block.get("name", "unknown"))
    if not tools_seen:
        return "no_tools"
    if len(tools_seen) >= 5:
        return "multi_tool"
    return "single_tool"


def _classify_error_pattern(text_lower: str) -> str | None:
    """Classify error pattern type."""
    error_patterns = [
        ("syntax error", "syntax"),
        ("runtime error", "runtime"),
        ("compile error", "compile"),
        (" linker", "linker"),
        ("exception", "exception"),
        ("timeout", "timeout"),
        ("crash", "crash"),
        ("deadlock", "concurrency"),
        ("race condition", "concurrency"),
        ("memory leak", "memory"),
        ("null pointer", "null"),
        ("undefined", "undefined"),
        ("permission denied", "permission"),
        ("connection refused", "network"),
        ("authentication", "auth"),
        ("authorization", "auth"),
    ]
    for pattern, label in error_patterns:
        if pattern in text_lower:
            return label
    return None


def _classify_recursive_depth(text_lower: str, raw_features: dict[str, Any]) -> str:
    """Classify recursive depth from stacktrace count and code blocks."""
    stacktrace_count = raw_features.get("stacktrace_count", 0)
    code_block_count = raw_features.get("code_block_count", 0)
    if stacktrace_count >= 5 or code_block_count >= 5:
        return "high"
    if stacktrace_count >= 2 or code_block_count >= 2:
        return "medium"
    return "low"


def _calc_clarification_score(text_lower: str, raw_features: dict[str, Any]) -> float:
    """Calculate a 0-1 score for how likely clarification is needed."""
    score = 0.0
    if raw_features.get("file_path_count", 0) >= 3:
        score += 0.3
    if raw_features.get("stacktrace_count", 0) >= 2:
        score += 0.3
    if raw_features.get("question_count", 0) >= 3:
        score += 0.2
    if not raw_features.get("has_system_prompt", False):
        score += 0.1
    if raw_features.get("message_count", 0) == 1:
        score += 0.1
    return min(score, 1.0)


def _count_signals(text_lower: str, keywords: list[str]) -> int:
    """Count how many keywords from a list appear in the text."""
    return sum(1 for kw in keywords if kw in text_lower)
