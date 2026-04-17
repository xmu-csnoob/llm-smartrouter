"""JSONL log loader with schema normalization and safe degradation."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

logger = logging.getLogger("llm_router.evaluation")


# Schema v3 field mapping.
# Value types:
#   str                        → single top-level key
#   tuple of str/tuple         → ordered alternatives; each element is either
#                                 a str (top-level key) or a tuple (nested path)
_SCHEMA_V3_MAP: dict[str, str | tuple] = {
    "request_id": "request_id",
    "timestamp": "timestamp",
    # logged routing
    "logged_routed_tier": ("routed_tier", "selected_tier"),
    "logged_routed_model": (
        "routed_model",
        ("model_selection", "selected_model"),
    ),
    "logged_routed_provider": "routed_provider",
    # logged performance
    "logged_latency_ms": "latency_ms",
    "logged_ttft_ms": "ttft_ms",
    # logged fallback
    "logged_is_fallback": "is_fallback",
    "logged_fallback_chain": "fallback_chain",
    # logged tokens
    "logged_estimated_tokens": "estimated_tokens",
}


def _get_nested(entry: dict[str, Any], path: str | tuple[str, ...]) -> Any:
    """Look up a path in entry.

    - str: top-level key lookup
    - tuple of str: nested traversal (each element is a successive key)
    """
    if isinstance(path, str):
        return entry.get(path)
    # Nested traversal
    current: Any = entry
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _get_alias(entry: dict[str, Any], *alternatives: str | tuple[str, ...]) -> Any:
    """Try each alternative in order, return first non-None value or None.

    Each alternative is either a str (top-level key) or a tuple (nested path).
    """
    for alt in alternatives:
        value = _get_nested(entry, alt)
        if value is not None:
            return value
    return None


def _normalize_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """Normalize a raw JSONL dict into EvalRecord-compatible form.

    Handles:
    - Field aliasing (e.g. selected_tier -> logged_routed_tier)
    - Missing fields degrade to None
    - Raw replay inputs (feature_values, legacy_rule_matches) preserved
    """
    normalized: dict[str, Any] = {}

    # Direct fields
    normalized["request_id"] = entry.get("request_id") or ""
    normalized["timestamp"] = entry.get("timestamp") or ""

    # Aliasing: try primary key first, then fallback keys
    for norm_key, src_path in _SCHEMA_V3_MAP.items():
        if norm_key in ("request_id", "timestamp"):
            continue
        if isinstance(src_path, tuple):
            normalized[norm_key] = _get_alias(entry, *src_path)
        else:
            normalized[norm_key] = entry.get(src_path)

    # Preserve raw replay inputs as-is
    normalized["feature_values"] = entry.get("feature_values")
    normalized["legacy_rule_matches"] = entry.get("legacy_rule_matches") or []

    return normalized


def _parse_timestamp(ts_str: str) -> datetime | None:
    """Parse an ISO timestamp string to an aware UTC datetime.

    Returns None if the timestamp cannot be parsed.
    Handles both naive (no timezone) and aware (with timezone suffix) formats.
    """
    if not ts_str:
        return None
    try:
        # Normalize Z suffix to +00:00 for Python's fromisoformat
        normalized = ts_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        # If naive, assume UTC
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, AttributeError):
        return None


def load(
    log_file: str | Path,
    limit: int | None = None,
    hours: int | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """Load and normalize JSONL log entries.

    Args:
        log_file: Path to the JSONL file.
        limit: Maximum number of entries to return (None = all).
        hours: If set, only return entries from the last N hours.

    Returns:
        (normalized_entries, filtered_out_count)

    Raises:
        FileNotFoundError: If log_file does not exist.
    """
    path = Path(log_file)
    if not path.exists():
        raise FileNotFoundError(f"Log file not found: {path}")

    # Only compute cutoff when hours filter is explicitly requested
    cutoff: datetime | None = None
    if hours is not None:
        from datetime import timedelta

        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(hours=hours)

    entries: list[dict[str, Any]] = []
    skipped = 0
    total = 0

    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            total += 1
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                logger.warning("Skipping malformed JSON line %d in %s", total, path)
                continue

            # Time-based filter — only active when hours is explicitly set
            if cutoff is not None:
                ts_str = raw.get("timestamp", "")
                ts = _parse_timestamp(ts_str)
                if ts is None:
                    # Unparseable timestamp — skip it
                    skipped += 1
                    continue
                if ts < cutoff:
                    skipped += 1
                    continue

            normalized = _normalize_entry(raw)
            # Attach raw inputs for replay
            normalized["_raw_feature_values"] = raw.get("feature_values")
            normalized["_raw_legacy_rule_matches"] = raw.get("legacy_rule_matches") or []
            entries.append(normalized)

            if limit is not None and len(entries) >= limit:
                break

    return entries, skipped


def load_iterator(
    log_file: str | Path,
    hours: int | None = None,
) -> Iterator[tuple[int, dict[str, Any]]]:
    """Streaming loader yielding (line_number, normalized_entry).

    Use this for very large log files to avoid loading all into memory.
    """
    path = Path(log_file)
    if not path.exists():
        raise FileNotFoundError(f"Log file not found: {path}")

    cutoff: datetime | None = None
    if hours is not None:
        from datetime import timedelta

        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(hours=hours)

    line_num = 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            line_num += 1
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                logger.warning("Skipping malformed JSON at line %d", line_num)
                continue

            if cutoff is not None:
                ts_str = raw.get("timestamp", "")
                ts = _parse_timestamp(ts_str)
                if ts is None or ts < cutoff:
                    continue

            normalized = _normalize_entry(raw)
            normalized["_raw_feature_values"] = raw.get("feature_values")
            normalized["_raw_legacy_rule_matches"] = raw.get("legacy_rule_matches") or []
            yield line_num, normalized
