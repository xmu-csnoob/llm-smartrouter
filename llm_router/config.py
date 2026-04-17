"""YAML configuration loader with env-var expansion and hot-reload."""

import hashlib
import json
import os
import re
from pathlib import Path

import yaml

from .scoring import merge_scoring_config


_ENV_PATTERN = re.compile(r"\$\{([^}]+)\}")


def _expand_env(value: str) -> str:
    """Replace ${VAR} with the environment variable value."""
    def _replacer(match):
        var = match.group(1)
        val = os.environ.get(var, "")
        if not val:
            raise ValueError(f"Environment variable {var} is not set")
        return val
    return _ENV_PATTERN.sub(_replacer, value)


def _expand_dict(d: dict) -> dict:
    """Recursively expand env vars in dict values."""
    result = {}
    for k, v in d.items():
        if isinstance(v, str):
            result[k] = _expand_env(v)
        elif isinstance(v, dict):
            result[k] = _expand_dict(v)
        elif isinstance(v, list):
            result[k] = [
                _expand_env(item) if isinstance(item, str) else
                _expand_dict(item) if isinstance(item, dict) else item
                for item in v
            ]
        else:
            result[k] = v
    return result


class RouterConfig:
    """Holds all configuration, rebuilt on reload."""

    def __init__(self, config_path: str | Path):
        self.config_path = Path(config_path)
        self._raw: dict = {}
        self.providers: dict = {}
        self.models: dict[str, list[dict]] = {}  # tier -> [{id, provider}]
        self.model_registry: dict[str, dict] = {}  # model_id -> {provider, tier}
        self.rules: list[dict] = []
        self.fallback: dict = {}
        self.scoring: dict = {}
        self.server: dict = {}
        self.ml_routing: dict = {}
        self.load()

    def load(self):
        """Load (or reload) config from YAML."""
        if not self.config_path.exists():
            raise FileNotFoundError(f"Config not found: {self.config_path}")

        with open(self.config_path) as f:
            self._raw = yaml.safe_load(f)

        # Expand env vars in providers section
        self.providers = {}
        for name, cfg in self._raw.get("providers", {}).items():
            self.providers[name] = _expand_dict(cfg)

        # Build model registry
        self.models = self._raw.get("models", {})
        self.model_registry = {}
        for tier, model_list in self.models.items():
            for m in model_list:
                self.model_registry[m["id"]] = {
                    "provider": m["provider"],
                    "tier": tier,
                }

        self.rules = self._raw.get("rules", [])
        self.fallback = self._raw.get("fallback", {})
        self.scoring = merge_scoring_config(self._raw.get("scoring"))
        self.server = self._raw.get("server", {})
        self.ml_routing = self._raw.get("ml_routing", {})

    @property
    def logging_config(self) -> dict:
        """Return logging config with defaults."""
        cfg = self._raw.get("logging", {})
        return {
            "enabled": cfg.get("enabled", True),
            "dir": cfg.get("dir", "./logs"),
            "flush_interval_seconds": cfg.get("flush_interval_seconds", 2),
            "flush_batch_size": cfg.get("flush_batch_size", 50),
            "retention_days": cfg.get("retention_days", 30),
            "archive_dir": cfg.get("archive_dir", "archive"),
            "auto_archive_count": cfg.get("auto_archive_count", 10000),
            "auto_archive_days": cfg.get("auto_archive_days", 7),
        }

    @property
    def tier_order(self) -> list[str]:
        """Return tiers ordered from strongest to weakest."""
        degradation_order = self.fallback.get("degradation_order", [])
        if degradation_order:
            return degradation_order
        return list(self.models.keys())

    def get_provider(self, provider_name: str) -> dict:
        """Get provider config by name."""
        return self.providers.get(provider_name, {})

    def get_provider_for_model(self, model_id: str) -> dict:
        """Get provider config for a given model."""
        info = self.model_registry.get(model_id)
        if not info:
            return {}
        return self.get_provider(info["provider"])

    @property
    def ml_routing_config(self) -> dict:
        """Return ML routing config with defaults."""
        cfg = self.ml_routing
        return {
            "enabled": cfg.get("enabled", False),
            "model_name": cfg.get("model_name", "leftfield7/bert-tiny-llm-router"),
            "model_cache_dir": cfg.get("model_cache_dir", "./models/cache"),
            "inference": {
                "timeout_ms": cfg.get("inference", {}).get("timeout_ms", 50),
                "fallback_on_error": cfg.get("inference", {}).get("fallback_on_error", True),
            },
            "weights": cfg.get("weights", {"tier1": 2.0, "tier2": 2.0, "tier3": 2.0}),
        }

    @property
    def shadow_policy_config(self) -> dict:
        """Return shadow policy config with defaults."""
        cfg = self._raw.get("shadow_policy", {})
        return {
            "enabled": cfg.get("enabled", False),
            "observe_only_rate": cfg.get("observe_only_rate", 1.0),
            "forced_tier1_to_tier2_rate": cfg.get("forced_tier1_to_tier2_rate", 0.01),
            "forced_tier2_to_tier3_rate": cfg.get("forced_tier2_to_tier3_rate", 0.02),
            "forbid_direct_tier1_to_tier3": cfg.get("forbid_direct_tier1_to_tier3", True),
            "hard_exclusions": cfg.get("hard_exclusions", {}),
            "debug_keywords": cfg.get("debug_keywords", [
                "debug", "root cause", "redesign", "refactor",
                "broken", "not working", "error", "fix",
                "bug", "crash", "fail", "issue", "problem",
            ]),
        }

    @property
    def redaction_config(self) -> dict:
        """Return redaction config with defaults."""
        cfg = self._raw.get("redaction", {})
        return {
            "enabled": cfg.get("enabled", True),
            "redact_paths": cfg.get("redact_paths", True),
        }

    @property
    def routing_policy_version(self) -> str:
        """Compute a stable version string for the routing policy.

        This encodes: config version, scoring config, rules, fallback config,
        and ML routing weights. Changes to any of these produce a new version,
        enabling correct profiling across policy changes.
        """
        parts = {
            "version": self._raw.get("version", "0"),
            "scoring": self.scoring,
            "rules": self.rules,
            "fallback": self.fallback,
            "ml_weights": self.ml_routing_config.get("weights", {}),
        }
        payload = json.dumps(parts, sort_keys=True)
        short = hashlib.sha256(payload.encode()).hexdigest()[:12]
        return f"v1-{short}"
