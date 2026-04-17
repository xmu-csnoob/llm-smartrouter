"""Normalize upstream HTTP and transport failures into router-friendly categories."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from typing import Any

import httpx


_QUOTA_MESSAGE_KEYWORDS = (
    "usage limit",
    "quota exceeded",
    "insufficient quota",
    "insufficient balance",
    "credit exhausted",
    "billing hard limit",
    "reached your usage limit",
)

_QUOTA_CODE_KEYWORDS = (
    "insufficient_quota",
    "quota_exceeded",
    "insufficient_balance",
    "balance_exhausted",
    "credit_exhausted",
)

@dataclass(slots=True)
class UpstreamErrorInfo:
    """Normalized upstream failure signal used by routing and availability logic."""

    category: str
    provider_code: str | None = None
    provider_type: str | None = None
    message: str | None = None
    retry_after_seconds: float | None = None
    reset_at_epoch: float | None = None
    is_durable: bool = False
    source: str | None = None

    def to_log_dict(self) -> dict[str, Any]:
        return {
            "category": self.category,
            "provider_code": self.provider_code,
            "provider_type": self.provider_type,
            "message": self.message,
            "retry_after_seconds": self.retry_after_seconds,
            "reset_at_epoch": self.reset_at_epoch,
            "is_durable": self.is_durable,
            "source": self.source,
        }


def classify_upstream_response(
    status_code: int,
    headers: Any,
    body_text: str,
) -> UpstreamErrorInfo:
    """Classify a non-success upstream HTTP response."""
    header_map = _normalize_headers(headers)
    body_json = _try_parse_json(body_text)

    provider_code = _first_string(
        _get_nested(body_json, "error", "code"),
        _get_nested(body_json, "code"),
    )
    provider_type = _first_string(
        _get_nested(body_json, "error", "type"),
        _get_nested(body_json, "type"),
    )
    message = _first_string(
        _get_nested(body_json, "error", "message"),
        _get_nested(body_json, "message"),
        body_text.strip() or None,
    )
    retry_after_seconds = _parse_retry_after(header_map.get("retry-after"))
    reset_at_epoch = _parse_reset_time(header_map)

    normalized_code = (provider_code or "").lower()
    normalized_type = (provider_type or "").lower()
    normalized_message = (message or "").lower()

    if status_code == 429:
        if _looks_like_quota_exhaustion(normalized_code, normalized_type, normalized_message):
            return UpstreamErrorInfo(
                category="quota_exhausted",
                provider_code=provider_code,
                provider_type=provider_type,
                message=message,
                retry_after_seconds=retry_after_seconds,
                reset_at_epoch=reset_at_epoch,
                is_durable=True,
                source=_classify_source(body_json, header_map, message),
            )
        return UpstreamErrorInfo(
            category="transient_rate_limit",
            provider_code=provider_code,
            provider_type=provider_type,
            message=message,
            retry_after_seconds=retry_after_seconds,
            reset_at_epoch=reset_at_epoch,
            is_durable=False,
            source=_classify_source(body_json, header_map, message),
        )

    if status_code == 401:
        return UpstreamErrorInfo(
            category="auth_error",
            provider_code=provider_code,
            provider_type=provider_type,
            message=message,
            is_durable=True,
            source=_classify_source(body_json, header_map, message),
        )

    if status_code == 403:
        if _looks_like_quota_exhaustion(normalized_code, normalized_type, normalized_message):
            return UpstreamErrorInfo(
                category="quota_exhausted",
                provider_code=provider_code,
                provider_type=provider_type,
                message=message,
                retry_after_seconds=retry_after_seconds,
                reset_at_epoch=reset_at_epoch,
                is_durable=True,
                source=_classify_source(body_json, header_map, message),
            )
        if retry_after_seconds is not None or reset_at_epoch is not None:
            return UpstreamErrorInfo(
                category="transient_rate_limit",
                provider_code=provider_code,
                provider_type=provider_type,
                message=message,
                retry_after_seconds=retry_after_seconds,
                reset_at_epoch=reset_at_epoch,
                is_durable=False,
                source=_classify_source(body_json, header_map, message),
            )
        return UpstreamErrorInfo(
            category="permission_error",
            provider_code=provider_code,
            provider_type=provider_type,
            message=message,
            is_durable=True,
            source=_classify_source(body_json, header_map, message),
        )

    if 500 <= status_code <= 599:
        return UpstreamErrorInfo(
            category="server_error",
            provider_code=provider_code,
            provider_type=provider_type,
            message=message,
            retry_after_seconds=retry_after_seconds,
            reset_at_epoch=reset_at_epoch,
            source=_classify_source(body_json, header_map, message),
        )

    if 400 <= status_code <= 499:
        return UpstreamErrorInfo(
            category="bad_request_upstream",
            provider_code=provider_code,
            provider_type=provider_type,
            message=message,
            source=_classify_source(body_json, header_map, message),
        )

    return UpstreamErrorInfo(
        category="unknown_upstream_error",
        provider_code=provider_code,
        provider_type=provider_type,
        message=message,
        source=_classify_source(body_json, header_map, message),
    )


def classify_upstream_exception(exc: Exception) -> UpstreamErrorInfo:
    """Classify a transport or client-side failure before a useful HTTP response exists."""
    if isinstance(exc, httpx.TimeoutException):
        return UpstreamErrorInfo(
            category="timeout",
            message=str(exc) or exc.__class__.__name__,
            source=exc.__class__.__name__,
        )

    if isinstance(exc, httpx.TransportError):
        return UpstreamErrorInfo(
            category="connection_error",
            message=str(exc) or exc.__class__.__name__,
            source=exc.__class__.__name__,
        )

    return UpstreamErrorInfo(
        category="unknown_upstream_error",
        message=str(exc) or exc.__class__.__name__,
        source=exc.__class__.__name__,
    )


def _looks_like_quota_exhaustion(provider_code: str, provider_type: str, message: str) -> bool:
    if any(token and token in provider_code for token in _QUOTA_CODE_KEYWORDS):
        return True
    if any(token and token in provider_type for token in _QUOTA_CODE_KEYWORDS):
        return True
    return any(keyword in message for keyword in _QUOTA_MESSAGE_KEYWORDS)


def _normalize_headers(headers: Any) -> dict[str, str]:
    if headers is None:
        return {}
    if hasattr(headers, "items"):
        return {str(k).lower(): str(v) for k, v in headers.items()}
    return {}


def _try_parse_json(body_text: str) -> dict[str, Any] | None:
    if not body_text:
        return None
    try:
        parsed = json.loads(body_text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    value = value.strip()
    try:
        return max(float(value), 0.0)
    except ValueError:
        pass

    try:
        retry_time = parsedate_to_datetime(value).timestamp()
    except (TypeError, ValueError, IndexError, OverflowError):
        return None
    return max(retry_time - time.time(), 0.0)


def _parse_reset_time(header_map: dict[str, str]) -> float | None:
    for key in ("x-ratelimit-reset", "ratelimit-reset", "x-rate-limit-reset"):
        value = header_map.get(key)
        if not value:
            continue
        try:
            return float(value)
        except ValueError:
            continue
    return None


def _get_nested(data: dict[str, Any] | None, *path: str) -> Any:
    current: Any = data
    for part in path:
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _first_string(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _classify_source(body_json: dict[str, Any] | None, header_map: dict[str, str], message: str | None) -> str | None:
    if "retry-after" in header_map:
        return "header.retry-after"
    if any(key in header_map for key in ("x-ratelimit-reset", "ratelimit-reset", "x-rate-limit-reset")):
        return "header.rate-limit-reset"
    if _get_nested(body_json, "error", "code") is not None:
        return "body.error.code"
    if _get_nested(body_json, "error", "type") is not None:
        return "body.error.type"
    if _get_nested(body_json, "error", "message") is not None:
        return "body.error.message"
    if _get_nested(body_json, "message") is not None:
        return "body.message"
    if message:
        return "body.text"
    return None
