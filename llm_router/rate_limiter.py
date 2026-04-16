"""Per-API-key rate limiting and token budget tracking."""

import json
import threading
import time
from datetime import datetime, timezone, date
from pathlib import Path
from typing import Any

from .config import RouterConfig


class RateLimitStore:
    """Persistent JSON store for rate limits and token budgets.

    Data layout:
    {
      "keys": {
        "<api_key>": {
          "request_counts": { "<YYYY-MM>": "<HH:mm>" -> count },
          "token_counts": { "<YYYY-MM>": total_tokens },
          "last_updated": "<iso timestamp>"
        }
      }
    }
    """

    def __init__(self, store_path: str | Path):
        self.store_path = Path(store_path)
        self._lock = threading.RLock()
        self._cache: dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        if self.store_path.exists():
            try:
                with open(self.store_path) as f:
                    self._cache = json.load(f)
            except (json.JSONDecodeError, IOError):
                self._cache = {"keys": {}}
        else:
            self._cache = {"keys": {}}
            self._persist_unlocked()

    def _persist_unlocked(self) -> None:
        self.store_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.store_path, "w") as f:
            json.dump(self._cache, f)

    def _now_minute(self) -> str:
        """Current minute as YYYY-MM-DD HH:MM string."""
        return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")

    def _current_month(self) -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m")

    def _record_request(self, api_key: str) -> tuple[int, int]:
        """Record a request. Returns (current_minute_count, current_month_token_count)."""
        with self._lock:
            key_data = self._cache["keys"].setdefault(api_key, {
                "request_counts": {},
                "token_counts": {},
                "last_updated": datetime.now(timezone.utc).isoformat(),
            })

            minute_key = self._now_minute()
            month_key = self._current_month()

            key_data["request_counts"][minute_key] = key_data["request_counts"].get(minute_key, 0) + 1
            # Note: token_counts are updated separately via record_tokens(), not here
            key_data["last_updated"] = datetime.now(timezone.utc).isoformat()

            self._persist_unlocked()
            return key_data["request_counts"][minute_key], key_data["token_counts"].get(month_key, 0)

    def record_tokens(self, api_key: str, input_tokens: int, output_tokens: int) -> None:
        """Record token usage for a request."""
        with self._lock:
            key_data = self._cache["keys"].setdefault(api_key, {
                "request_counts": {},
                "token_counts": {},
                "last_updated": datetime.now(timezone.utc).isoformat(),
            })
            month_key = self._current_month()
            key_data["token_counts"][month_key] = key_data["token_counts"].get(month_key, 0) + input_tokens + output_tokens
            key_data["last_updated"] = datetime.now(timezone.utc).isoformat()
            self._persist_unlocked()

    def get_request_count_last_minute(self, api_key: str) -> int:
        """Get request count in the current minute window."""
        with self._lock:
            key_data = self._cache["keys"].get(api_key, {})
            minute_key = self._now_minute()
            return key_data.get("request_counts", {}).get(minute_key, 0)

    def get_monthly_token_count(self, api_key: str) -> int:
        """Get total tokens used in current month."""
        with self._lock:
            key_data = self._cache["keys"].get(api_key, {})
            month_key = self._current_month()
            return key_data.get("token_counts", {}).get(month_key, 0)

    def get_all_key_stats(self) -> dict[str, dict[str, Any]]:
        """Return stats for all tracked API keys."""
        with self._lock:
            result = {}
            for key, data in self._cache.get("keys", {}).items():
                result[key] = {
                    "monthly_tokens": data.get("token_counts", {}).get(self._current_month(), 0),
                    "last_updated": data.get("last_updated"),
                }
            return result


class RateLimiter:
    """Check rate limits and budget for API keys."""

    def __init__(self, config: RouterConfig):
        self.config = config
        store_path = Path(config.logging_config.get("dir", "./logs")) / "rate_limits.json"
        self._store = RateLimitStore(store_path)

    def check(self, api_key: str) -> tuple[bool, str | None]:
        """Check if request is allowed. Returns (allowed, reason)."""
        if not api_key:
            return True, None

        key_config = self.config.api_keys.get(api_key)
        if not key_config:
            return True, None

        # Check rate limit
        rpm = key_config.get("requests_per_minute")
        if rpm is not None and rpm > 0:
            count = self._store.get_request_count_last_minute(api_key)
            if count >= rpm:
                return False, f"Rate limit exceeded: {count}/{rpm} requests per minute"

        # Check monthly budget
        budget = key_config.get("monthly_token_budget")
        if budget is not None and budget > 0:
            used = self._store.get_monthly_token_count(api_key)
            if used >= budget:
                return False, f"Monthly token budget exceeded: {used}/{budget} tokens"

        return True, None

    def record(self, api_key: str, input_tokens: int = 0, output_tokens: int = 0) -> None:
        """Record a request and its token usage."""
        if not api_key:
            return
        self._store._record_request(api_key)
        if input_tokens or output_tokens:
            self._store.record_tokens(api_key, input_tokens, output_tokens)

    def get_remaining(self, api_key: str) -> dict[str, Any]:
        """Get remaining quota for a key. Returns dict with rpm_remaining, budget_remaining, etc."""
        if not api_key:
            return {}

        key_config = self.config.api_keys.get(api_key, {})
        result = {}

        rpm = key_config.get("requests_per_minute")
        if rpm is not None and rpm > 0:
            used = self._store.get_request_count_last_minute(api_key)
            result["rpm_remaining"] = max(0, rpm - used)
            result["rpm_limit"] = rpm
            result["rpm_used"] = used

        budget = key_config.get("monthly_token_budget")
        if budget is not None and budget > 0:
            used = self._store.get_monthly_token_count(api_key)
            result["budget_remaining"] = max(0, budget - used)
            result["budget_limit"] = budget
            result["budget_used"] = used

        return result

    def get_all_stats(self) -> dict[str, dict[str, Any]]:
        """Return stats for all API keys with configured limits."""
        stats = {}
        for key, key_config in self.config.api_keys.items():
            if key_config.get("requests_per_minute") or key_config.get("monthly_token_budget"):
                stats[key] = {
                    **self.get_remaining(key),
                    "config": {
                        "requests_per_minute": key_config.get("requests_per_minute"),
                        "monthly_token_budget": key_config.get("monthly_token_budget"),
                        "allowed_tiers": key_config.get("allowed_tiers"),
                    }
                }
        return stats
