"""Request logger — async queue + background flush to daily JSONL files."""

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger("llm_router")


class RequestLogger:
    """Buffers request log entries in an async queue, flushes to JSONL."""

    def __init__(self, config: dict):
        self.enabled = config.get("enabled", True)
        self.log_dir = Path(config.get("dir", "./logs"))
        self.flush_interval = config.get("flush_interval_seconds", 2)
        self.flush_batch = config.get("flush_batch_size", 50)
        self.retention_days = config.get("retention_days", 30)
        self._queue: asyncio.Queue | None = None
        self._task: asyncio.Task | None = None
        self._running = False

    def start(self):
        """Start the background flush loop."""
        if not self.enabled:
            logger.info("Request logging disabled")
            return
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self._queue = asyncio.Queue()
        self._running = True
        self._task = asyncio.create_task(self._flush_loop())
        logger.info(f"Request logger started, dir={self.log_dir}")

    async def stop(self):
        """Flush remaining entries and stop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._queue:
            await self._flush_remaining()
        logger.info("Request logger stopped")

    def log(self, entry: dict):
        """Enqueue a log entry. Non-blocking, microsecond-scale."""
        if not self.enabled or not self._queue:
            return
        self._queue.put_nowait(entry)

    def get_recent(self, offset: int = 0, limit: int = 50) -> dict:
        """Read paginated entries from log files.

        Returns:
            dict: { "entries": [...], "total": N, "offset": offset, "limit": limit }
        """
        if not self.enabled:
            return {"entries": [], "total": 0, "offset": offset, "limit": limit}

        if not self.log_dir.exists():
            return {"entries": [], "total": 0, "offset": offset, "limit": limit}

        all_entries = self._read_all_entries()
        all_entries.sort(key=lambda entry: entry.get("timestamp", ""), reverse=True)

        total = len(all_entries)
        entries = all_entries[offset:offset + limit]

        return {
            "entries": entries,
            "total": total,
            "offset": offset,
            "limit": limit,
        }

    def get_entries_for_analysis(self, hours: int = 24) -> list[dict]:
        """Get all entries within the time window, sorted by timestamp."""
        entries = self._read_recent_entries(hours)
        entries.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
        return entries

    def get_stats(self, hours: int = 24) -> dict:
        """Aggregate stats from recent log files."""
        if not self.enabled:
            return {}
        entries = self._read_recent_entries(hours)
        if not entries:
            return {
                "total": 0,
                "errors": 0,
                "error_rate": 0,
                "fallbacks": 0,
                "fallback_rate": 0,
                "avg_latency_ms": None,
                "avg_ttft_ms": None,
                "models": {},
                "selected_tiers": {},
                "routed_tiers": {},
                "matched_by": {},
                "matched_rules": {},
                "feature_counts": {},
                "fallback_reasons": {},
                "avg_tier_scores": {},
                "schema_versions": {},
                "task_types": {},
                "passthrough_requests": 0,
                "streaming_requests": 0,
                "feature_snapshot_count": 0,
                "selected_tier_count": 0,
                "observability_only_count": 0,
            }

        total = len(entries)
        errors = sum(1 for e in entries if e.get("status") != 200)
        fallbacks = sum(1 for e in entries if e.get("is_fallback"))
        latencies = [e["latency_ms"] for e in entries if e.get("latency_ms") is not None]
        ttfts = [e["ttft_ms"] for e in entries if e.get("ttft_ms") is not None]

        models = {}
        selected_tiers = {}
        routed_tiers = {}
        matched_by = {}
        matched_rules = {}
        feature_counts = {}
        fallback_reasons = {}
        tier_score_totals = {}
        schema_versions = {}
        task_types = {}
        passthrough_requests = 0
        streaming_requests = 0
        feature_snapshot_count = 0
        selected_tier_count = 0
        observability_only_count = 0
        for e in entries:
            m = e.get("routed_model", "unknown")
            if m not in models:
                models[m] = {"count": 0, "errors": 0, "total_latency": 0, "total_ttft": 0, "ttft_samples": 0}
            models[m]["count"] += 1
            if e.get("status") != 200:
                models[m]["errors"] += 1
            if e.get("latency_ms") is not None:
                models[m]["total_latency"] += e["latency_ms"]
            if e.get("ttft_ms") is not None:
                models[m]["total_ttft"] += e["ttft_ms"]
                models[m]["ttft_samples"] += 1

            if e.get("matched_by") == "passthrough":
                passthrough_requests += 1
            if e.get("is_stream"):
                streaming_requests += 1
            if e.get("feature_values"):
                feature_snapshot_count += 1
            if e.get("selected_tier"):
                selected_tier_count += 1
            if e.get("observability_only"):
                observability_only_count += 1

            selected_tier = e.get("selected_tier")
            if selected_tier:
                selected_tiers[selected_tier] = selected_tiers.get(selected_tier, 0) + 1

            routed_tier = e.get("routed_tier")
            if routed_tier:
                routed_tiers[routed_tier] = routed_tiers.get(routed_tier, 0) + 1

            matched_by_value = e.get("matched_by")
            if matched_by_value:
                matched_by[matched_by_value] = matched_by.get(matched_by_value, 0) + 1

            matched_rule = e.get("matched_rule")
            if matched_rule:
                matched_rules[matched_rule] = matched_rules.get(matched_rule, 0) + 1

            schema_version = str(e.get("log_schema_version", "legacy"))
            schema_versions[schema_version] = schema_versions.get(schema_version, 0) + 1

            task_type = e.get("task_type")
            if task_type:
                task_types[task_type] = task_types.get(task_type, 0) + 1

            for feature in e.get("detected_features", []):
                feature_counts[feature] = feature_counts.get(feature, 0) + 1

            fallback_reason = e.get("fallback_reason")
            if fallback_reason:
                fallback_reasons[fallback_reason] = fallback_reasons.get(fallback_reason, 0) + 1

            for tier_name, score in (e.get("tier_scores") or {}).items():
                tier_score_totals.setdefault(tier_name, []).append(score)

        for m in models:
            c = models[m]["count"]
            models[m]["avg_latency_ms"] = round(models[m]["total_latency"] / c, 1) if c else 0
            ttft_samples = models[m]["ttft_samples"]
            models[m]["avg_ttft_ms"] = round(models[m]["total_ttft"] / ttft_samples, 1) if ttft_samples else None

        avg_tier_scores = {
            tier_name: round(sum(scores) / len(scores), 2)
            for tier_name, scores in tier_score_totals.items()
            if scores
        }

        return {
            "total": total,
            "errors": errors,
            "error_rate": round(errors / total * 100, 1) if total else 0,
            "fallbacks": fallbacks,
            "fallback_rate": round(fallbacks / total * 100, 1) if total else 0,
            "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else None,
            "avg_ttft_ms": round(sum(ttfts) / len(ttfts), 1) if ttfts else None,
            "models": models,
            "selected_tiers": selected_tiers,
            "routed_tiers": routed_tiers,
            "matched_by": matched_by,
            "matched_rules": matched_rules,
            "feature_counts": feature_counts,
            "fallback_reasons": fallback_reasons,
            "avg_tier_scores": avg_tier_scores,
            "schema_versions": schema_versions,
            "task_types": task_types,
            "passthrough_requests": passthrough_requests,
            "streaming_requests": streaming_requests,
            "feature_snapshot_count": feature_snapshot_count,
            "selected_tier_count": selected_tier_count,
            "observability_only_count": observability_only_count,
        }

    async def _flush_loop(self):
        """Background coroutine: periodically flush queue to file."""
        while self._running:
            try:
                batch = []
                try:
                    # Wait for first item
                    item = await asyncio.wait_for(self._queue.get(), timeout=self.flush_interval)
                    batch.append(item)
                except asyncio.TimeoutError:
                    continue

                # Drain up to flush_batch more items
                while len(batch) < self.flush_batch:
                    try:
                        item = self._queue.get_nowait()
                        batch.append(item)
                    except asyncio.QueueEmpty:
                        break

                self._write_batch(batch)

            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"Log flush error: {e}")
                await asyncio.sleep(1)

    async def _flush_remaining(self):
        """Flush all remaining entries in queue."""
        batch = []
        while not self._queue.empty():
            try:
                batch.append(self._queue.get_nowait())
            except asyncio.QueueEmpty:
                break
        if batch:
            self._write_batch(batch)

    def _write_batch(self, entries: list[dict]):
        """Append entries to today's JSONL file."""
        if not entries:
            return
        path = self._today_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        lines = [json.dumps(e, ensure_ascii=False) for e in entries]
        with open(path, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    def _today_file(self) -> Path:
        """Return today's JSONL file path."""
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return self.log_dir / f"requests-{date_str}.jsonl"

    def _read_all_entries(self) -> list[dict]:
        entries = []
        for path in sorted(self.log_dir.glob("requests-*.jsonl")):
            entries.extend(self._read_entries_from_file(path))
        return entries

    def _read_recent_entries(self, hours: int = 24) -> list[dict]:
        """Read entries from log files within the last N hours."""
        entries = []
        if not self.log_dir.exists():
            return entries
        cutoff = datetime.now(timezone.utc).timestamp() - hours * 3600
        for path in sorted(self.log_dir.glob("requests-*.jsonl")):
            for entry in self._read_entries_from_file(path):
                ts = entry.get("timestamp", "")
                if ts:
                    try:
                        entry_time = datetime.fromisoformat(ts).timestamp()
                        if entry_time >= cutoff:
                            entries.append(entry)
                    except (ValueError, OSError):
                        entries.append(entry)
                else:
                    entries.append(entry)
        return entries

    @staticmethod
    def _read_entries_from_file(path: Path) -> list[dict]:
        entries = []
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            return entries
        for line in text.split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return entries
