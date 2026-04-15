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
