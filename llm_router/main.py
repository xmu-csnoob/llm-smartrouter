"""FastAPI application — OpenAI-compatible API proxy."""

from collections import Counter
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import RouterConfig
from .latency import LatencyTracker
from .router import Router
from .proxy import StreamProxy
from .request_logger import RequestLogger
from .schemas import ModelInfo, StatusResponse
from .shadow_policy import ShadowPolicy
from .redaction import Redactor

logger = logging.getLogger("llm_router")


def _format_counter(counter: Counter, limit: int | None = None, empty_label: str = "  - none") -> str:
    if not counter:
        return empty_label
    items = counter.most_common(limit)
    return "\n".join(f"  - {key}: {value}" for key, value in items)


def _build_analysis_snapshot(entries: list[dict]) -> dict:
    total = len(entries)
    errors = sum(1 for entry in entries if entry.get("status") != 200)
    fallbacks = sum(1 for entry in entries if entry.get("is_fallback"))
    latencies = [entry["latency_ms"] for entry in entries if entry.get("latency_ms") is not None]
    ttfts = [entry["ttft_ms"] for entry in entries if entry.get("ttft_ms") is not None]

    model_counts = Counter(entry.get("routed_model", "unknown") for entry in entries)
    rule_counts = Counter(entry.get("matched_rule", "unknown") for entry in entries)
    routed_tier_counts = Counter(entry.get("routed_tier") for entry in entries if entry.get("routed_tier"))
    selected_tier_counts = Counter(entry.get("selected_tier") for entry in entries if entry.get("selected_tier"))
    task_type_counts = Counter(entry.get("task_type") for entry in entries if entry.get("task_type"))
    schema_version_counts = Counter(str(entry.get("log_schema_version", "legacy")) for entry in entries)
    feature_counts: Counter = Counter()
    for entry in entries:
        feature_counts.update(entry.get("detected_features", []))

    explicit_passthrough_count = sum(1 for entry in entries if entry.get("matched_by") == "passthrough")
    streaming_count = sum(1 for entry in entries if entry.get("is_stream"))
    feature_snapshot_count = sum(1 for entry in entries if entry.get("feature_values"))
    selected_tier_count = sum(1 for entry in entries if entry.get("selected_tier"))
    observability_only_count = sum(1 for entry in entries if entry.get("observability_only"))

    avg_latency = round(sum(latencies) / len(latencies), 1) if latencies else None
    avg_ttft = round(sum(ttfts) / len(ttfts), 1) if ttfts else None

    high_latency = [entry for entry in entries if avg_latency and entry.get("latency_ms") and entry["latency_ms"] > avg_latency * 2]
    error_entries = [entry for entry in entries if entry.get("status") != 200][:5]
    fallback_entries = [entry for entry in entries if entry.get("is_fallback")][:5]

    outlier_info = ""
    if high_latency:
        outlier_info += f"\nHigh-latency requests ({len(high_latency)}):\n"
        for entry in high_latency[:5]:
            outlier_info += f"  - {entry.get('routed_model')} {entry['latency_ms']}ms (rule: {entry.get('matched_rule')})\n"
    if error_entries:
        outlier_info += "\nError samples:\n"
        for entry in error_entries:
            outlier_info += f"  - {entry.get('routed_model')} status={entry['status']} error={entry.get('error', 'N/A')[:100]}\n"
    if fallback_entries:
        outlier_info += "\nFallback samples:\n"
        for entry in fallback_entries:
            chain = " -> ".join(fallback.get("model", "?") for fallback in entry.get("fallback_chain", []))
            outlier_info += f"  - {entry.get('routed_model')} (chain: {chain})\n"

    return {
        "total": total,
        "errors": errors,
        "error_rate": round(errors / total * 100, 1) if total else 0,
        "fallbacks": fallbacks,
        "fallback_rate": round(fallbacks / total * 100, 1) if total else 0,
        "avg_latency": avg_latency,
        "avg_latency_display": f"{avg_latency}ms" if avg_latency is not None else "N/A",
        "avg_ttft": avg_ttft,
        "avg_ttft_display": f"{avg_ttft}ms" if avg_ttft is not None else "N/A (no streaming samples)",
        "model_summary": _format_counter(model_counts),
        "rule_summary": _format_counter(rule_counts),
        "routed_tier_summary": _format_counter(routed_tier_counts),
        "selected_tier_summary": _format_counter(selected_tier_counts),
        "task_type_summary": _format_counter(task_type_counts),
        "feature_summary": _format_counter(feature_counts, limit=8),
        "schema_version_summary": _format_counter(schema_version_counts),
        "explicit_passthrough_count": explicit_passthrough_count,
        "streaming_count": streaming_count,
        "feature_snapshot_count": feature_snapshot_count,
        "selected_tier_count": selected_tier_count,
        "missing_feature_snapshot_count": total - feature_snapshot_count,
        "missing_selected_tier_count": total - selected_tier_count,
        "observability_only_count": observability_only_count,
        "outlier_info": outlier_info,
    }


def create_app(config: RouterConfig) -> FastAPI:
    req_logger = RequestLogger(config.logging_config)

    # Initialize ML model if enabled
    ml_model = None
    if config.ml_routing_config.get("enabled"):
        from .model_loader import BertTinyRouterModel
        logger.info("Loading ML routing model...")
        try:
            ml_model = BertTinyRouterModel(
                model_name=config.ml_routing_config.get("model_name", "leftfield7/bert-tiny-llm-router"),
                cache_dir=config.ml_routing_config.get("model_cache_dir"),
            )
            logger.info(f"ML routing model loaded: {ml_model.get_model_info()}")
        except Exception as e:
            logger.error(f"Failed to load ML routing model: {e}. ML routing will be disabled.")
            ml_model = None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        req_logger.start()
        app.state.req_logger = req_logger
        yield
        await proxy.client.aclose()
        await req_logger.stop()

    app = FastAPI(title="llm-router", version="0.1.0", lifespan=lifespan)

    tracker = LatencyTracker(config.fallback)
    router = Router(config, tracker, ml_model=ml_model)
    shadow_policy = ShadowPolicy(config.shadow_policy_config)
    redactor = Redactor(config.redaction_config)
    proxy = StreamProxy(config, router, tracker, req_logger, shadow_policy, redactor)

    @app.post("/v1/messages")
    async def anthropic_messages(request: Request):
        body = await request.json()
        client_api_key = request.headers.get("x-api-key")
        return await proxy.forward_anthropic(body, client_api_key=client_api_key)

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
        nonlocal tracker, router, proxy, ml_model, shadow_policy, redactor
        try:
            await proxy.client.aclose()
            config.load()

            # Reload ML model if enabled
            if config.ml_routing_config.get("enabled"):
                from .model_loader import BertTinyRouterModel
                logger.info("Reloading ML routing model...")
                try:
                    ml_model = BertTinyRouterModel(
                        model_name=config.ml_routing_config.get("model_name", "leftfield7/bert-tiny-llm-router"),
                        cache_dir=config.ml_routing_config.get("model_cache_dir"),
                    )
                    logger.info("ML routing model reloaded")
                except Exception as e:
                    logger.error(f"Failed to reload ML routing model: {e}")
                    ml_model = None
            else:
                ml_model = None

            tracker = LatencyTracker(config.fallback)
            router = Router(config, tracker, ml_model=ml_model)
            shadow_policy = ShadowPolicy(config.shadow_policy_config)
            redactor = Redactor(config.redaction_config)
            proxy = StreamProxy(config, router, tracker, req_logger, shadow_policy, redactor)
            return {"status": "reloaded"}
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e)})

    @app.get("/api/logs/recent")
    async def recent_logs(offset: int = 0, limit: int = 50, model: str | None = None):
        return req_logger.get_recent(offset, limit, model=model)

    @app.get("/api/logs/stats")
    async def log_stats(hours: int = 24):
        return req_logger.get_stats(hours)

    @app.get("/api/logs/keys")
    async def key_stats(hours: int = 24):
        """Per-API-key usage breakdown: request count, error rate, latency, model/tier distribution, token usage, cost."""
        return req_logger.get_key_stats(hours)

    @app.post("/api/logs/archive")
    async def archive_logs():
        result = req_logger.archive_logs()
        return result

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
        lang: str = "en"

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

        model_id, provider_cfg, _tier = result
        entries = req_logger.get_entries_for_analysis(request.hours)

        if not entries:
            return JSONResponse(content={"error": "No log entries found for the specified time range"})

        snapshot = _build_analysis_snapshot(entries)

        prompt = f"""You are analyzing LLM router logs for the past {request.hours} hours.

## Summary Statistics
- Total requests: {snapshot['total']}
- Models used:
{snapshot['model_summary']}
- Routed tiers:
{snapshot['routed_tier_summary']}
- Selected tiers:
{snapshot['selected_tier_summary']}
- Task types:
{snapshot['task_type_summary']}
- Routing rules:
{snapshot['rule_summary']}
- Top detected features:
{snapshot['feature_summary']}
- Log schema versions:
{snapshot['schema_version_summary']}
- Explicit passthrough requests: {snapshot['explicit_passthrough_count']}
- Entries with feature snapshots: {snapshot['feature_snapshot_count']} / {snapshot['total']}
- Entries with selected tiers: {snapshot['selected_tier_count']} / {snapshot['total']}
- Observability-only passthrough classifications: {snapshot['observability_only_count']}
- Avg latency: {snapshot['avg_latency_display']}
- Avg TTFT: {snapshot['avg_ttft_display']}
- Error rate: {snapshot['error_rate']}%
- Fallback rate: {snapshot['fallback_rate']}%
{snapshot['outlier_info']}

{"请用中文回答。" if request.lang == "zh" else ""}{"## 请分析以下内容" if request.lang == "zh" else "## Please analyze"}:
1. **{"路由效率" if request.lang == "zh" else "Routing efficiency"}** — {"请求是否被路由到了合适的模型？" if request.lang == "zh" else "are requests reaching appropriate models?"}
2. **{"层级分类质量" if request.lang == "zh" else "Tier classification quality"}** — {"所选层级是否合理？" if request.lang == "zh" else "are the selected tiers reasonable?"}
3. **{"降级模式" if request.lang == "zh" else "Fallback patterns"}** — {"何时以及为何发生降级？" if request.lang == "zh" else "when and why do fallbacks occur?"}
4. **{"延迟异常" if request.lang == "zh" else "Latency outliers"}** — {"是否有异常延迟？" if request.lang == "zh" else "any unusual delays?"}
5. **{"优化建议" if request.lang == "zh" else "Recommendations"}** — {"哪些方面可以优化？" if request.lang == "zh" else "what to optimize?"}

{"重要约束" if request.lang == "zh" else "Important constraints"}:
- {"如果某个字段缺失，将其描述为缺失或遗留字段，而不是\"未知\"" if request.lang == "zh" else 'If a field is missing, describe it as missing or legacy rather than "unknown".'}
- {"不要仅从缺失的 selected_tier 推断出层级映射/配置错误。" if request.lang == "zh" else "Do not infer a tier-mapping/configuration bug from missing `selected_tier` alone."}
- {"TTFT 仅适用于流式请求；如果没有流式请求样本，请将 TTFT 视为不可用而非可疑。" if request.lang == "zh" else "TTFT only applies to streaming requests; if there are no streaming samples, treat TTFT as unavailable rather than suspicious."}

{"简洁、可操作，使用 Markdown 格式。" if request.lang == "zh" else "Be concise and actionable. Use markdown formatting."}"""

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

    # Serve dashboard — dev mode proxies to Vite, prod serves static files
    dev_mode = os.environ.get("LLM_ROUTER_DEV") == "1"
    vite_port = int(os.environ.get("VITE_PORT", "5173"))

    if dev_mode:
        vite_base = f"http://localhost:{vite_port}"

        @app.middleware("http")
        async def vite_proxy(request: Request, call_next):
            # Let API routes and other registered routes handle themselves
            path = request.url.path
            if path.startswith("/api/") or path.startswith("/v1/") or path in ("/health", "/status", "/reload"):
                return await call_next(request)

            # Proxy everything else to Vite dev server (bypass system proxy)
            try:
                async with httpx.AsyncClient(trust_env=False, timeout=10.0) as client:
                    url = f"{vite_base}{path}"
                    if request.url.query:
                        url += f"?{request.url.query}"
                    resp = await client.send(
                        client.build_request(
                            request.method,
                            url,
                            headers={k: v for k, v in request.headers.items() if k.lower() != "host"},
                            content=await request.body(),
                        ),
                    )
                    return Response(
                        content=resp.content,
                        status_code=resp.status_code,
                        headers=dict(resp.headers),
                    )
            except httpx.ConnectError:
                return JSONResponse(
                    status_code=502,
                    content={"error": f"Vite dev server not running on {vite_base}. Start it with: cd dashboard && npm run dev"},
                )
    else:
        # Production: serve built static files
        dashboard_dir = Path(__file__).parent.parent / "dashboard" / "dist"
        if dashboard_dir.exists():
            app.mount("/", StaticFiles(directory=str(dashboard_dir), html=True), name="dashboard")

    return app
