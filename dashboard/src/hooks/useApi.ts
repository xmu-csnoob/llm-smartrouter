const API_BASE = '/api';

export interface LogEntry {
  request_id: string;
  timestamp: string;
  client_api_key: string | null;
  requested_model: string;
  estimated_tokens: number;
  message_count: number;
  matched_rule: string;
  matched_by: string;
  selected_tier: string;
  degraded_to_tier: string | null;
  routed_model: string;
  routed_tier: string;
  routed_provider: string;
  is_fallback: boolean;
  fallback_chain: Array<{ model: string; tier: string; error: string }>;
  latency_ms: number | null;
  ttft_ms: number | null;
  is_stream: boolean;
  status: number;
  error: string | null;
  observability_only: boolean;
  task_type: string;
  detected_features: string[];
  raw_features?: {
    estimated_tokens: number;
    message_count: number;
    user_message_count: number;
    assistant_message_count: number;
    tool_count: number;
    question_count: number;
    code_block_count: number;
    file_path_count: number;
    stacktrace_count: number;
    max_tokens_requested: number;
    input_chars: number;
    has_system_prompt: boolean;
    system_prompt_chars: number;
    is_stream: boolean;
    is_followup: boolean;
    hour_of_day_utc: number;
  };
  semantic_features?: {
    intent: string;
    intent_type: string;
    difficulty: string;
    task_domain: string;
    tool_usage_pattern: string;
    error_pattern_type: string | null;
    cross_file_analysis: boolean;
    recursive_depth: string;
    multi_turn_depth: string;
    requires_reasoning: boolean;
    clarification_needed_score: number;
    is_followup: boolean;
  };
  tier_scores: Record<string, number>;
  score_breakdown: Record<string, number>;
}

export interface RecentResponse {
  entries: LogEntry[]
  total: number
  offset: number
  limit: number
}

export interface ModelStats {
  count: number;
  errors: number;
  total_latency: number;
  avg_latency_ms: number;
  total_ttft?: number;
  ttft_samples?: number;
  avg_ttft_ms?: number | null;
}

export interface Stats {
  total: number;
  errors: number;
  error_rate: number;
  fallbacks: number;
  fallback_rate: number;
  avg_latency_ms: number | null;
  avg_ttft_ms: number | null;
  models: Record<string, ModelStats>;
}

export async function fetchRecent(offset = 0, limit = 50, model?: string | null): Promise<RecentResponse> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  if (model) params.set('model', model);
  const res = await fetch(`${API_BASE}/logs/recent?${params}`);
  return res.json();
}

export async function fetchStats(hours = 24): Promise<Stats> {
  const res = await fetch(`${API_BASE}/logs/stats?hours=${hours}`);
  return res.json();
}

export interface ArchiveResponse {
  archived: string[];
  skipped: string[];
  total_archived: number;
}

export async function archiveLogs(): Promise<ArchiveResponse> {
  const res = await fetch(`${API_BASE}/logs/archive`, { method: 'POST' });
  if (!res.ok) throw new Error(`Archive failed: ${res.statusText}`);
  return res.json();
}

export async function analyzeLogs(
  hours: number,
  lang: string,
  onChunk: (text: string) => void,
): Promise<void> {
  const res = await fetch(`${API_BASE}/logs/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hours, lang }),
  });

  if (!res.ok) {
    throw new Error(`Analysis failed: ${res.statusText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.text) {
            onChunk(parsed.text);
          }
        } catch {
          // not JSON, skip
        }
      }
    }
  }
}
