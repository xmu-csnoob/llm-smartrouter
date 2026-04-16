"""Streaming proxy — supports both Anthropic and OpenAI format passthrough."""

import time
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from .config import RouterConfig
from .router import Router
from .latency import LatencyTracker
from .request_logger import RequestLogger
from .scoring import extract_text_from_messages, extract_text_from_system
from .rate_limiter import RateLimiter
from . import semantic_features

logger = logging.getLogger("llm_router")

LOG_SCHEMA_VERSION = 3


def _build_schema_v3_fields(
    request_body: dict,
    route_info: dict,
    tracker: LatencyTracker,
    config: RouterConfig,
) -> tuple[dict, dict, dict]:
    """Extract raw_features, semantic_features, and router_context for Schema v3.

    All computation is pure CPU with no external I/O — < 1ms total.
    """
    messages = request_body.get("messages", [])
    system = request_body.get("system")
    feature_values = route_info.get("feature_values", {})

    # --- raw_features ---
    system_text = extract_text_from_system(system)
    message_text = extract_text_from_messages(messages)

    raw_features = {
        "estimated_tokens": feature_values.get("estimated_tokens", 0),
        "message_count": feature_values.get("message_count", 0),
        "user_message_count": feature_values.get("user_message_count", 0),
        "assistant_message_count": feature_values.get("assistant_message_count", 0),
        "tool_count": feature_values.get("tool_count", 0),
        "question_count": feature_values.get("question_count", 0),
        "code_block_count": feature_values.get("code_block_count", 0),
        "file_path_count": feature_values.get("file_path_count", 0),
        "stacktrace_count": feature_values.get("stacktrace_count", 0),
        "max_tokens_requested": feature_values.get("max_tokens_requested", 0),
        "input_chars": feature_values.get("input_chars", 0),
        "has_system_prompt": bool(system_text),
        "system_prompt_chars": len(system_text),
        "is_stream": request_body.get("stream", False),
        "is_followup": bool(messages) and messages[-1].get("role") == "assistant",
        "hour_of_day_utc": datetime.now(timezone.utc).hour,
    }

    # --- semantic_features ---
    combined_text = " ".join(p for p in [system_text, message_text] if p)
    semantic_out = semantic_features.extract_semantic_features(
        messages=messages,
        request_text=combined_text,
        raw_features=raw_features,
    )

    # --- router_context ---
    router_context: dict[str, Any] = {
        "tier1_health_score": None,
        "tier2_health_score": None,
        "tier3_health_score": None,
        "selected_tier": route_info.get("selected_tier"),
        "matched_by": route_info.get("matched_by"),
    }
    for tier_name in ("tier1", "tier2", "tier3"):
        models = config.models.get(tier_name, [])
        if not models:
            continue
        scores = []
        for m in models:
            avg_lat = tracker.get_avg_latency(m["id"])
            avg_ttft = tracker.get_avg_ttft(m["id"])
            errs = tracker.get_consecutive_errors(m["id"])
            score = 100.0
            latency_threshold = 30000.0
            ttft_threshold = latency_threshold / 4
            if avg_lat is not None:
                score -= min((avg_lat / latency_threshold) * 40.0, 40.0)
            if avg_ttft is not None:
                score -= min((avg_ttft / ttft_threshold) * 20.0, 20.0)
            score -= errs * 15.0
            scores.append(score)
        if scores:
            router_context[f"{tier_name}_health_score"] = round(sum(scores) / len(scores), 1)

    return raw_features, semantic_out, router_context


class StreamProxy:
    """Forwards requests to providers with SSE passthrough and fallback."""

    def __init__(self, config: RouterConfig, router: Router, tracker: LatencyTracker, req_logger: RequestLogger, shadow_policy=None, redactor=None, rate_limiter=None):
        self.config = config
        self.router = router
        self.tracker = tracker
        self.req_logger = req_logger
        self.shadow_policy = shadow_policy
        self.redactor = redactor
        self.rate_limiter = rate_limiter
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=300.0, write=10.0, pool=10.0),
            trust_env=False,
        )

    def _build_rate_limit_headers(self, client_api_key: str | None) -> dict:
        """Build rate limit headers from current remaining quota."""
        if not client_api_key or not self.rate_limiter:
            return {}
        remaining = self.rate_limiter.get_remaining(client_api_key)
        headers = {}
        if "rpm_remaining" in remaining:
            headers["X-RateLimit-Remaining"] = str(remaining["rpm_remaining"])
            headers["X-RateLimit-Limit"] = str(remaining["rpm_limit"])
        if "budget_remaining" in remaining:
            headers["X-RateLimit-Budget-Remaining"] = str(remaining["budget_remaining"])
            headers["X-RateLimit-Budget-Limit"] = str(remaining["budget_limit"])
        return headers

    async def forward_anthropic(self, request_body: dict, client_api_key: str | None = None) -> StreamingResponse | JSONResponse:
        """Forward an Anthropic Messages API request."""
        # --- Rate limit check (before routing) ---
        if self.rate_limiter is not None and client_api_key:
            allowed, reason = self.rate_limiter.check(client_api_key)
            if not allowed:
                remaining = self.rate_limiter.get_remaining(client_api_key)
                headers = {}
                if "rpm_remaining" in remaining:
                    headers["X-RateLimit-Remaining"] = str(remaining["rpm_remaining"])
                    headers["X-RateLimit-Limit"] = str(remaining["rpm_limit"])
                if "budget_remaining" in remaining:
                    headers["X-RateLimit-Budget-Remaining"] = str(remaining["budget_remaining"])
                    headers["X-RateLimit-Budget-Limit"] = str(remaining["budget_limit"])
                logger.warning(f"Rate limit triggered for API key: {reason}")
                return JSONResponse(
                    status_code=429,
                    content={"error": reason, "type": "rate_limit_exceeded"},
                    headers=headers,
                )

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
            "log_schema_version": LOG_SCHEMA_VERSION,
            "request_id": request_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "client_api_key": client_api_key,
            "requested_model": requested_model,
            "requested_model_tier": route_info.get("requested_model_tier"),
            "estimated_tokens": route_info.get("estimated_tokens", 0),
            "message_count": route_info.get("message_count", 0),
            "matched_rule": route_info.get("matched_rule"),
            "matched_by": route_info.get("matched_by"),
            "selected_tier": route_info.get("selected_tier", tier),
            "degraded_to_tier": route_info.get("degraded_to_tier"),
            "tier_scores": route_info.get("tier_scores", {}),
            "score_breakdown": route_info.get("score_breakdown", {}),
            "detected_features": route_info.get("detected_features", []),
            "feature_values": route_info.get("feature_values", {}),
            "request_shape": route_info.get("request_shape", {}),
            "task_type": route_info.get("task_type"),
            "decision_path": route_info.get("decision_path", []),
            "legacy_rule_matches": route_info.get("legacy_rule_matches", []),
            "model_selection": route_info.get("model_selection", {}),
            "observability_only": route_info.get("observability_only", False),
            "routed_model": model_id,
            "routed_tier": tier,
            "routed_provider": model_info.get("provider", "unknown"),
            "is_fallback": False,
            "fallback_chain": [],
            "fallback_reason": None,
            "latency_ms": None,
            "ttft_ms": None,
            "is_stream": is_stream,
            "status": 200,
            "error": None,
        }

        # --- Schema v3: enrich log entry with semantic features ---
        raw_features, semantic_features_out, router_context = _build_schema_v3_fields(
            request_body, route_info, self.tracker, self.config,
        )
        log_entry["raw_features"] = raw_features
        log_entry["semantic_features"] = semantic_features_out
        log_entry["router_context"] = router_context

        # --- Tier permission check ---
        selected_tier = route_info.get("selected_tier", tier)
        tier_allowed, exclusion_reason = self.router.check_tier_permission(client_api_key, selected_tier)
        if not tier_allowed:
            logger.warning(f"Tier restriction triggered for client API key: {exclusion_reason}")
            log_entry["observability_only"] = True
            # Re-route to highest allowed tier
            tier_order = self.config.tier_order
            for allowed_tier in tier_order:
                allowed, _ = self.router.check_tier_permission(client_api_key, allowed_tier)
                if allowed:
                    logger.info(f"Re-routing to allowed tier: {allowed_tier}")
                    model_id, provider_cfg, route_info = self.router._select_model(allowed_tier, route_info)
                    tier = allowed
                    log_entry["selected_tier"] = allowed_tier
                    log_entry["routed_tier"] = allowed_tier
                    break

        # --- Shadow policy decision ---
        if self.shadow_policy is not None:
            from .schemas import FeatureSnapshot
            feature_values = route_info.get("feature_values", {})
            feature_snapshot = FeatureSnapshot(
                estimated_tokens=raw_features.get("estimated_tokens", 0),
                message_count=raw_features.get("message_count", 0),
                user_message_count=raw_features.get("user_message_count", 0),
                assistant_message_count=raw_features.get("assistant_message_count", 0),
                code_block_count=raw_features.get("code_block_count", 0),
                file_path_count=raw_features.get("file_path_count", 0),
                stacktrace_count=raw_features.get("stacktrace_count", 0),
                tool_count=raw_features.get("tool_count", 0),
                question_count=raw_features.get("question_count", 0),
                max_tokens_requested=raw_features.get("max_tokens_requested", 0),
                stream_flag=raw_features.get("is_stream", False),
                complexity_signal_count=feature_values.get("complexity_signal_count", 0),
                error_signal_count=feature_values.get("error_signal_count", 0),
                matched_rule_count=len(route_info.get("legacy_rule_matches", [])),
                hour_of_day_utc=raw_features.get("hour_of_day_utc", 0),
                tier1_health_score=router_context.get("tier1_health_score"),
                tier2_health_score=router_context.get("tier2_health_score"),
                tier3_health_score=router_context.get("tier3_health_score"),
            )
            shadow_decision = self.shadow_policy.decide(request_body, route_info, feature_snapshot)
            log_entry["shadow_policy_decision"] = {
                "enabled": shadow_decision.enabled,
                "mode": shadow_decision.mode,
                "candidate_tier": shadow_decision.candidate_tier,
                "propensity": shadow_decision.propensity,
                "exclusion_reason": shadow_decision.exclusion_reason,
                "hard_exclusions_triggered": shadow_decision.hard_exclusions_triggered,
            }

        # --- Redacted request preview ---
        if self.redactor is not None:
            redacted = self.redactor.redact_request_context(request_body)
            log_entry["redacted_preview"] = redacted

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
            log_entry["fallback_reason"] = str(e)

            fallback = await self._try_fallback_anthropic(body, model_id, is_stream, log_entry)
            if fallback is not None:
                return fallback

            self.req_logger.log(log_entry)
            raise HTTPException(status_code=502, detail=f"All models failed: {e}")

    async def _anthropic_stream(self, url, headers, body, model_id, tier, timeout, start, log_entry) -> StreamingResponse:
        """Stream Anthropic SSE response."""
        estimated_input = log_entry.get("estimated_tokens", 0)
        input_cost_per_m = self.config.cost_config.get("input_cost_per_million", 3.5)
        output_cost_per_m = self.config.cost_config.get("output_cost_per_million", 18.0)
        estimated_cost = f"{(estimated_input / 1_000_000 * input_cost_per_m):.4f}"

        async def generate():
            ttft_recorded = False
            output_tokens_cumulative = 0
            log_entry["routed_model"] = model_id
            log_entry["routed_tier"] = tier
            log_entry["routed_provider"] = self.config.model_registry.get(model_id, {}).get("provider", "unknown")
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
                            self.tracker.record_ttft(model_id, ttft_ms)
                            ttft_recorded = True

                        # Track output tokens from message_usage events
                        if line.startswith("event: message_usage"):
                            usage_data = line.split("data: ", 1)
                            if len(usage_data) > 1:
                                try:
                                    usage = json.loads(usage_data[1])
                                    output_tokens_cumulative = usage.get("output_tokens", 0)
                                except json.JSONDecodeError:
                                    pass

                        yield line + "\n\n"

                    # After stream ends, emit token counts and cost
                    final_cost = f"{(estimated_input / 1_000_000 * input_cost_per_m) + (output_tokens_cumulative / 1_000_000 * output_cost_per_m):.4f}"
                    yield f"event: token_count\ndata: {json.dumps({'input_tokens': estimated_input, 'output_tokens': output_tokens_cumulative, 'estimated_cost': final_cost})}\n\n"

                    # Record token usage for rate limiting
                    client_api_key = log_entry.get("client_api_key")
                    if client_api_key and self.rate_limiter is not None:
                        self.rate_limiter.record(client_api_key, estimated_input, output_tokens_cumulative)

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
                "X-Token-Count-Input": str(estimated_input),
                "X-Token-Count-Output": "0",  # Updated via SSE event after stream ends
                "X-Estimated-Cost": estimated_cost,
                **self._build_rate_limit_headers(log_entry.get("client_api_key")),
            },
        )

    async def _anthropic_normal(self, url, headers, body, model_id, tier, timeout, start, log_entry) -> JSONResponse:
        """Non-streaming Anthropic request."""
        log_entry["routed_model"] = model_id
        log_entry["routed_tier"] = tier
        log_entry["routed_provider"] = self.config.model_registry.get(model_id, {}).get("provider", "unknown")
        resp = await self.client.post(
            url, json=body, headers=headers,
            timeout=httpx.Timeout(connect=10, read=timeout, write=10, pool=10),
        )
        elapsed_ms = (time.monotonic() - start) * 1000
        self.tracker.record(model_id, elapsed_ms, success=resp.status_code == 200)

        log_entry["latency_ms"] = round(elapsed_ms)
        log_entry["status"] = resp.status_code

        # Extract token usage from response for cost visibility
        estimated_input = log_entry.get("estimated_tokens", 0)
        input_tokens_val = estimated_input
        output_tokens_val = 0
        estimated_cost = "0.00"
        input_cost_per_m = self.config.cost_config.get("input_cost_per_million", 3.5)
        output_cost_per_m = self.config.cost_config.get("output_cost_per_million", 18.0)

        if resp.status_code == 200:
            try:
                resp_data = resp.json()
                usage = resp_data.get("usage", {})
                input_tokens_val = usage.get("input_tokens", estimated_input)
                output_tokens_val = usage.get("output_tokens", 0)
                estimated_cost = f"{(input_tokens_val / 1_000_000 * input_cost_per_m) + (output_tokens_val / 1_000_000 * output_cost_per_m):.4f}"
            except Exception:
                pass

        # Record actual token usage for rate limiting
        client_api_key = log_entry.get("client_api_key")
        if client_api_key and self.rate_limiter is not None:
            self.rate_limiter.record(client_api_key, input_tokens_val, output_tokens_val)

        if resp.status_code != 200:
            log_entry["error"] = resp.text[:500]
            self.req_logger.log(log_entry)
            logger.error(f"Upstream error {resp.status_code}: {resp.text[:300]}")
            raise HTTPException(status_code=resp.status_code, detail=resp.text)

        logger.debug(f"Request completed: {model_id} in {elapsed_ms:.0f}ms")
        self.req_logger.log(log_entry)

        # Build rate limit headers
        rate_headers = {}
        if client_api_key and self.rate_limiter is not None:
            remaining = self.rate_limiter.get_remaining(client_api_key)
            if "rpm_remaining" in remaining:
                rate_headers["X-RateLimit-Remaining"] = str(remaining["rpm_remaining"])
                rate_headers["X-RateLimit-Limit"] = str(remaining["rpm_limit"])
            if "budget_remaining" in remaining:
                rate_headers["X-RateLimit-Budget-Remaining"] = str(remaining["budget_remaining"])
                rate_headers["X-RateLimit-Budget-Limit"] = str(remaining["budget_limit"])

        return JSONResponse(
            content=resp.json(),
            headers={
                "X-Routed-Model": model_id,
                "X-Routed-Tier": tier,
                "X-Token-Count-Input": str(input_tokens_val),
                "X-Token-Count-Output": str(output_tokens_val),
                "X-Estimated-Cost": estimated_cost,
                **rate_headers,
            },
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
                result = await self._attempt_anthropic(m, request_body, is_stream, log_entry, failed_model)
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
                    result = await self._attempt_anthropic(m, request_body, is_stream, log_entry, failed_model)
                    if result is not None:
                        return result

        return None

    async def _attempt_anthropic(self, model_entry: dict, request_body: dict, is_stream: bool, log_entry: dict, failed_model: str):
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
        log_entry["fallback_reason"] = log_entry.get("fallback_reason") or f"primary model {failed_model} failed"

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
                    log_entry["routed_provider"] = model_entry["provider"]
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
