"""Semantic feature extraction for ML router training data (Phase 1 — data collection only)."""

from __future__ import annotations

import re
from typing import Any


# --- Intent Classification ---
# Order matters: first match wins (priority: debug > design > implement > review > explain > generate > question > general)

_DEBUG_INTENT = {
    "debug", "breakpoint", "console log", "print stack", "trace",
    "error handling", "fix", "crash", "bug", "issue", "problem",
    "null", "exception", "traceback", "failed", "failure", "stack trace",
    "segfault", "panic", "assertion failed",
}
_DESIGN_INTENT = {
    "design", "architecture", "design pattern", "refactor", "restructure", "scalable",
    "system design", "infrastructure", "migrate", "pattern",
    "microservice", "monolith", "layered", "clean architecture",
    "high availability", "fault tolerant", "load balancing",
}
_IMPLEMENT_INTENT = {
    "implement", "write code", "create function", "add feature", "build api",
    "write", "create", "add", "build", "function", "class", "api", "endpoint",
    "feature", "module", "method", "constructor", "initialize",
    "implement", "override", "extend", "implement interface",
}
_REVIEW_INTENT = {
    "review", "audit", "assess", "evaluate performance", "check quality",
    "security audit", "code review", "performance review",
}
_EXPLAIN_INTENT = {
    "explain", "analyze", "compare", "understand", "why", "how",
    "difference between", "advantage", "disadvantage",
    "pros and cons", "tradeoff", "explain why", "explain how",
    "what is the difference", "how does it work", "why does it",
}
_GENERATE_INTENT = {
    "generate", "create", "write", "compose", "summarize",
    "generate code", "generate test", "write test", "create documentation",
    "write unit test", "write integration test",
}
_QUESTION_INTENT = {
    "what is", "what are", "define", "summarize", "list",
    "tell me about", "give me", "show me", "what does", "what do",
    "how do i", "how can i", "is it possible", "can i",
}

_REASONING_KEYWORDS = {"reason", "logic", "deduce", "infer"}
_GENERATION_KEYWORDS = {"summarize", "compose"}
_CONSTRAINT_KEYWORDS = {"must", "must not", "require", "only", "limit", "constraint", "cannot", "should not"}
_COMPARISON_KEYWORDS = {"versus", "vs", "better", "worse"}

# --- Task Domain ---

_FRONTEND_KEYWORDS = {
    "react", "vue", "angular", "css", "html", "component", "ui", "frontend",
    "js", "tsx", "jsx", "svelte", "tailwind", "bootstrap", "css", "dom",
}
_BACKEND_KEYWORDS = {
    "api", "server", "database", "endpoint", "backend", "sql", "postgresql",
    "redis", "fastapi", "flask", "django", "express", "router", "controller",
    "orm", "migration", "crud", "rest", "graphql",
}
_INFRA_KEYWORDS = {
    "kubernetes", "k8s", "docker", "aws", "gcp", "azure", "deploy", "cicd",
    "infra", "infrastructure", "terraform", "ansible", "helm", "nginx",
    "load balancer", "dns", "cdn", "serverless",
}
_DATA_KEYWORDS = {
    "data", "analytics", "pipeline", "etl", "warehouse", "sql query",
    "analytics", "bi", "dataset", "dataframe", "spark", "kafka", "flink",
}
_MLOPS_KEYWORDS = {
    "train", "model", "feature", "experiment", "tuning", "hyperparameter",
    "training data", "dataset", "inference", "deploy", "mlflow", "weights",
}

# --- Error Pattern ---

_COMPILE_ERRORS = {
    "SyntaxError", "TypeError", "ImportError", "NameError",
    "IndentationError", "ParseError", "AttributeError",
}
_RUNTIME_ERRORS = {
    "RuntimeError", "NullPointerException", "KeyError", "ValueError",
    "IndexError", "StopIteration", "OSError", "IOError", "PermissionError",
    "ConnectionError", "TimeoutError", "FileNotFoundError",
}
_LOGIC_ERRORS = {
    "AssertionError", "LogicError", "AssertionFailed", "Assertion",
}


def classify_intent(text: str, messages: list[dict], signals: dict[str, int] | None = None) -> str:
    """Classify user intent (what the user wants to do).

    Uses signal count maximum when signals are provided (preferred),
    otherwise falls back to keyword matching for backward compatibility.

    Returns one of: debug, design, implement, review, explain, generate, question, general.
    """
    if signals is not None:
        # Max signal wins — avoids keyword first-match bias
        intent_signals = {
            "debug": signals.get("debug_signal_count", 0),
            "design": signals.get("design_signal_count", 0),
            "implement": signals.get("implementation_signal_count", 0),
            "review": signals.get("review_signal_count", 0),
            "explain": signals.get("explain_signal_count", 0),
            "generate": signals.get("generation_signal_count", 0),
            "question": signals.get("question_signal_count", 0),
        }
        best_intent = max(intent_signals, key=lambda k: intent_signals[k])
        if intent_signals[best_intent] > 0:
            return best_intent

    # Fallback: keyword matching (preserved for cases where signals aren't available)
    text_lower = text.lower()

    if _contains_any(text_lower, _DEBUG_INTENT):
        return "debug"
    if _contains_any(text_lower, _DESIGN_INTENT):
        return "design"
    if _contains_any(text_lower, _IMPLEMENT_INTENT):
        return "implement"
    if _contains_any(text_lower, _REVIEW_INTENT):
        return "review"
    if _contains_any(text_lower, _EXPLAIN_INTENT):
        return "explain"
    if _contains_any(text_lower, _GENERATE_INTENT):
        return "generate"
    if _contains_any(text_lower, _QUESTION_INTENT):
        return "question"
    return "general"


def classify_difficulty(raw_features: dict[str, Any], intent: str = "general") -> str:
    """Estimate task difficulty (how hard the task is).

    Intent-aware heuristics: design intent always complex (even short prompts),
    review/explain intent complex unless trivially tiny, debug intent complex if
    multi-file/stacktrace, question/general simple if tiny.

    Returns: simple | medium | complex
    """
    token_count = raw_features.get("estimated_tokens", 0)
    msg_count = raw_features.get("message_count", 0)
    code_blocks = raw_features.get("code_block_count", 0)
    file_count = raw_features.get("file_path_count", 0)
    stacktrace = raw_features.get("stacktrace_count", 0)
    tool_count = raw_features.get("tool_count", 0)

    # ── Intent-aware base ──
    if intent == "design":
        # Design intent always complex (even short prompts signal non-trivial intent)
        return "complex"

    if intent in ("review", "explain"):
        # Review/explain: complex unless truly trivial
        if token_count <= 50 and msg_count <= 1 and code_blocks == 0 and tool_count == 0:
            return "simple"
        return "complex"

    if intent in ("question", "general"):
        # Question/general: simple if tiny, complex only if large scale
        if token_count <= 600 and msg_count <= 3 and code_blocks == 0 and tool_count == 0:
            return "simple"
        if token_count > 4000 or msg_count > 20:
            return "complex"
        return "medium"

    if intent == "debug":
        # Debug: complex if multi-file or has stacktrace, simple if tiny
        if stacktrace > 0 or file_count >= 2:
            return "complex"
        if token_count <= 600 and msg_count <= 3 and code_blocks == 0 and tool_count == 0:
            return "simple"
        return "medium"

    if intent == "implement":
        # Implement: complex if multi-file or large tokens
        if token_count > 2000 or msg_count > 10:
            return "complex"
        if token_count <= 600 and msg_count <= 3 and code_blocks == 0 and tool_count == 0:
            return "simple"
        return "medium"

    # ── Complex structural signals ──
    if token_count > 4000 or msg_count > 20:
        return "complex"
    if file_count >= 3 and msg_count >= 4:
        return "complex"
    if stacktrace > 0 and (file_count >= 2 or code_blocks >= 3):
        return "complex"

    # ── Simple: tiny and clean ──
    if token_count <= 600 and msg_count <= 3 and code_blocks == 0 and tool_count == 0:
        return "simple"

    # ── Medium: everything else ──
    return "medium"


def classify_domain(text: str) -> str:
    """Classify task domain."""
    text_lower = text.lower()
    if _contains_any(text_lower, _FRONTEND_KEYWORDS):
        return "frontend"
    if _contains_any(text_lower, _BACKEND_KEYWORDS):
        return "backend"
    if _contains_any(text_lower, _INFRA_KEYWORDS):
        return "infra"
    if _contains_any(text_lower, _DATA_KEYWORDS):
        return "data"
    if _contains_any(text_lower, _MLOPS_KEYWORDS):
        return "mlops"
    return "general"


def classify_tool_usage(tool_count: int) -> str:
    """Classify tool usage pattern."""
    if tool_count == 0:
        return "no_tools"
    if tool_count == 1:
        return "single_tool"
    if tool_count <= 5:
        return "multi_tool"
    return "chained_tools"


def classify_error_pattern(stacktrace_count: int, text: str) -> str | None:
    """Classify error pattern type from stacktrace and text."""
    if stacktrace_count == 0:
        return None

    text_lower = text.lower()

    if _contains_any(text_lower, _COMPILE_ERRORS):
        return "compilation"
    if _contains_any(text_lower, _RUNTIME_ERRORS):
        return "runtime"
    if _contains_any(text_lower, _LOGIC_ERRORS):
        return "logic"
    if any(kw in text_lower for kw in ["slow", "bottleneck", "performance", "timeout", "latency", "memory leak"]):
        return "performance"
    return "runtime"


def detect_cross_file_analysis(file_path_count: int, message_count: int) -> bool:
    """Detect if this is a cross-file analysis request."""
    if file_path_count >= 3 and message_count >= 4:
        return True
    return False


def estimate_recursive_depth(text: str) -> str:
    """Estimate recursive depth from repeated file path segments."""
    # Find most common file path segment (last component before extension or after /)
    # Non-capturing group ensures findall returns full matches consistently
    segments = re.findall(r'(?:[\w]+)(?=\.\w+)|(?:[\w]+)/([\w]+)', text)
    if not segments:
        return "low"

    segment_counts: dict[str, int] = {}
    for seg in segments:
        if len(seg) > 2:  # skip short noise
            segment_counts[seg] = segment_counts.get(seg, 0) + 1

    if not segment_counts:
        return "low"

    max_count = max(segment_counts.values())
    if max_count >= 3:
        return "high"
    if max_count == 2:
        return "medium"
    return "low"


def estimate_turn_depth(message_count: int) -> str:
    """Estimate multi-turn conversation depth."""
    if message_count > 10:
        return "high"
    if message_count >= 4:
        return "medium"
    return "low"


def detect_requires_reasoning(
    intent: str,
    error_pattern_type: str | None,
    cross_file_analysis: bool,
) -> bool:
    """Detect if request requires reasoning."""
    # design, review, explain intents tend to require reasoning
    reasoning_intents = {"design", "review", "explain"}
    reasoning_errors = {"logic", "performance"}

    if intent in reasoning_intents:
        return True
    if error_pattern_type in reasoning_errors:
        return True
    if cross_file_analysis:
        return True
    return False


def estimate_clarification_score(
    raw_features: dict[str, Any],
    intent: str,
    messages: list[dict],
) -> float:
    """Estimate likelihood that a clarification will be needed (0.0 ~ 1.0)."""
    score = 0.0

    question_count = raw_features.get("question_count", 0)
    if question_count >= 3:
        score += 0.3

    message_count = raw_features.get("message_count", 0)
    input_chars = raw_features.get("input_chars", 0)
    is_followup = raw_features.get("is_followup", False)
    if not is_followup and message_count == 1 and input_chars < 100:
        score += 0.2

    if intent == "general":
        score += 0.2

    tool_count = raw_features.get("tool_count", 0)
    if tool_count == 0 and intent in ("explain", "review", "debug"):
        score += 0.3

    return min(score, 1.0)


def extract_keyword_signals(text: str) -> dict[str, int]:
    """Extract keyword signal counts from request text (word boundary match).

    These signals are used as ML training features and are orthogonal to intent classification.
    """
    text_lower = text.lower()

    def _count(keywords: set) -> int:
        return sum(1 for kw in keywords if re.search(r'\b' + re.escape(kw) + r'\b', text_lower))

    return {
        "debug_signal_count": _count(_DEBUG_INTENT),
        "design_signal_count": _count(_DESIGN_INTENT),
        "implementation_signal_count": _count(_IMPLEMENT_INTENT),
        "review_signal_count": _count(_REVIEW_INTENT),
        "explain_signal_count": _count(_EXPLAIN_INTENT),
        "generation_signal_count": _count(_GENERATION_KEYWORDS),
        "question_signal_count": _count(_QUESTION_INTENT),
        "reasoning_signal_count": _count(_REASONING_KEYWORDS),
        "constraint_signal_count": _count(_CONSTRAINT_KEYWORDS),
        "comparison_signal_count": _count(_COMPARISON_KEYWORDS),
        "migration_signal_count": _count({"migrate", "porting", "upgrade", "deprecated", "legacy", "transition"}),
        "performance_signal_count": _count({"performance", "optimize", "speed", "cache", "latency", "throughput", "slow", "bottleneck"}),
    }


def extract_semantic_features(
    messages: list[dict],
    request_text: str,
    raw_features: dict[str, Any],
) -> dict[str, Any]:
    """Extract all semantic features from a request.

    Args:
        messages: List of message dicts from the request
        request_text: Combined text from system + messages
        raw_features: Raw feature dict (used for tool_count, input_chars, etc.)

    Returns:
        Semantic features dict per Schema v3 spec
    """
    # Compute keyword signals first, then use for intent classification
    signals = extract_keyword_signals(request_text)
    intent = classify_intent(request_text, messages, signals=signals)
    difficulty = classify_difficulty(raw_features, intent=intent)
    domain = classify_domain(request_text)
    tool_pattern = classify_tool_usage(raw_features.get("tool_count", 0))
    stacktrace_count = raw_features.get("stacktrace_count", 0)
    error_type = classify_error_pattern(stacktrace_count, request_text)
    file_path_count = raw_features.get("file_path_count", 0)
    message_count = raw_features.get("message_count", 0)
    cross_file = detect_cross_file_analysis(file_path_count, message_count)
    recursive = estimate_recursive_depth(request_text)
    turns = estimate_turn_depth(message_count)
    reasoning = detect_requires_reasoning(intent, error_type, cross_file)
    clarify = estimate_clarification_score(raw_features, intent, messages)

    # is_followup: reuse from raw_features (already computed in proxy.py)
    is_followup = raw_features.get("is_followup", False)

    return {
        # Intent: what the user wants to do
        "intent": intent,
        # Difficulty: how hard the task is (heuristic, to be replaced by model)
        "difficulty": difficulty,
        # Domain: what tech area
        "domain": domain,
        # Derived features
        "tool_usage_pattern": tool_pattern,
        "error_pattern_type": error_type,
        "cross_file_analysis": cross_file,
        "recursive_depth": recursive,
        "multi_turn_depth": turns,
        "requires_reasoning": reasoning,
        "clarification_needed_score": clarify,
        "is_followup": is_followup,
        **signals,
    }


# --- Helper ---

def _contains_any(text: str, keywords: set) -> bool:
    """Check if any keyword is present in text (whole-word match)."""
    for kw in keywords:
        # Use word boundary to avoid partial matches
        if re.search(r'\b' + re.escape(kw) + r'\b', text):
            return True
    return False
