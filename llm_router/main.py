"""FastAPI application — OpenAI-compatible API proxy."""

import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import RouterConfig
from .latency import LatencyTracker
from .router import Router
from .proxy import StreamProxy
from .request_logger import RequestLogger
from .schemas import ModelInfo, StatusResponse

logger = logging.getLogger("llm_router")


def create_app(config: RouterConfig) -> FastAPI:
    req_logger = RequestLogger(config.logging_config)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        req_logger.start()
        app.state.req_logger = req_logger
        yield
        await proxy.client.aclose()
        await req_logger.stop()

    app = FastAPI(title="llm-router", version="0.1.0", lifespan=lifespan)

    tracker = LatencyTracker(config.fallback)
    router = Router(config, tracker)
    proxy = StreamProxy(config, router, tracker, req_logger)

    @app.post("/v1/messages")
    async def anthropic_messages(request: Request):
        body = await request.json()
        return await proxy.forward_anthropic(body)

    @app.get("/v1/models")
    async def list_models():
        models = []
        for tier, model_list in config.models.items():
            for m in model_list:
                models.append({
                    "id": m["id"],
                    "object": "model",
                    "owned_by": m["provider"],
                    "tier": tier,
                })
        return {"object": "list", "data": models}

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/status", response_model=StatusResponse)
    async def status():
        stats = tracker.get_stats()
        model_infos = []
        for tier, model_list in config.models.items():
            for m in model_list:
                stat = next((s for s in stats if s["model_id"] == m["id"]), None)
                model_infos.append(ModelInfo(
                    id=m["id"],
                    provider=m["provider"],
                    tier=tier,
                    available=tracker.is_available(m["id"]),
                    avg_latency_ms=stat["avg_latency_ms"] if stat else None,
                    avg_ttft_ms=stat["avg_ttft_ms"] if stat else None,
                    consecutive_errors=stat["consecutive_errors"] if stat else 0,
                ))
        return StatusResponse(
            models=model_infos,
            total_requests=sum(s["total_requests"] for s in stats),
        )

    @app.post("/reload")
    async def reload_config():
        nonlocal tracker, router, proxy
        try:
            await proxy.client.aclose()
            config.load()
            tracker = LatencyTracker(config.fallback)
            router = Router(config, tracker)
            proxy = StreamProxy(config, router, tracker, req_logger)
            return {"status": "reloaded"}
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e)})

    @app.get("/api/logs/recent")
    async def recent_logs(offset: int = 0, limit: int = 50):
        return req_logger.get_recent(offset, limit)

    @app.get("/api/logs/stats")
    async def log_stats(hours: int = 24):
        return req_logger.get_stats(hours)

    @app.get("/api/logs/replay")
    async def replay_logs(hours: int = 24, limit: int = 100):
        entries = req_logger.get_entries_for_analysis(hours)[:limit]
        replay_entries = []
        for entry in entries:
            replay = router.replay_log_entry(entry)
            if replay is not None:
                replay_entries.append(replay)

        changed = sum(1 for item in replay_entries if item["changed"])
        return {
            "total": len(replay_entries),
            "changed": changed,
            "change_rate": round(changed / len(replay_entries) * 100, 1) if replay_entries else 0,
            "entries": replay_entries,
        }

    # --- LLM Analysis Endpoint ---

    class AnalyzeRequest(BaseModel):
        hours: int = 24

    def _pick_analysis_model() -> tuple[str, dict, str] | None:
        """Pick the cheapest available model for analysis. Returns (model_id, provider_cfg, tier) or None."""
        degr = config.fallback.get("degradation_order", [])
        # Use the last tier (cheapest) for analysis
        for tier in reversed(degr):
            for m in config.models.get(tier, []):
                provider_cfg = config.get_provider(m["provider"])
                if provider_cfg:
                    return m["id"], provider_cfg, tier
        # Fallback: pick any available model
        for tier, models in config.models.items():
            for m in models:
                provider_cfg = config.get_provider(m["provider"])
                if provider_cfg:
                    return m["id"], provider_cfg, tier
        return None

    @app.post("/api/logs/analyze")
    async def analyze_logs(request: AnalyzeRequest):
        result = _pick_analysis_model()
        if not result:
            return JSONResponse(status_code=503, content={"error": "No model available for analysis"})

        model_id, provider_cfg, tier = result
        entries = req_logger.get_entries_for_analysis(request.hours)

        if not entries:
            return JSONResponse(content={"error": "No log entries found for the specified time range"})

        # Build summary statistics
        total = len(entries)
        errors = sum(1 for e in entries if e.get("status") != 200)
        fallbacks = sum(1 for e in entries if e.get("is_fallback"))
        latencies = [e["latency_ms"] for e in entries if e.get("latency_ms") is not None]
        ttfts = [e["ttft_ms"] for e in entries if e.get("ttft_ms") is not None]
        avg_latency = round(sum(latencies) / len(latencies), 1) if latencies else 0
        avg_ttft = round(sum(ttfts) / len(ttfts), 1) if ttfts else 0
        error_rate = round(errors / total * 100, 1) if total else 0
        fallback_rate = round(fallbacks / total * 100, 1) if total else 0

        model_counts = {}
        for e in entries:
            m = e.get("routed_model", "unknown")
            model_counts[m] = model_counts.get(m, 0) + 1
        model_summary = "\n".join(f"  - {m}: {c} requests" for m, c in sorted(model_counts.items(), key=lambda x: -x[1]))

        rule_counts = {}
        for e in entries:
            r = e.get("matched_rule", "unknown")
            rule_counts[r] = rule_counts.get(r, 0) + 1
        rule_summary = "\n".join(f"  - {r}: {c}" for r, c in sorted(rule_counts.items(), key=lambda x: -x[1]))

        selected_tier_counts = {}
        for e in entries:
            selected_tier = e.get("selected_tier", "unknown")
            selected_tier_counts[selected_tier] = selected_tier_counts.get(selected_tier, 0) + 1
        selected_tier_summary = "\n".join(
            f"  - {tier_name}: {count}" for tier_name, count in sorted(selected_tier_counts.items(), key=lambda x: -x[1])
        )

        feature_counts = {}
        for e in entries:
            for feature in e.get("detected_features", []):
                feature_counts[feature] = feature_counts.get(feature, 0) + 1
        feature_summary = "\n".join(
            f"  - {feature}: {count}" for feature, count in sorted(feature_counts.items(), key=lambda x: -x[1])[:8]
        )

        # Find outliers
        high_latency = [e for e in entries if e.get("latency_ms") and e["latency_ms"] > avg_latency * 2]
        error_entries = [e for e in entries if e.get("status") != 200][:5]
        fallback_entries = [e for e in entries if e.get("is_fallback")][:5]

        outlier_info = ""
        if high_latency:
            outlier_info += f"\nHigh-latency requests ({len(high_latency)}):\n"
            for e in high_latency[:5]:
                outlier_info += f"  - {e.get('routed_model')} {e['latency_ms']}ms (rule: {e.get('matched_rule')})\n"
        if error_entries:
            outlier_info += f"\nError samples:\n"
            for e in error_entries:
                outlier_info += f"  - {e.get('routed_model')} status={e['status']} error={e.get('error', 'N/A')[:100]}\n"
        if fallback_entries:
            outlier_info += f"\nFallback samples:\n"
            for e in fallback_entries:
                chain = " -> ".join(f["model"] for f in e.get("fallback_chain", []))
                outlier_info += f"  - {e.get('routed_model')} (chain: {chain})\n"

        prompt = f"""You are analyzing LLM router logs for the past {request.hours} hours.

## Summary Statistics
- Total requests: {total}
- Models used:
{model_summary}
- Selected tiers:
{selected_tier_summary or "  - none"}
- Routing rules:
{rule_summary}
- Top detected features:
{feature_summary or "  - none"}
- Avg latency: {avg_latency}ms
- Avg TTFT: {avg_ttft}ms
- Error rate: {error_rate}%
- Fallback rate: {fallback_rate}%
{outlier_info}

## Please analyze:
1. **Routing efficiency** — are requests reaching appropriate models?
2. **Tier classification quality** — are the selected tiers reasonable?
3. **Fallback patterns** — when and why do fallbacks occur?
4. **Latency outliers** — any unusual delays?
5. **Recommendations** — what to optimize?

Be concise and actionable. Use markdown formatting."""

        # Call the LLM with streaming
        url = provider_cfg["base_url"].rstrip("/") + "/v1/messages"
        headers = {
            "x-api-key": provider_cfg["api_key"],
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        body = {
            "model": model_id,
            "max_tokens": 2048,
            "stream": True,
            "messages": [{"role": "user", "content": prompt}],
        }

        async def generate():
            try:
                async with httpx.AsyncClient() as client:
                    async with client.stream(
                        "POST", url, json=body, headers=headers,
                        timeout=httpx.Timeout(connect=10, read=120, write=10, pool=10),
                    ) as resp:
                        if resp.status_code != 200:
                            error_body = await resp.aread()
                            yield f"data: {json.dumps({'error': error_body.decode()[:500]})}\n\n"
                            yield "data: [DONE]\n\n"
                            return

                        async for line in resp.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            data = line[6:]
                            if data == "[DONE]":
                                yield "data: [DONE]\n\n"
                                return
                            try:
                                parsed = json.loads(data)
                                if parsed.get("type") == "content_block_delta":
                                    text = parsed.get("delta", {}).get("text", "")
                                    if text:
                                        yield f"data: {json.dumps({'text': text})}\n\n"
                            except json.JSONDecodeError:
                                pass
            except Exception as e:
                logger.error(f"Analysis streaming error: {e}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
                yield "data: [DONE]\n\n"

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Analysis-Model": model_id},
        )

    # Serve built dashboard static files (must be after API routes)
    dashboard_dir = Path(__file__).parent.parent / "dashboard" / "dist"
    if dashboard_dir.exists():
        app.mount("/", StaticFiles(directory=str(dashboard_dir), html=True), name="dashboard")

    return app
