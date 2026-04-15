# LLM Router

A lightweight multi-model routing proxy with intelligent request classification, automatic failover, and a real-time monitoring dashboard. Compatible with the Anthropic Messages API.

## Features

- **Rule-based routing** — classify requests by token estimation, keyword matching, or expression evaluation, then route to the appropriate model tier
- **Automatic fallback** — same-tier and cross-tier degradation with configurable cooldown and error thresholds
- **Streaming support** — full SSE passthrough with Time-To-First-Token (TTFT) tracking
- **Zero-overhead logging** — async queue with background batch flush to daily JSONL files; no impact on request latency
- **Real-time dashboard** — latency trends, model distribution, and request details with 10-second auto-refresh
- **Hot reload** — update `config.yaml` and reload without restart (`POST /reload` or `kill -HUP`)

## Architecture

```
Client (Claude Code / curl / SDK)
        │
        ▼
┌───────────────────┐
│   FastAPI Proxy   │  POST /v1/messages
│                   │
│  Router ──────────┤  Rule evaluation → tier selection
│  LatencyTracker ──┤  Sliding window health tracking
│  RequestLogger ───┤  Async queue → JSONL
│  StreamProxy ─────┤  SSE forwarding + fallback
└───────┬───────────┘
        │
        ▼
  Upstream LLM APIs (Anthropic-compatible)
```

## Quick Start

### Install

```bash
pip install -r requirements.txt
```

### Configure

Create `config.yaml` (see [Configuration](#configuration) for full reference):

```yaml
providers:
  glm:
    base_url: "https://open.bigmodel.cn/api/anthropic"
    api_key: "${API_KEY}"
    api_format: "anthropic"
    timeout: 120

models:
  tier1:
    - id: "glm-5.1"
      provider: glm
  tier2:
    - id: "glm-5"
      provider: glm
  tier3:
    - id: "glm-4.7"
      provider: glm

rules:
  - name: "complex-request"
    match: "estimated_tokens > 4000 or message_count > 20"
    target: tier1
  - name: "keyword-match"
    keywords: ["refactor", "design", "debug"]
    target: tier1
  - name: "default"
    target: tier3

fallback:
  latency_threshold_ms: 30000
  error_threshold: 3
  cooldown_seconds: 120
  cross_tier: true
  degradation_order: [tier1, tier2, tier3]

server:
  host: "127.0.0.1"
  port: 8000
```

### Run

```bash
python -m llm_router config.yaml
```

The proxy listens at `http://127.0.0.1:8000` by default. Point your Anthropic SDK or tool at this address.

### Dashboard

```bash
cd dashboard
npm install
npm run build   # output → dashboard/dist/
```

The built dashboard is served automatically at the root path (`/`) by the FastAPI server.

For development:

```bash
cd dashboard
npm run dev     # dev server on :5173 with /api proxy → localhost:8000
```

## Configuration

### Providers

Each provider defines an upstream API endpoint:

| Field | Description |
|-------|-------------|
| `base_url` | Upstream API base URL |
| `api_key` | API key. Supports `${ENV_VAR}` expansion |
| `api_format` | `anthropic` (only format currently supported) |
| `timeout` | Request timeout in seconds |

### Models

Models are organized into tiers. Tier naming is arbitrary — use whatever makes sense for your use case. Each model entry maps to a provider:

```yaml
models:
  tier1:              # high-capability
    - id: "glm-5.1"
      provider: glm
  tier3:              # routine tasks
    - id: "glm-4.7"
      provider: glm
```

### Rules

Rules are evaluated in order. The first match wins.

| Rule Type | Key | Description |
|-----------|-----|-------------|
| Explicit model | `match: "model_is_known"` | Passes through when the requested model ID matches a known model |
| Expression | `match: "<expr>"` | Python expression evaluated with `estimated_tokens` and `message_count` |
| Keyword | `keywords: [...]` | Matches if any keyword appears in the last user message |
| Default | `name: "default"` | Catch-all fallback rule |

### Fallback

When a model fails (error or high latency), the proxy attempts fallback:

```yaml
fallback:
  latency_threshold_ms: 30000   # mark unavailable above this
  error_threshold: 3            # consecutive errors before marking unavailable
  cooldown_seconds: 120         # retry window after marking unavailable
  cross_provider: true          # allow cross-provider fallback
  cross_tier: true              # allow cross-tier fallback
  degradation_order: [tier1, tier2, tier3]   # fallback direction
```

### Logging

```yaml
logging:
  enabled: true
  dir: "./logs"
  flush_interval_seconds: 2
  flush_batch_size: 50
  retention_days: 30
```

Logs are written to `logs/requests-YYYY-MM-DD.jsonl` with daily rotation. Each entry:

```json
{
  "request_id": "uuid",
  "timestamp": "2026-04-15T00:45:11+00:00",
  "requested_model": "auto",
  "estimated_tokens": 3500,
  "message_count": 12,
  "matched_rule": "keyword-match",
  "matched_by": "keyword",
  "routed_model": "glm-5.1",
  "routed_tier": "tier1",
  "routed_provider": "glm",
  "is_fallback": false,
  "fallback_chain": [],
  "latency_ms": 4609,
  "ttft_ms": 320,
  "is_stream": true,
  "status": 200,
  "error": null
}
```

## API Reference

### Proxy

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/messages` | Anthropic Messages API proxy |
| `GET` | `/v1/models` | List available models |

### Monitoring

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (`{"status": "ok"}`) |
| `GET` | `/status` | Model availability, latency stats, error counts |
| `GET` | `/api/logs/recent?limit=50` | Recent request log entries |
| `GET` | `/api/logs/stats?hours=24` | Aggregated statistics (totals, per-model breakdown) |

### Management

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/reload` | Hot-reload configuration from disk |

## Dashboard

The built-in dashboard provides real-time visibility into routing behavior:

![Dashboard](docs/dashboard.png)

- **Stats cards** — total requests, average latency, fallback rate, error rate
- **Latency chart** — per-request latency and TTFT trend lines
- **Model chart** — request distribution across models
- **Request table** — recent requests with routing details

The dashboard auto-refreshes every 10 seconds.

## Running as a Service (macOS)

Save a launchd plist to `~/Library/LaunchAgents/`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.wangwenfei.llm-router</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/env</string>
        <string>python</string>
        <string>-m</string>
        <string>llm_router</string>
        <string>/path/to/config.yaml</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/llm-router</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/ai.wangwenfei.llm-router.plist
```

## Project Structure

```
llm-router/
├── config.yaml                 # Router configuration
├── requirements.txt            # Python dependencies
├── run.sh                      # Launcher script
├── llm_router/
│   ├── __main__.py             # CLI entry point
│   ├── main.py                 # FastAPI app, routes, lifespan
│   ├── config.py               # YAML config loader
│   ├── router.py               # Rule evaluation, tier selection
│   ├── proxy.py                # Streaming proxy with fallback
│   ├── latency.py              # Sliding-window latency tracker
│   ├── request_logger.py       # Async JSONL logger
│   └── schemas.py              # Pydantic models
├── dashboard/
│   ├── src/
│   │   ├── App.tsx             # Main layout
│   │   ├── components/         # Charts, table, cards
│   │   └── hooks/useApi.ts     # API client
│   ├── dist/                   # Built static files (served by FastAPI)
│   └── package.json
├── logs/                       # JSONL log files
└── docs/
    └── dashboard.png           # Dashboard screenshot
```

## License

[MIT](LICENSE)
