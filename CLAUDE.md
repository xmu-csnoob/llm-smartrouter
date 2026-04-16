# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

llm-router is a FastAPI-based multi-model routing proxy compatible with the Anthropic Messages API. It sits between clients (Claude Code, SDKs, curl) and upstream LLM APIs, classifying requests by complexity and routing to the appropriate model tier with automatic failover. It includes an ML-based router (bert-tiny) and a React monitoring dashboard.

## Common Commands

### Backend
```bash
# Install dependencies
pip install -r requirements.txt

# Run the router
python -m llm_router config.yaml
python -m llm_router config.yaml --port 8002   # override port

# Run all tests
python -m pytest tests/

# Run a single test file
python -m unittest tests/test_backoff.py

# Evaluate routing accuracy against 200 labeled benchmark cases
python scripts/eval_routing_benchmark.py --config config.yaml

# Counterfactual evaluation (what-if analysis of routing decisions)
python scripts/eval_counterfactual.py --config config.yaml

# Train router policy ML model
python scripts/train_router_policy.py --config config.yaml

# Concurrency stress test
python scripts/test_concurrency.py --config config.yaml

### Dashboard (Frontend)
```bash
cd dashboard
npm install
npm run dev      # Vite dev server on :5173
npm run build    # Production build to dashboard/dist/
npm run lint     # ESLint
```

### Environment
- `LLM_ROUTER_DEV=1` — dev mode: FastAPI proxies frontend to Vite instead of serving static files
- `VITE_PORT` — override Vite dev server port (default 5173)

## Architecture

```
Client → POST /v1/messages → StreamProxy → Router → Upstream LLM API
                                    ↓
                              RequestScorer (feature extraction)
                              ML Model (optional bert-tiny classifier)
                              LatencyTracker (sliding-window health)
                              RequestLogger (async queue → JSONL)
```

**Request flow:** Client sends Anthropic-format request → StreamProxy calls Router.route() → RequestScorer extracts features (token estimates, code blocks, stacktraces, task type) → scoring engine combines feature weights + ML prediction + legacy rule bonuses to select a tier → healthiest model within tier is chosen → StreamProxy forwards upstream with SSE passthrough → on failure, fallback attempts same-tier then cross-tier degradation.

### Core Modules (llm_router/)

- **`main.py`** — FastAPI app factory, all HTTP routes, lifespan management
- **`config.py`** — YAML config loader with env-var expansion and hot-reload (`POST /reload` or `kill -HUP`)
- **`router.py`** — Tier selection, model selection via health scoring, fallback logic
- **`scoring.py`** — Feature extraction (10 features) and per-tier weighted scoring; classifies task_type as simple/debug/implementation/architecture/analysis/general
- **`ml_router.py`** — Optional ML router with tier classifiers (tier3/tier2), isotonic calibration, and OOD detection; loads model artifacts from manifest JSON
- **`model_loader.py`** — Optional bert-tiny ML model wrapper from HuggingFace; runs inference in thread pool with 50ms timeout
- **`proxy.py`** — Streaming proxy with SSE passthrough, fallback handling, TTFT tracking
- **`latency.py`** — Sliding-window latency tracker with TCP-inspired exponential backoff for model cooldown
- **`request_logger.py`** — Async JSONL logger with batch flush (zero overhead on request path)
- **`redaction.py`** — PII redaction for logged requests; masks emails, phones, API keys, URLs (to host only), and file paths (to basename only)
- **`shadow_policy.py`** — Shadow policy controller for safely collecting lower-tier execution samples; supports observe-only, forced lower-tier, and hard exclusion modes
- **`schemas.py`** — Pydantic models for API types

### Three Tier System

- **tier1** (Frontier) — design, refactoring, hard bugs
- **tier2** (Workhorse) — feature implementation
- **tier3** (Routine) — conflicts, compile errors, simple tasks

Models within a tier are ranked by a health score (100 base, penalized by latency/TTFT/errors). Degradation follows `degradation_order` in config.

### Dashboard (dashboard/)

React 19 + Vite 8 + TailwindCSS 4 + shadcn/ui + Recharts. Components: StatsCards, LatencyChart, ModelChart (drill-down), RequestTable, AnalysisPanel (AI-powered log analysis via SSE). Supports English/Chinese i18n. Auto-refreshes every 10 seconds.

### Key API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/messages` | Main proxy (Anthropic Messages API compatible) |
| `GET /v1/models` | List available models |
| `GET /status` | Model availability, latency stats, error counts |
| `GET /api/logs/recent` | Paginated recent logs |
| `GET /api/logs/stats` | Aggregated statistics |
| `POST /api/logs/analyze` | AI-powered analysis (SSE stream) |
| `GET /api/logs/replay` | Re-score logged requests with current weights |
| `POST /reload` | Hot-reload config from disk |

## Config

`config.yaml` defines providers (with `api_format: anthropic|openai`), model pool by tier, fallback thresholds, logging settings, ML routing options, redaction settings, and shadow policy. Config supports env-var interpolation (`${VAR_NAME}`).

## What NOT to Build

- **Self-imposed rate limiting** on outbound API calls. All keys are code-plan (按量付费), so榨干上游算力才是收益最大化。限速只会浪费对端配额，对自己没好处。只在需要保护下游不被自己跑爆配额时才考虑（如多客户共用key）。
- **Per-API-key tier restrictions** (`allowed_tiers`). Not meaningful for code-plan — every key pays for what it uses, no tier-based access control needed.
- **Cost-aware routing** that prefers cheaper models within a tier. For code-plan, routing should optimize for speed/quality first, not cost — the client pays for whatever tier they hit.

## Design Principles (Code-Plan场景)

- **API key tracking**: Extract and store API key in log entries for association/auditing only — not for access control.
- **Cost visibility**: Expose actual token usage via response headers (`X-Token-Count-Input`, `X-Token-Count-Output`, `X-Estimated-Cost`) and SSE `event: token_count` — so clients can see their consumption.
- **Log everything**: All requests logged with schema v3 including `client_api_key`, `input_tokens`, `output_tokens`, `cost`.

## Testing

Benchmark cases in `tests/routing_benchmark_cases.py` — 200 labeled cases across 4 rounds: simple (tier3), workhorse (tier2), frontier (tier1), and boundary edge cases. Evaluated via `scripts/eval_routing_benchmark.py`.
