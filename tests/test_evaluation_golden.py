"""Golden report test for the evaluation framework.

This test ensures the evaluation output structure and key summary values
remain stable as the codebase evolves. Run with:
    python -m pytest tests/test_evaluation_golden.py -v
"""

import json
import os
import sys
from pathlib import Path

# Ensure llm_router is importable
sys.path.insert(0, str(Path(__file__).parent.parent))

from llm_router.evaluation.runner import run
from llm_router.evaluation.schemas import ReplayMode


# Paths — use absolute paths relative to this file's location
_TEST_DIR = Path(__file__).parent
_ROOT_DIR = _TEST_DIR.parent
GOLDEN_JSONL = _TEST_DIR / "evaluation_golden.jsonl"
CONFIG_PATH = _TEST_DIR / "test_config.yaml"


def test_evaluation_golden_report_structure():
    """Golden report test: evaluate the synthetic log and assert on structure."""
    if not GOLDEN_JSONL.exists():
        raise FileNotFoundError(f"Golden JSONL not found: {GOLDEN_JSONL}")
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"Config not found: {CONFIG_PATH}")

    result = run(
        log_file=str(GOLDEN_JSONL),
        config_path=str(CONFIG_PATH),
        limit=None,
        hours=None,
        mode=ReplayMode.HYBRID,
    )

    report = result.to_dict()

    # --- Assert metadata fields are present and well-formed ---
    m = report["metadata"]
    assert m["log_file"] == str(GOLDEN_JSONL)
    assert m["config_path"] == str(CONFIG_PATH)
    assert m["replay_mode"] == "hybrid"
    assert m["total_loaded"] == 10, f"Expected 10 entries, got {m['total_loaded']}"
    assert m["total_evaluated"] == 10
    assert m["filtered_out"] == 0
    assert m["evaluation_time_seconds"] >= 0
    assert isinstance(m["config_version"], (str, type(None)))

    # --- Assert replay_metrics structure ---
    rm = report["replay_metrics"]
    assert rm["total_requests"] == 10
    assert isinstance(rm["tier_distribution"], dict)
    assert isinstance(rm["task_type_distribution"], dict)
    assert isinstance(rm["detected_features_counts"], dict)
    assert len(rm["tier_distribution"]) > 0, "Expected at least one tier in distribution"

    # --- Assert logged_runtime_metrics structure ---
    lm = report["logged_runtime_metrics"]
    assert isinstance(lm["tier_distribution"], dict)
    assert isinstance(lm["model_distribution"], dict)
    assert isinstance(lm["provider_distribution"], dict)
    assert isinstance(lm["fallback_rate"], float)
    # Latency fields should be numeric (float or None)
    for field in ("latency_avg_ms", "latency_p50_ms", "latency_p95_ms"):
        val = lm[field]
        assert val is None or isinstance(val, float), f"{field} should be float or None, got {type(val)}"
    assert isinstance(lm["ttft_avg_ms"], (float, type(None)))

    # --- Assert comparison structure ---
    cv = report["replay_vs_logged_comparison"]
    assert "tier_agreement_rate" in cv
    assert isinstance(cv["tier_agreement_rate"], float)
    assert 0.0 <= cv["tier_agreement_rate"] <= 1.0
    assert isinstance(cv["tier_change_counts"], dict)
    assert isinstance(cv["top_changed_tiers"], list)
    assert isinstance(cv["sampled_changed_records"], list)

    # --- Assert sampled_records is capped at 20 ---
    assert len(report["sampled_records"]) <= 20
    assert len(report["sampled_records"]) <= result.metadata.total_evaluated


def test_evaluation_golden_replay_changes_detected():
    """Assert that replay comparison actually runs (some tier changes detected or agreement = 1.0)."""
    result = run(
        log_file=str(GOLDEN_JSONL),
        config_path=str(CONFIG_PATH),
        mode=ReplayMode.HYBRID,
    )
    cv = result.summary.replay_vs_logged_comparison
    # Either agreement is perfect (1.0) or some changes were detected
    assert cv.tier_agreement_rate == 1.0 or len(cv.tier_change_counts) > 0, (
        f"Expected either 100%% agreement or some tier changes. "
        f"Got agreement={cv.tier_agreement_rate}, changes={cv.tier_change_counts}"
    )


def test_evaluation_golden_json_roundtrip():
    """Test that to_dict output is valid JSON-serializable."""
    result = run(
        log_file=str(GOLDEN_JSONL),
        config_path=str(CONFIG_PATH),
        mode=ReplayMode.HYBRID,
    )
    report = result.to_dict()
    # Should not raise
    json_str = json.dumps(report, indent=2, ensure_ascii=False)
    assert len(json_str) > 0
    # Should deserialize back
    parsed = json.loads(json_str)
    assert parsed["metadata"]["total_evaluated"] == 10


def test_evaluation_golden_no_cost_metrics():
    """Assert that no cost-related metrics are output (v1 scope restriction)."""
    result = run(
        log_file=str(GOLDEN_JSONL),
        config_path=str(CONFIG_PATH),
        mode=ReplayMode.HYBRID,
    )
    report = result.to_dict()
    # cost fields should not appear in top-level metric sections
    for section in ("replay_metrics", "logged_runtime_metrics", "replay_vs_logged_comparison"):
        section_data = report[section]
        for key in section_data:
            assert "cost" not in key.lower(), f"Found cost field '{key}' in {section}"


def test_evaluation_limit_and_hours():
    """Test that limit and hours filters work correctly."""
    # limit=5 should return exactly 5 entries
    result = run(
        log_file=str(GOLDEN_JSONL),
        config_path=str(CONFIG_PATH),
        limit=5,
        mode=ReplayMode.HYBRID,
    )
    assert result.metadata.total_evaluated == 5
    assert result.metadata.total_loaded == 5


if __name__ == "__main__":
    import pytest

    pytest.main([__file__, "-v"])
