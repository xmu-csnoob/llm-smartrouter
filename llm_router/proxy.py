"""Streaming proxy — supports both Anthropic and OpenAI format passthrough."""

import time
import json
import logging
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from .config import RouterConfig
from .router import Router
from .latency import LatencyTracker
from .request_logger import RequestLogger

logger = logging.getLogger("llm_router")


class StreamProxy:
    """Forwards requests to providers with SSE passthrough and fallback."""

    def __init__(self, config: RouterConfig, router: Router, tracker: LatencyTracker, req_logger: RequestLogger):
        self.config = config
        self.router = router
        self.tracker = tracker
        self.req_logger = req_logger
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=300.0, write=10.0, pool=10.0),
            trust_env=False,
        )

    async def forward_anthropic(self, request_body: dict) -> StreamingResponse | JSONResponse:
        """Forward an Anthropic Messages API request."""
        is_stream = request_body.get("stream", False)
        requested_model = request_body.get("model", "auto")
        model_id, provider_cfg, route_info = self.router.route(request_body)
        api_format = provider_cfg.get("api_format", "anthropic")
        model_info = self.config.model_registry.get(model_id, {})
        tier = model_info.get("tier", "unknown")
        logger.info(f"Routing to model={model_id} tier={tier} provider={provider_cfg.get('base_url', '?')} format={api_format}")

        forward_body = {**request_body, "model": model_id}

        # Build log entry base
        request_id = str(uuid.uuid4())
        log_entry = {
            "request_id": request_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "requested_model": requested_model,
            "estimated_tokens": route_info.get("estimated_tokens", 0),
            "message_count": route_info.get("message_count", 0),
            "matched_rule": route_info.get("matched_rule"),
            "matched_by": route_info.get("matched_by"),
            "routed_model": model_id,
            "routed_tier": tier,
            "routed_provider": model_info.get("provider", "unknown"),
            "is_fallback": False,
            "fallback_chain": [],
            "latency_ms": None,
            "ttft_ms": None,
            "is_stream": is_stream,
            "status": 200,
            "error": None,
        }

        if api_format == "anthropic":
            return await self._forward_to_anthropic(
                forward_body, provider_cfg, model_id, tier, is_stream, log_entry,
            )
        else:
            raise HTTPException(status_code=501, detail=f"Cross-format routing to {api_format} not yet supported")

    async def _forward_to_anthropic(self, body: dict, provider_cfg: dict, model_id: str, tier: str, is_stream: bool, log_entry: dict):
        """Forward to an Anthropic-compatible endpoint."""
        url = provider_cfg["base_url"].rstrip("/") + "/v1/messages"
        headers = {
            "x-api-key": provider_cfg["api_key"],
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        timeout = provider_cfg.get("timeout", 120)

        start = time.monotonic()
        try:
            if is_stream:
                return await self._anthropic_stream(url, headers, body, model_id, tier, timeout, start, log_entry)
            else:
                return await self._anthropic_normal(url, headers, body, model_id, tier, timeout, start, log_entry)
        except Exception as e:
            elapsed_ms = (time.monotonic() - start) * 1000
            self.tracker.record(model_id, elapsed_ms, success=False)
            logger.error(f"Request to {model_id} failed: {e}")

            log_entry["latency_ms"] = round(elapsed_ms)
            log_entry["status"] = 502
            log_entry["error"] = str(e)

            fallback = await self._try_fallback_anthropic(body, model_id, is_stream, log_entry)
            if fallback is not None:
                return fallback

            self.req_logger.log(log_entry)
            raise HTTPException(status_code=502, detail=f"All models failed: {e}")

    async def _anthropic_stream(self, url, headers, body, model_id, tier, timeout, start, log_entry) -> StreamingResponse:
        """Stream Anthropic SSE response."""
        async def generate():
            ttft_recorded = False
            try:
                # Inject routing info as first SSE event
                yield f"event: routing\ndata: {json.dumps({'model': model_id, 'tier': tier})}\n\n"

                async with self.client.stream(
                    "POST", url, json=body, headers=headers,
                    timeout=httpx.Timeout(connect=10, read=timeout, write=10, pool=10),
                ) as resp:
                    if resp.status_code != 200:
                        error_body = await resp.aread()
                        elapsed_ms = (time.monotonic() - start) * 1000
                        self.tracker.record(model_id, elapsed_ms, success=False)
                        logger.error(f"Stream error {resp.status_code}: {error_body.decode()[:300]}")
                        log_entry["latency_ms"] = round(elapsed_ms)
                        log_entry["status"] = resp.status_code
                        log_entry["error"] = error_body.decode()[:500]
                        self.req_logger.log(log_entry)
                        yield f"event: error\ndata: {error_body.decode()}\n\n"
                        return

                    async for line in resp.aiter_lines():
                        if not ttft_recorded:
                            ttft_ms = (time.monotonic() - start) * 1000
                            log_entry["ttft_ms"] = round(ttft_ms)
                            ttft_recorded = True
                        yield line + "\n\n"

                    elapsed_ms = (time.monotonic() - start) * 1000
                    self.tracker.record(model_id, elapsed_ms, success=True)
                    log_entry["latency_ms"] = round(elapsed_ms)
                    self.req_logger.log(log_entry)
                    logger.debug(f"Stream completed: {model_id} in {elapsed_ms:.0f}ms")
            except Exception as e:
                elapsed_ms = (time.monotonic() - start) * 1000
                self.tracker.record(model_id, elapsed_ms, success=False)
                log_entry["latency_ms"] = round(elapsed_ms)
                log_entry["status"] = 502
                log_entry["error"] = str(e)
                self.req_logger.log(log_entry)
                logger.error(f"Stream exception for {model_id}: {e}")
                yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
                "X-Routed-Model": model_id,
                "X-Routed-Tier": tier,
            },
        )

    async def _anthropic_normal(self, url, headers, body, model_id, tier, timeout, start, log_entry) -> JSONResponse:
        """Non-streaming Anthropic request."""
        resp = await self.client.post(
            url, json=body, headers=headers,
            timeout=httpx.Timeout(connect=10, read=timeout, write=10, pool=10),
        )
        elapsed_ms = (time.monotonic() - start) * 1000
        self.tracker.record(model_id, elapsed_ms, success=resp.status_code == 200)

        log_entry["latency_ms"] = round(elapsed_ms)
        log_entry["status"] = resp.status_code

        if resp.status_code != 200:
            log_entry["error"] = resp.text[:500]
            self.req_logger.log(log_entry)
            logger.error(f"Upstream error {resp.status_code}: {resp.text[:300]}")
            raise HTTPException(status_code=resp.status_code, detail=resp.text)

        logger.debug(f"Request completed: {model_id} in {elapsed_ms:.0f}ms")
        self.req_logger.log(log_entry)
        return JSONResponse(
            content=resp.json(),
            headers={"X-Routed-Model": model_id, "X-Routed-Tier": tier},
        )

    async def _try_fallback_anthropic(self, request_body: dict, failed_model: str, is_stream: bool, log_entry: dict):
        """Try fallback models within same provider, then cross-tier."""
        model_info = self.config.model_registry.get(failed_model, {})
        tier = model_info.get("tier")
        if not tier:
            return None

        self.tracker.mark_unavailable(failed_model)

        # Same-tier fallback (same provider only for now, since format must match)
        if self.config.fallback.get("cross_provider", True):
            for m in self.config.models.get(tier, []):
                if m["id"] == failed_model or not self.tracker.is_available(m["id"]):
                    continue
                provider_cfg = self.config.get_provider(m["provider"])
                if not provider_cfg or provider_cfg.get("api_format") != "anthropic":
                    continue
                result = await self._attempt_anthropic(m, request_body, is_stream, log_entry)
                if result is not None:
                    return result

        # Cross-tier fallback
        if self.config.fallback.get("cross_tier", True):
            degr_order = self.config.fallback.get("degradation_order", [])
            tier_idx = next((i for i, t in enumerate(degr_order) if t == tier), -1)
            for lower_tier in degr_order[tier_idx + 1:]:
                for m in self.config.models.get(lower_tier, []):
                    if not self.tracker.is_available(m["id"]):
                        continue
                    provider_cfg = self.config.get_provider(m["provider"])
                    if not provider_cfg or provider_cfg.get("api_format") != "anthropic":
                        continue
                    logger.info(f"Cross-tier fallback: {m['id']} ({lower_tier})")
                    result = await self._attempt_anthropic(m, request_body, is_stream, log_entry)
                    if result is not None:
                        return result

        return None

    async def _attempt_anthropic(self, model_entry: dict, request_body: dict, is_stream: bool, log_entry: dict):
        """Try forwarding to a specific model via Anthropic format."""
        provider_cfg = self.config.get_provider(model_entry["provider"])
        if not provider_cfg:
            return None

        model_id = model_entry["id"]
        tier = self.config.model_registry.get(model_id, {}).get("tier", "unknown")
        logger.info(f"Fallback: trying {model_id} ({tier})")

        # Record in fallback chain
        log_entry["fallback_chain"].append({"model": model_id, "tier": tier, "error": ""})
        log_entry["is_fallback"] = True

        forward_body = {**request_body, "model": model_id}
        url = provider_cfg["base_url"].rstrip("/") + "/v1/messages"
        headers = {
            "x-api-key": provider_cfg["api_key"],
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        timeout = provider_cfg.get("timeout", 120)
        start = time.monotonic()

        try:
            if is_stream:
                return await self._anthropic_stream(url, headers, forward_body, model_id, tier, timeout, start, log_entry)
            else:
                resp = await self.client.post(
                    url, json=forward_body, headers=headers,
                    timeout=httpx.Timeout(connect=10, read=timeout, write=10, pool=10),
                )
                elapsed_ms = (time.monotonic() - start) * 1000
                self.tracker.record(model_id, elapsed_ms, success=resp.status_code == 200)
                if resp.status_code == 200:
                    log_entry["routed_model"] = model_id
                    log_entry["routed_tier"] = tier
                    log_entry["latency_ms"] = round(elapsed_ms)
                    log_entry["status"] = 200
                    self.req_logger.log(log_entry)
                    return JSONResponse(
                        content=resp.json(),
                        headers={"X-Routed-Model": model_id, "X-Routed-Tier": tier},
                    )
                else:
                    log_entry["fallback_chain"][-1]["error"] = f"HTTP {resp.status_code}"
        except Exception as e:
            logger.warning(f"Fallback to {model_id} failed: {e}")
            log_entry["fallback_chain"][-1]["error"] = str(e)
        return None
