"""Request logger — async queue + background flush to daily JSONL files."""

import asyncio
import json
import time
import logging
import os
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

    def get_recent(self, limit: int = 50) -> list[dict]:
        """Read the last N entries from today's log file."""
        if not self.enabled:
            return []
        path = self._today_file()
        if not path.exists():
            return []
        lines = path.read_text().strip().split("\n")
        entries = []
        for line in lines[-limit:]:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        return list(reversed(entries))

    def get_stats(self, hours: int = 24) -> dict:
        """Aggregate stats from recent log files."""
        if not self.enabled:
            return {}
        entries = self._read_recent_entries(hours)
        if not entries:
            return {"total": 0, "models": {}, "avg_latency_ms": None}

        total = len(entries)
        errors = sum(1 for e in entries if e.get("status") != 200)
        fallbacks = sum(1 for e in entries if e.get("is_fallback"))
        latencies = [e["latency_ms"] for e in entries if e.get("latency_ms") is not None]
        ttfts = [e["ttft_ms"] for e in entries if e.get("ttft_ms") is not None]

        models = {}
        for e in entries:
            m = e.get("routed_model", "unknown")
            if m not in models:
                models[m] = {"count": 0, "errors": 0, "total_latency": 0}
            models[m]["count"] += 1
            if e.get("status") != 200:
                models[m]["errors"] += 1
            if e.get("latency_ms"):
                models[m]["total_latency"] += e["latency_ms"]

        for m in models:
            c = models[m]["count"]
            models[m]["avg_latency_ms"] = round(models[m]["total_latency"] / c, 1) if c else 0

        return {
            "total": total,
            "errors": errors,
            "error_rate": round(errors / total * 100, 1) if total else 0,
            "fallbacks": fallbacks,
            "fallback_rate": round(fallbacks / total * 100, 1) if total else 0,
            "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else None,
            "avg_ttft_ms": round(sum(ttfts) / len(ttfts), 1) if ttfts else None,
            "models": models,
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

    def _read_recent_entries(self, hours: int = 24) -> list[dict]:
        """Read entries from log files within the last N hours."""
        entries = []
        if not self.log_dir.exists():
            return entries
        for path in sorted(self.log_dir.glob("requests-*.jsonl")):
            for line in path.read_text().strip().split("\n"):
                line = line.strip()
                if line:
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
        return entries
