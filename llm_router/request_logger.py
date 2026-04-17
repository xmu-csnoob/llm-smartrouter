"""Request logger — async queue + background flush to daily JSONL files."""

import asyncio
import copy
import json
import logging
import shutil
import threading
import time
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
        self.archive_dir_name = config.get("archive_dir", "archive")
        self.auto_archive_count = config.get("auto_archive_count", 10000)
        self.auto_archive_days = config.get("auto_archive_days", 7)
        self._queue: asyncio.Queue | None = None
        self._task: asyncio.Task | None = None
        self._running = False
        self._stats_cache: dict | None = None
        self._stats_cache_time: float = 0
        self._stats_cache_ttl: float = 30.0
        self._stats_cache_lock: threading.Lock = threading.Lock()

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
        self._queue.put_nowait(copy.deepcopy(entry))

    def archive_logs(self) -> dict:
        """Move all current log files to the archive directory.

        Returns:
            dict: {"archived": [filenames], "skipped": [filenames], "total_archived": N}
        """
        if not self.enabled:
            return {"archived": [], "skipped": [], "total_archived": 0}

        archive_dir = self.log_dir / self.archive_dir_name
        archive_dir.mkdir(parents=True, exist_ok=True)

        archived = []
        skipped = []
        for path in sorted(self.log_dir.glob("requests-*.jsonl")):
            if archive_dir in path.parents or path.parent == archive_dir:
                continue
            dest = archive_dir / path.name
            if dest.exists():
                skipped.append(path.name)
                continue
            shutil.move(str(path), str(dest))
            archived.append(path.name)

        self._invalidate_stats_cache()
        return {
            "archived": archived,
            "skipped": skipped,
            "total_archived": len(archived),
        }

    def should_auto_archive(self) -> tuple[bool, str]:
        """Check if auto-archive conditions are met.

        Returns:
            tuple: (should_archive, reason)
        """
        archive_dir = self.log_dir / self.archive_dir_name
        jsonl_files = [
            p for p in sorted(self.log_dir.glob("requests-*.jsonl"))
            if archive_dir not in p.parents and p.parent != archive_dir
        ]
        now = datetime.now(timezone.utc)

        # Age-based trigger: archive files older than auto_archive_days
        for path in jsonl_files:
            try:
                # Filename pattern: requests-YYYY-MM-DD.jsonl
                date_str = path.stem.removeprefix("requests-")
                file_date = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                age_days = (now - file_date).days
                if age_days >= self.auto_archive_days:
                    return True, f"file {path.name} is {age_days} days old >= threshold {self.auto_archive_days}"
            except ValueError:
                continue

        # Count-based trigger: estimate total entries across all files
        # Since _write_batch appends to one file per day, count lines across files
        total_entries = 0
        for path in jsonl_files:
            try:
                with open(path, encoding="utf-8") as f:
                    total_entries += sum(1 for line in f if line.strip())
            except OSError:
                continue
        file_count = len(jsonl_files)
        entry_threshold = max(self.auto_archive_count, 1)
        if total_entries >= entry_threshold:
            return True, f"total entries {total_entries} >= threshold {entry_threshold}"

        return False, ""

    def _auto_archive_if_needed(self):
        """Check and perform auto-archive if conditions are met."""
        if not self.enabled:
            return
        should, reason = self.should_auto_archive()
        if should:
            logger.info(f"Auto-archive triggered: {reason}")
            result = self.archive_logs()
            logger.info(f"Auto-archived {result['total_archived']} files")
            self._invalidate_stats_cache()

    def _iter_entries_from_file(self, path: Path):
        """Generator: yield parsed entries from a single file without loading all into memory."""
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        yield json.loads(line)
                    except json.JSONDecodeError:
                        continue
        except OSError:
            return

    def _iter_entries_from_file_reversed(self, path: Path, model: str | None = None):
        """Generator: yield parsed entries from a single file in reverse order (newest first)."""
        try:
            with open(path, "r", encoding="utf-8") as f:
                lines = f.readlines()
            for line in reversed(lines):
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    if model and entry.get("routed_model") != model:
                        continue
                    yield entry
                except json.JSONDecodeError:
                    continue
        except OSError:
            return

    def _count_entries_in_file(self, path: Path, model: str | None = None) -> int:
        """Count all matching entries in a file (for accurate total before pagination)."""
        count = 0
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                        if model and entry.get("routed_model") != model:
                            continue
                        count += 1
                    except json.JSONDecodeError:
                        continue
        except OSError:
            pass
        return count

    def _iter_all_entries_newest_first(self, model: str | None = None):
        """Generator: yield entries from newest file to oldest, newest entry first."""
        archive_dir = self.log_dir / self.archive_dir_name
        # Sort oldest-first so we encounter newest entries LAST within each file's reversed read
        all_files = sorted(self.log_dir.glob("requests-*.jsonl"))
        for path in reversed(all_files):
            if archive_dir in path.parents or path.parent == archive_dir:
                continue
            for entry in self._iter_entries_from_file_reversed(path, model=model):
                yield entry

    def get_recent(self, offset: int = 0, limit: int = 50, model: str | None = None) -> dict:
        """Read paginated entries from log files using streaming (no full-file load or sort).

        Returns:
            dict: { "entries": [...], "total": N, "offset": offset, "limit": limit }
        """
        if not self.enabled:
            return {"entries": [], "total": 0, "offset": offset, "limit": limit}

        if not self.log_dir.exists():
            return {"entries": [], "total": 0, "offset": offset, "limit": limit}

        # Pass 1: accurate total count
        archive_dir = self.log_dir / self.archive_dir_name
        all_files = sorted(self.log_dir.glob("requests-*.jsonl"))
        total = 0
        for path in all_files:
            if archive_dir in path.parents or path.parent == archive_dir:
                continue
            total += self._count_entries_in_file(path, model=model)

        # Pass 2: collect page entries (bounded iteration, stops early)
        entries = []
        skipped = 0
        for entry in self._iter_all_entries_newest_first(model=model):
            if skipped < offset:
                skipped += 1
                continue
            entries.append(entry)
            if len(entries) >= limit:
                break

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

    def _invalidate_stats_cache(self):
        """Invalidate the stats cache."""
        with self._stats_cache_lock:
            self._stats_cache = None

    def get_stats(self, hours: int = 24) -> dict:
        """Aggregate stats from recent log files with TTL cache."""
        if not self.enabled:
            return {}

        now = time.monotonic()
        with self._stats_cache_lock:
            if (
                self._stats_cache is not None
                and now - self._stats_cache_time < self._stats_cache_ttl
            ):
                return self._stats_cache

        # Compute stats (expensive)
        result = self._compute_stats(hours)

        with self._stats_cache_lock:
            self._stats_cache = result
            self._stats_cache_time = now
        return result

    def _compute_stats(self, hours: int = 24) -> dict:
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
                "routing_policy_versions": {},
                "passthrough_requests": 0,
                "streaming_requests": 0,
                "feature_snapshot_count": 0,
                "selected_tier_count": 0,
                "observability_only_count": 0,
                "intent_distribution": {},
                "difficulty_distribution": {},
                "shadow_policy_mode_distribution": {},
                "shadow_policy_candidate_tier_distribution": {},
                "shadow_policy_propensity_sum": 0,
                "shadow_policy_propensity_count": 0,
                "shadow_policy_forced_lower_tier_count": 0,
                "shadow_policy_exclusion_reasons": {},
                "shadow_policy_hard_exclusion_counts": {},
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
        routing_policy_versions = {}
        passthrough_requests = 0
        streaming_requests = 0
        feature_snapshot_count = 0
        selected_tier_count = 0
        observability_only_count = 0
        intent_distribution = {}
        difficulty_distribution = {}
        shadow_policy_mode_distribution = {}
        shadow_policy_candidate_tier_distribution = {}
        shadow_policy_propensity_sum = 0.0
        shadow_policy_propensity_count = 0
        shadow_policy_forced_lower_tier_count = 0
        shadow_policy_exclusion_reasons = {}
        shadow_policy_hard_exclusion_counts = {}
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

            routing_policy_version = e.get("routing_policy_version", "unknown")
            routing_policy_versions[routing_policy_version] = routing_policy_versions.get(routing_policy_version, 0) + 1

            sem = e.get("semantic_features") or {}
            intent_val = sem.get("intent")
            if intent_val:
                intent_distribution[intent_val] = intent_distribution.get(intent_val, 0) + 1
            difficulty_val = sem.get("difficulty")
            if difficulty_val:
                difficulty_distribution[difficulty_val] = difficulty_distribution.get(difficulty_val, 0) + 1

            for feature in e.get("detected_features", []):
                feature_counts[feature] = feature_counts.get(feature, 0) + 1

            fallback_reason = e.get("fallback_reason")
            if fallback_reason:
                fallback_reasons[fallback_reason] = fallback_reasons.get(fallback_reason, 0) + 1

            for tier_name, score in (e.get("tier_scores") or {}).items():
                tier_score_totals.setdefault(tier_name, []).append(score)

            # Shadow policy aggregation
            sp = e.get("shadow_policy_decision") or {}
            sp_mode = sp.get("mode", "off")
            if sp_mode:
                shadow_policy_mode_distribution[sp_mode] = shadow_policy_mode_distribution.get(sp_mode, 0) + 1
            if sp_mode != "off":
                propensity = sp.get("propensity")
                if propensity is not None:
                    shadow_policy_propensity_sum += propensity
                    shadow_policy_propensity_count += 1
            if sp_mode == "forced_lower_tier":
                shadow_policy_forced_lower_tier_count += 1
            candidate_tier = sp.get("candidate_tier")
            if candidate_tier:
                shadow_policy_candidate_tier_distribution[candidate_tier] = shadow_policy_candidate_tier_distribution.get(candidate_tier, 0) + 1
            exclusion_reason = sp.get("exclusion_reason")
            if exclusion_reason:
                shadow_policy_exclusion_reasons[exclusion_reason] = shadow_policy_exclusion_reasons.get(exclusion_reason, 0) + 1
            for hard_excl in sp.get("hard_exclusions_triggered") or []:
                shadow_policy_hard_exclusion_counts[hard_excl] = shadow_policy_hard_exclusion_counts.get(hard_excl, 0) + 1

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
            "routing_policy_versions": routing_policy_versions,
            "passthrough_requests": passthrough_requests,
            "streaming_requests": streaming_requests,
            "feature_snapshot_count": feature_snapshot_count,
            "selected_tier_count": selected_tier_count,
            "observability_only_count": observability_only_count,
            "intent_distribution": intent_distribution,
            "difficulty_distribution": difficulty_distribution,
            "shadow_policy_mode_distribution": shadow_policy_mode_distribution,
            "shadow_policy_candidate_tier_distribution": shadow_policy_candidate_tier_distribution,
            "shadow_policy_avg_propensity": round(shadow_policy_propensity_sum / shadow_policy_propensity_count, 4) if shadow_policy_propensity_count else None,
            "shadow_policy_forced_lower_tier_count": shadow_policy_forced_lower_tier_count,
            "shadow_policy_exclusion_reasons": shadow_policy_exclusion_reasons,
            "shadow_policy_hard_exclusion_counts": shadow_policy_hard_exclusion_counts,
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
                self._invalidate_stats_cache()
                self._auto_archive_if_needed()

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
        archive_dir = self.log_dir / self.archive_dir_name
        for path in sorted(self.log_dir.glob("requests-*.jsonl")):
            if archive_dir in path.parents or path.parent == archive_dir:
                continue
            entries.extend(self._read_entries_from_file(path))
        return entries

    def _read_recent_entries(self, hours: int = 24) -> list[dict]:
        """Read entries from log files within the last N hours."""
        entries = []
        if not self.log_dir.exists():
            return entries
        archive_dir = self.log_dir / self.archive_dir_name
        cutoff = datetime.now(timezone.utc).timestamp() - hours * 3600
        for path in sorted(self.log_dir.glob("requests-*.jsonl")):
            if archive_dir in path.parents or path.parent == archive_dir:
                continue
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
