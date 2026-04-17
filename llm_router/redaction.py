"""PII redaction helpers for request logging."""

import re
from pathlib import Path

EMAIL_PATTERN = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b")
PHONE_PATTERN = re.compile(r"\b\d{3}[-.]?\d{3}[-.]?\d{4}\b")
SECRET_PATTERN = re.compile(r"\b[A-Za-z0-9]{32,}\b")
URL_PATTERN = re.compile(r"https?://[^\s<>\"{}|\\^`\[\]]+")
PATH_PATTERN = re.compile(r'([A-Za-z]:\\[^\\"<>|\n]*|/[^\\"<>|\n]*)')


def _clip(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: max(limit - 1, 0)] + "…"


class Redactor:
    """Redact sensitive text while keeping enough context for analysis."""

    def __init__(self, config: dict):
        self.enabled = config.get("enabled", config.get("redaction_enabled", True))
        self.redact_paths = config.get("redact_paths", True)

    def redact_request_text(self, request_body: dict) -> str:
        """Return a compact redacted request summary."""
        if not self.enabled:
            return self._extract_text_summary(request_body)

        return self.redact_text(self._extract_text_summary(request_body))

    def redact_request_context(
        self,
        request_body: dict,
        *,
        max_messages: int = 6,
        max_chars_per_message: int = 280,
        max_system_chars: int = 280,
    ) -> dict:
        """Return a structured redacted preview of system + recent messages."""
        system = request_body.get("system")
        system_preview = ""
        if isinstance(system, str):
            system_preview = self.redact_text(_clip(system, max_system_chars))
        elif isinstance(system, list):
            parts = []
            for item in system:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict) and item.get("type") == "text" and item.get("text"):
                    parts.append(str(item["text"]))
            system_preview = self.redact_text(_clip("\n".join(parts), max_system_chars)) if parts else ""

        message_previews = []
        messages = request_body.get("messages", [])
        for msg in messages[:max_messages]:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            text = ""
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                parts = []
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "text" and block.get("text"):
                        parts.append(str(block["text"]))
                    elif block.get("type") == "tool_result" and block.get("content"):
                        parts.append(str(block["content"]))
                text = "\n".join(parts)
            message_previews.append({
                "role": role,
                "text": self.redact_text(_clip(text, max_chars_per_message)),
            })

        return {
            "system_preview": system_preview,
            "message_previews": message_previews,
            "message_count": len(messages),
            "preview_count": len(message_previews),
        }

    def redact_text(self, text: str) -> str:
        """Redact sensitive content from arbitrary text."""
        if not self.enabled:
            return text

        text = EMAIL_PATTERN.sub("<EMAIL>", text)
        text = PHONE_PATTERN.sub("<PHONE>", text)
        text = SECRET_PATTERN.sub("<SECRET>", text)
        text = self._redact_urls(text)
        if self.redact_paths:
            text = self._redact_paths(text)
        return text

    def _extract_text_summary(self, request_body: dict) -> str:
        parts = []
        system = request_body.get("system")
        if isinstance(system, str):
            parts.append(f"[SYSTEM] {system[:200]}")
        elif isinstance(system, dict):
            parts.append(f"[SYSTEM] {system.get('text', '')[:200]}")

        messages = request_body.get("messages", [])
        for msg in messages[:3]:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")

            if isinstance(content, str):
                parts.append(f"[{role.upper()}] {content[:200]}")
            elif isinstance(content, list):
                texts = [b.get("text", "")[:100] for b in content if b.get("type") == "text"]
                parts.append(f"[{role.upper()}] {' '.join(texts)[:200]}")

        return " | ".join(parts)

    def _redact_urls(self, text: str) -> str:
        def replace_url(match):
            url = match.group(0)
            try:
                from urllib.parse import urlparse
                parsed = urlparse(url)
                return f"<URL: {parsed.netloc}>"
            except Exception:
                return "<URL>"

        return URL_PATTERN.sub(replace_url, text)

    def _redact_paths(self, text: str) -> str:
        def replace_path(match):
            path = match.group(0)
            basename = Path(path).name
            return f"<PATH: .../{basename}>"

        return PATH_PATTERN.sub(replace_path, text)
