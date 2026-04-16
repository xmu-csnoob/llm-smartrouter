"""Pydantic models for Anthropic Messages API."""

from typing import Any

from pydantic import BaseModel, Field


# --- Anthropic Messages API Request ---

class AnthropicContent(BaseModel):
    type: str
    text: str | None = None
    # For tool_use, image, etc.
    model_config = {"extra": "allow"}


class AnthropicMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str | list[AnthropicContent] | None = None
    model_config = {"extra": "allow"}


class AnthropicTool(BaseModel):
    name: str
    description: str | None = None
    input_schema: dict | None = None
    model_config = {"extra": "allow"}


class AnthropicMessagesRequest(BaseModel):
    model: str
    messages: list[AnthropicMessage]
    max_tokens: int = 4096
    system: str | list[dict] | None = None
    temperature: float | None = None
    top_p: float | None = None
    top_k: int | None = None
    stream: bool = False
    stop_sequences: list[str] | None = None
    tools: list[AnthropicTool] | None = None
    tool_choice: Any = None
    thinking: Any = None
    model_config = {"extra": "allow"}


# --- Status/Models ---

class ModelInfo(BaseModel):
    id: str
    provider: str
    tier: str
    available: bool
    avg_latency_ms: float | None = None
    avg_ttft_ms: float | None = None
    consecutive_errors: int = 0


class StatusResponse(BaseModel):
    models: list[ModelInfo]
    total_requests: int = 0


# --- Schema v3: ML Router Training Data ---

class RawFeatures(BaseModel):
    estimated_tokens: int = 0
    message_count: int = 0
    user_message_count: int = 0
    assistant_message_count: int = 0
    tool_count: int = 0
    question_count: int = 0
    code_block_count: int = 0
    file_path_count: int = 0
    stacktrace_count: int = 0
    max_tokens_requested: int = 0
    input_chars: int = 0
    has_system_prompt: bool = False
    system_prompt_chars: int = 0
    is_stream: bool = False
    is_followup: bool = False
    hour_of_day_utc: int = 0  # UTC hour 0-23


class SemanticFeatures(BaseModel):
    # Intent — what the user wants to do
    intent: str = "general"
    # Difficulty — how hard the task is (heuristic placeholder, to be replaced by model)
    difficulty: str = "medium"
    # Domain — what tech area
    domain: str = "general"
    # Content signals
    tool_usage_pattern: str = "no_tools"
    error_pattern_type: str | None = None
    cross_file_analysis: bool = False
    recursive_depth: str = "low"
    multi_turn_depth: str = "low"
    requires_reasoning: bool = False
    clarification_needed_score: float = 0.0
    is_followup: bool = False
    # Keyword signals (for ML training data)
    debug_signal_count: int = 0
    design_signal_count: int = 0
    implementation_signal_count: int = 0
    review_signal_count: int = 0
    explain_signal_count: int = 0
    generation_signal_count: int = 0
    reasoning_signal_count: int = 0
    constraint_signal_count: int = 0
    comparison_signal_count: int = 0
    migration_signal_count: int = 0
    performance_signal_count: int = 0


class RouterContext(BaseModel):
    tier1_health_score: float | None = None
    tier2_health_score: float | None = None
    tier3_health_score: float | None = None
    selected_tier: str | None = None
    matched_by: str | None = None


# --- ML Router / Shadow Policy ---


class FeatureSnapshot(BaseModel):
    """Feature snapshot used by ML router and shadow policy."""
    estimated_tokens: int = 0
    message_count: int = 0
    user_message_count: int = 0
    assistant_message_count: int = 0
    code_block_count: int = 0
    file_path_count: int = 0
    stacktrace_count: int = 0
    tool_count: int = 0
    question_count: int = 0
    max_tokens_requested: int = 0
    stream_flag: bool = False
    complexity_signal_count: int = 0
    error_signal_count: int = 0
    matched_rule_count: int = 0
    hour_of_day_utc: int = 0
    tier1_health_score: float | None = None
    tier2_health_score: float | None = None
    tier3_health_score: float | None = None


class TierSafetyPrediction(BaseModel):
    """ML model prediction result for tier safety probabilities."""
    raw_probabilities: dict = {}
    calibrated_probabilities: dict = {}
    lower_confidence_bounds: dict = {}
    ood_detected: bool = False
    ood_reason: str | None = None


class ShadowPolicyDecision(BaseModel):
    """Decision made by shadow policy controller."""
    enabled: bool = False
    mode: str = "off"  # off | observe_only | forced_lower_tier
    candidate_tier: str | None = None
    propensity: float = 1.0
    exclusion_reason: str | None = None
    hard_exclusions_triggered: list = []
