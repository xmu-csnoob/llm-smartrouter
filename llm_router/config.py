"""YAML configuration loader with env-var expansion and hot-reload."""

import os
import re
from pathlib import Path

import yaml


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
        self.server: dict = {}
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
        self.server = self._raw.get("server", {})

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
        }

    def get_provider(self, provider_name: str) -> dict:
        """Get provider config by name."""
        return self.providers.get(provider_name, {})

    def get_provider_for_model(self, model_id: str) -> dict:
        """Get provider config for a given model."""
        info = self.model_registry.get(model_id)
        if not info:
            return {}
        return self.get_provider(info["provider"])
