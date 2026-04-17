#!/usr/bin/env python3
"""Concurrency test to verify multi-key setup improves throughput.

This script sends real concurrent requests to the running router using
benchmark test cases, measuring success rates and 429 errors.
"""

from __future__ import annotations

import argparse
import asyncio
import time
from collections import defaultdict
from datetime import datetime
from typing import Any

import httpx

from tests.routing_benchmark_cases import build_benchmark_cases


ROUTER_URL = "http://127.0.0.1:8002/v1/messages"
HEADERS = {
    "Content-Type": "application/json",
    "x-api-key": "dummy-key",  # Router doesn't validate this
}


async def send_request(
    client: httpx.AsyncClient,
    case: dict[str, Any],
    request_id: str,
) -> dict[str, Any]:
    """Send a single request to the router."""
    start_time = time.time()
    result = {
        "request_id": request_id,
        "case_id": case["id"],
        "expected_tier": case["expected_tier"],
        "round": case["round"],
        "start_time": start_time,
    }

    try:
        response = await client.post(
            ROUTER_URL,
            json=case["request"],
            headers=HEADERS,
            timeout=120.0,
        )
        elapsed = time.time() - start_time

        result.update({
            "status_code": response.status_code,
            "elapsed_ms": round(elapsed * 1000, 1),
            "success": response.status_code == 200,
            "error_code": None,
            "error_message": None,
        })

        # Parse response for error details
        if response.status_code != 200:
            try:
                error_data = response.json()
                detail = error_data.get("detail", "")
                error_body = error_data.get("error", {})
                result["error_message"] = detail[:200] if detail else response.text[:200]
                # Detect 429 rate limit from upstream (comes as 502 "All models failed: 429: ...")
                if "429" in str(detail) or "1302" in str(detail) or "速率限制" in str(detail):
                    result["error_code"] = 1302  # Rate limit code
                    result["is_rate_limited"] = True
                else:
                    result["error_code"] = error_body.get("code") or response.status_code
                    result["is_rate_limited"] = False
            except Exception:
                result["error_message"] = response.text[:200]
                result["is_rate_limited"] = False

    except asyncio.TimeoutError:
        result.update({
            "status_code": None,
            "elapsed_ms": round((time.time() - start_time) * 1000, 1),
            "success": False,
            "error_code": "timeout",
            "error_message": "Request timed out",
            "is_rate_limited": False,
        })
    except Exception as e:
        elapsed = time.time() - start_time
        result.update({
            "status_code": None,
            "elapsed_ms": round(elapsed * 1000, 1),
            "success": False,
            "error_code": "exception",
            "error_message": str(e)[:200],
            "is_rate_limited": False,
        })

    return result


async def run_concurrency_test(
    concurrency: int,
    num_requests: int,
    cases: list[dict[str, Any]],
) -> dict[str, Any]:
    """Run a batch of requests with given concurrency level."""
    print(f"\n{'='*60}")
    print(f"Testing: concurrency={concurrency}, requests={num_requests}")
    print(f"{'='*60}")

    start_time = time.time()
    results: list[dict[str, Any]] = []
    selected_cases = cases[:num_requests]

    async with httpx.AsyncClient(
        limits=httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency),
        timeout=httpx.Timeout(120.0),
    ) as client:
        # Create tasks in batches to control concurrency
        semaphore = asyncio.Semaphore(concurrency)

        async def bounded_request(idx: int, case: dict[str, Any]) -> dict[str, Any]:
            async with semaphore:
                return await send_request(client, case, f"req-{idx:04d}")

        tasks = [
            bounded_request(idx, case)
            for idx, case in enumerate(selected_cases)
        ]
        results = await asyncio.gather(*tasks)

    total_elapsed = time.time() - start_time

    # Analyze results
    success_count = sum(1 for r in results if r["success"])
    rate_limited = sum(1 for r in results if r.get("is_rate_limited"))
    other_errors = len(results) - success_count - rate_limited

    # Latency stats for successful requests
    successful_latencies = [r["elapsed_ms"] for r in results if r["success"]]
    avg_latency = round(sum(successful_latencies) / len(successful_latencies), 1) if successful_latencies else 0
    p50_latency = round(sorted(successful_latencies)[len(successful_latencies) // 2], 1) if successful_latencies else 0
    p95_latency = round(sorted(successful_latencies)[int(len(successful_latencies) * 0.95)], 1) if len(successful_latencies) >= 20 else 0

    # Error breakdown
    error_by_code: dict[str, int] = defaultdict(int)
    for r in results:
        if r["error_code"]:
            error_by_code[r["error_code"]] += 1

    summary = {
        "concurrency": concurrency,
        "num_requests": num_requests,
        "total_elapsed_s": round(total_elapsed, 2),
        "success_count": success_count,
        "success_rate": round(success_count / num_requests * 100, 1),
        "rate_limited_count": rate_limited,
        "rate_limited_rate": round(rate_limited / num_requests * 100, 1),
        "other_errors": other_errors,
        "avg_latency_ms": avg_latency,
        "p50_latency_ms": p50_latency,
        "p95_latency_ms": p95_latency,
        "throughput_req_per_s": round(num_requests / total_elapsed, 2),
        "error_by_code": dict(error_by_code),
        "results": results,
    }

    return summary


def print_summary(summary: dict[str, Any]) -> None:
    """Print test summary."""
    print(f"\nResults (concurrency={summary['concurrency']}):")
    print(f"  Total time: {summary['total_elapsed_s']}s")
    print(f"  Success rate: {summary['success_rate']}% ({summary['success_count']}/{summary['num_requests']})")
    print(f"  Rate limited (429): {summary['rate_limited_rate']}% ({summary['rate_limited_count']}/{summary['num_requests']})")
    print(f"  Other errors: {summary['other_errors']}")

    if summary["success_count"] > 0:
        print(f"\n  Latency (successful requests):")
        print(f"    Average: {summary['avg_latency_ms']}ms")
        print(f"    P50: {summary['p50_latency_ms']}ms")
        print(f"    P95: {summary['p95_latency_ms']}ms")

    print(f"  Throughput: {summary['throughput_req_per_s']} req/s")

    if summary["error_by_code"]:
        print(f"\n  Error breakdown:")
        for code, count in sorted(summary["error_by_code"].items(), key=lambda x: -x[1]):
            print(f"    Code {code}: {count}")


async def main() -> int:
    global ROUTER_URL

    parser = argparse.ArgumentParser(description="Test router concurrency with real requests.")
    parser.add_argument(
        "--url",
        default=ROUTER_URL,
        help=f"Router URL (default: {ROUTER_URL})",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=10,
        help="Number of concurrent requests (default: 10)",
    )
    parser.add_argument(
        "--requests",
        type=int,
        default=50,
        help="Total number of requests to send (default: 50)",
    )
    parser.add_argument(
        "--ramp-up",
        action="store_true",
        help="Run ramp-up test with increasing concurrency levels",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON",
    )
    args = parser.parse_args()

    ROUTER_URL = args.url

    print(f"Router URL: {ROUTER_URL}")
    print(f"Loading benchmark cases...")
    cases = build_benchmark_cases()
    print(f"Loaded {len(cases)} benchmark cases")

    num_requests = min(args.requests, len(cases))

    if args.ramp_up:
        # Ramp-up test: 5, 10, 15, 20 concurrency
        concurrency_levels = [5, 10, 15, 20]
        all_summaries: list[dict[str, Any]] = []

        for concurrency in concurrency_levels:
            summary = await run_concurrency_test(concurrency, num_requests, cases)
            all_summaries.append(summary)
            print_summary(summary)

            # Brief pause between tests
            if concurrency != concurrency_levels[-1]:
                print(f"\nWaiting 3s before next test...")
                await asyncio.sleep(3)

        if args.json:
            import json
            # Strip full results from JSON output for readability
            json_output = [
                {k: v for k, v in s.items() if k != "results"}
                for s in all_summaries
            ]
            print("\n" + json.dumps(json_output, ensure_ascii=False, indent=2))

    else:
        summary = await run_concurrency_test(args.concurrency, num_requests, cases)
        print_summary(summary)

        if args.json:
            import json
            json_output = {k: v for k, v in summary.items() if k != "results"}
            print("\n" + json.dumps(json_output, ensure_ascii=False, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
