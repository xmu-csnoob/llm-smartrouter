"""FastAPI application — OpenAI-compatible API proxy."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

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
                    consecutive_errors=stat["consecutive_errors"] if stat else 0,
                ))
        return StatusResponse(
            models=model_infos,
            total_requests=sum(s["total_requests"] for s in stats),
        )

    @app.post("/reload")
    async def reload_config():
        try:
            config.load()
            router.config = config
            proxy.config = config
            return {"status": "reloaded"}
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e)})

    @app.get("/api/logs/recent")
    async def recent_logs(limit: int = 50):
        return req_logger.get_recent(limit)

    @app.get("/api/logs/stats")
    async def log_stats(hours: int = 24):
        return req_logger.get_stats(hours)

    # Serve built dashboard static files (must be after API routes)
    dashboard_dir = Path(__file__).parent.parent / "dashboard" / "dist"
    if dashboard_dir.exists():
        app.mount("/", StaticFiles(directory=str(dashboard_dir), html=True), name="dashboard")

    return app
