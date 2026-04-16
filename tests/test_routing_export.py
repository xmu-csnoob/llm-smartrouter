#!/usr/bin/env python3
"""Unit tests for GET /api/routing/export endpoint and stream_export_entries."""

import asyncio
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from llm_router.request_logger import RequestLogger


def make_entry(
    timestamp="2026-04-16T10:00:00+00:00",
    routed_model="gpt-4o",
    routed_tier="tier2",
    task_type="implementation",
    intent="debug",
    difficulty="medium",
    matched_by="keyword",
    matched_rule="impl-keywords",
    latency_ms=500.0,
    ttft_ms=120.0,
    status=200,
    input_tokens=300,
    output_tokens=600,
    cost=0.015,
    client_api_key="sk-test-key-123",
    error=None,
    is_fallback=False,
    fallback_reason=None,
    selected_tier="tier2",
    prompt="Fix the bug in my code",
):
    return {
        "timestamp": timestamp,
        "routed_model": routed_model,
        "routed_tier": routed_tier,
        "task_type": task_type,
        "intent": intent,
        "difficulty": difficulty,
        "matched_by": matched_by,
        "matched_rule": matched_rule,
        "latency_ms": latency_ms,
        "ttft_ms": ttft_ms,
        "status": status,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost": cost,
        "client_api_key": client_api_key,
        "error": error,
        "is_fallback": is_fallback,
        "fallback_reason": fallback_reason,
        "selected_tier": selected_tier,
        "prompt": prompt,
    }


def write_log_file(log_dir: Path, date: str, entries: list[dict]):
    """Write entries to a JSONL file."""
    path = log_dir / f"requests-{date}.jsonl"
    lines = [json.dumps(e, ensure_ascii=False) for e in entries]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


class TestStreamExportEntries(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.log_dir = Path(tempfile.mkdtemp())
        config = {
            "enabled": True,
            "dir": str(self.log_dir),
            "flush_interval_seconds": 2,
            "flush_batch_size": 50,
            "retention_days": 30,
            "archive_dir": "archive",
            "auto_archive_count": 10000,
            "auto_archive_days": 7,
        }
        self.logger = RequestLogger(config)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.log_dir, ignore_errors=True)

    async def _collect(self, hours=24, **kwargs):
        entries = []
        async for entry in self.logger.stream_export_entries(hours, **kwargs):
            entries.append(entry)
        return entries

    async def test_yields_all_entries_when_no_filters(self):
        write_log_file(self.log_dir, "2026-04-16", [make_entry()])
        entries = await self._collect(hours=24)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["routed_model"], "gpt-4o")
        self.assertEqual(entries[0]["routed_tier"], "tier2")

    async def test_filters_by_tier(self):
        write_log_file(
            self.log_dir, "2026-04-16",
            [make_entry(routed_tier="tier2"), make_entry(routed_tier="tier3")],
        )
        entries = await self._collect(hours=24, tier="tier2")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["routed_tier"], "tier2")

    async def test_filters_by_task_type(self):
        write_log_file(
            self.log_dir, "2026-04-16",
            [make_entry(task_type="debug"), make_entry(task_type="implementation")],
        )
        entries = await self._collect(hours=24, task_type="debug")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["task_type"], "debug")

    async def test_filters_by_intent(self):
        write_log_file(
            self.log_dir, "2026-04-16",
            [make_entry(intent="debug"), make_entry(intent="design")],
        )
        entries = await self._collect(hours=24, intent="design")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["intent"], "design")

    async def test_filters_by_difficulty(self):
        write_log_file(
            self.log_dir, "2026-04-16",
            [make_entry(difficulty="simple"), make_entry(difficulty="hard")],
        )
        entries = await self._collect(hours=24, difficulty="hard")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["difficulty"], "hard")

    async def test_combined_filters(self):
        write_log_file(
            self.log_dir, "2026-04-16",
            [
                make_entry(routed_tier="tier2", task_type="debug"),
                make_entry(routed_tier="tier3", task_type="debug"),
                make_entry(routed_tier="tier2", task_type="implementation"),
            ],
        )
        entries = await self._collect(hours=24, tier="tier2", task_type="debug")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["routed_tier"], "tier2")
        self.assertEqual(entries[0]["task_type"], "debug")

    async def test_routing_reason_construction(self):
        entry = make_entry(matched_by="keyword", matched_rule="impl-keywords")
        write_log_file(self.log_dir, "2026-04-16", [entry])
        result = (await self._collect(hours=24))[0]
        self.assertEqual(result["routing_reason"], "keyword:impl-keywords")

    async def test_routing_reason_empty_matched_by(self):
        entry = make_entry(matched_by="", matched_rule="default-rule")
        write_log_file(self.log_dir, "2026-04-16", [entry])
        result = (await self._collect(hours=24))[0]
        self.assertEqual(result["routing_reason"], "default-rule")

    async def test_routing_reason_empty_matched_rule(self):
        entry = make_entry(matched_by="scoring", matched_rule="")
        write_log_file(self.log_dir, "2026-04-16", [entry])
        result = (await self._collect(hours=24))[0]
        self.assertEqual(result["routing_reason"], "scoring")

    async def test_api_key_hashed(self):
        entry = make_entry(client_api_key="sk-test-key-123")
        write_log_file(self.log_dir, "2026-04-16", [entry])
        result = (await self._collect(hours=24))[0]
        # Should be hashed as key_xxxxxxxx (SHA256 prefix)
        self.assertTrue(result["client_api_key"].startswith("key_"))
        self.assertNotEqual(result["client_api_key"], "sk-test-key-123")
        self.assertEqual(len(result["client_api_key"]), 12)  # "key_" + 8 hex

    async def test_anonymous_key_preserved(self):
        entry = make_entry(client_api_key="anonymous")
        write_log_file(self.log_dir, "2026-04-16", [entry])
        result = (await self._collect(hours=24))[0]
        self.assertEqual(result["client_api_key"], "anonymous")

    async def test_excludes_old_entries_beyond_hours(self):
        old_entry = make_entry(timestamp="2026-04-10T10:00:00+00:00")  # 6 days ago
        write_log_file(self.log_dir, "2026-04-16", [old_entry])
        entries = await self._collect(hours=24)
        self.assertEqual(len(entries), 0)

    async def test_includes_recent_entries_within_hours(self):
        recent = datetime.now(timezone.utc).isoformat()
        entry = make_entry(timestamp=recent)
        write_log_file(
            self.log_dir,
            datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            [entry],
        )
        entries = await self._collect(hours=1)
        self.assertEqual(len(entries), 1)

    async def test_export_schema_fields(self):
        entry = make_entry()
        write_log_file(self.log_dir, "2026-04-16", [entry])
        result = (await self._collect(hours=24))[0]
        expected_fields = [
            "timestamp", "routed_model", "routed_tier",
            "task_type", "intent", "difficulty",
            "matched_by", "matched_rule", "routing_reason",
            "latency_ms", "ttft_ms", "status",
            "input_tokens", "output_tokens", "cost",
            "client_api_key", "error",
            "is_fallback", "fallback_reason",
            "selected_tier", "prompt",
        ]
        for field in expected_fields:
            self.assertIn(field, result, f"Missing field: {field}")

    async def test_optional_fields_missing_in_old_entry(self):
        minimal_entry = {
            "timestamp": "2026-04-16T10:00:00+00:00",
            "routed_model": "gpt-4o",
        }
        write_log_file(self.log_dir, "2026-04-16", [minimal_entry])
        result = (await self._collect(hours=24))[0]
        self.assertEqual(result["routed_model"], "gpt-4o")
        self.assertIsNone(result["intent"])
        self.assertIsNone(result["difficulty"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
