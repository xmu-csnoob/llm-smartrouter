"""Reporter renders EvalResult to table or JSON output."""

from __future__ import annotations

import json
from typing import Any

try:
    from rich.console import Console
    from rich.table import Table

    _RICH_AVAILABLE = True
except ImportError:
    _RICH_AVAILABLE = False

from .schemas import EvalResult


def render_json(result: EvalResult, fp=None) -> str:
    """Render EvalResult as JSON to a file-like object or string."""
    d = result.to_dict()
    s = json.dumps(d, indent=2, ensure_ascii=False)
    if fp is not None:
        fp.write(s)
    return s


def render_table(result: EvalResult) -> str:
    """Render EvalResult as human-readable text tables."""
    if _RICH_AVAILABLE:
        return _render_table_rich(result)
    return _render_table_plain(result)


def _render_table_rich(result: EvalResult) -> str:
    console = Console(file=open("/dev/stdout", "w"), force_terminal=False)
    out_lines: list[str] = []

    def print(*args, **kwargs):
        import io

        buf = io.StringIO()
        c = Console(file=buf, force_terminal=False)
        c.print(*args, **kwargs)
        out_lines.append(buf.getvalue().rstrip())

    m = result.metadata
    sm = result.summary

    print(f"[bold cyan]=== Evaluation Report ===[/bold cyan]")
    print(f"  log_file        : {m.log_file}")
    print(f"  config          : {m.config_path}")
    print(f"  replay_mode     : {m.replay_mode.value}")
    print(f"  total_loaded    : {m.total_loaded}")
    print(f"  total_evaluated : {m.total_evaluated}")
    print(f"  filtered_out    : {m.filtered_out}")
    print(f"  eval_time       : {m.evaluation_time_seconds:.3f}s")

    # --- Replay Metrics ---
    print()
    print("[bold yellow]--- Replay Metrics ---[/bold yellow]")
    rm = sm.replay_metrics
    print(f"  total_requests: {rm.total_requests}")

    t = Table(show_header=True, header_style="bold", box=None)
    t.add_column("tier")
    t.add_column("count")
    t.add_column("%")
    for tier, info in rm.tier_distribution.items():
        t.add_row(tier, str(info["count"]), str(info["percentage"]))
    buf = _table_to_str(t)
    print(buf)

    if rm.task_type_distribution:
        print("  task_type distribution:")
        for tt, info in rm.task_type_distribution.items():
            print(f"    {tt}: {info['count']} ({info['percentage']}%)")

    # --- Logged Runtime Metrics ---
    print()
    print("[bold yellow]--- Logged Runtime Metrics ---[/bold yellow]")
    lm = sm.logged_runtime_metrics
    if lm.latency_avg_ms is not None:
        print(f"  latency_avg : {lm.latency_avg_ms}ms")
    if lm.latency_p50_ms is not None:
        print(f"  latency_p50  : {lm.latency_p50_ms}ms")
    if lm.latency_p95_ms is not None:
        print(f"  latency_p95  : {lm.latency_p95_ms}ms")
    if lm.ttft_avg_ms is not None:
        print(f"  ttft_avg     : {lm.ttft_avg_ms}ms")
    print(f"  fallback_rate: {lm.fallback_rate:.4f}")
    if lm.avg_estimated_tokens is not None:
        print(f"  avg_tokens   : {lm.avg_estimated_tokens}")

    if lm.tier_distribution:
        print("  logged tier distribution:")
        for tier, info in lm.tier_distribution.items():
            print(f"    {tier}: {info['count']} ({info['percentage']}%)")

    if lm.model_distribution:
        print("  logged model distribution (top 10):")
        for model, info in list(lm.model_distribution.items())[:10]:
            print(f"    {model}: {info['count']} ({info['percentage']}%)")

    # --- Comparison ---
    print()
    print("[bold yellow]--- Replay vs Logged Comparison ---[/bold yellow]")
    cv = sm.replay_vs_logged_comparison
    print(f"  tier_agreement_rate: {cv.tier_agreement_rate:.4f}")
    if cv.tier_change_counts:
        print("  tier_change_counts:")
        for k, v in cv.tier_change_counts.items():
            print(f"    {k}: {v}")
    if cv.top_changed_tiers:
        print("  top_changed_tiers:")
        for item in cv.top_changed_tiers:
            print(f"    {item['from']} → {item['to']}: {item['count']}")
    print(f"  sampled_changed_records: {len(cv.sampled_changed_records)}")

    return "\n".join(out_lines)


def _table_to_str(table: "Table") -> str:
    """Render a Rich Table to a string without ANSI (for plain fallback)."""
    from rich.text import Text
    import io

    buf = io.StringIO()
    c = Console(file=buf, force_terminal=False)
    c.print(table)
    return buf.getvalue().rstrip()


def _render_table_plain(result: EvalResult) -> str:
    """Plain-text fallback when rich is not available."""
    m = result.metadata
    sm = result.summary
    lines = [
        "=== Evaluation Report ===",
        f"  log_file        : {m.log_file}",
        f"  config          : {m.config_path}",
        f"  replay_mode     : {m.replay_mode.value}",
        f"  total_loaded    : {m.total_loaded}",
        f"  total_evaluated : {m.total_evaluated}",
        f"  filtered_out    : {m.filtered_out}",
        f"  eval_time       : {m.evaluation_time_seconds:.3f}s",
        "",
        "--- Replay Metrics ---",
        f"  total_requests: {sm.replay_metrics.total_requests}",
    ]

    for tier, info in sm.replay_metrics.tier_distribution.items():
        lines.append(f"    {tier}: {info['count']} ({info['percentage']}%)")

    lm = sm.logged_runtime_metrics
    lines += [
        "",
        "--- Logged Runtime Metrics ---",
        f"  latency_avg: {lm.latency_avg_ms}",
        f"  latency_p50: {lm.latency_p50_ms}",
        f"  latency_p95: {lm.latency_p95_ms}",
        f"  ttft_avg: {lm.ttft_avg_ms}",
        f"  fallback_rate: {lm.fallback_rate:.4f}",
    ]

    cv = sm.replay_vs_logged_comparison
    lines += [
        "",
        "--- Replay vs Logged Comparison ---",
        f"  tier_agreement_rate: {cv.tier_agreement_rate:.4f}",
    ]
    for k, v in cv.tier_change_counts.items():
        lines.append(f"    {k}: {v}")

    return "\n".join(lines)
