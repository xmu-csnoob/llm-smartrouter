const API_BASE = '/api';

export interface SemanticFeatures {
  intent: string;
  difficulty: string;
  domain: string;
  tool_usage_pattern: string;
  error_pattern_type: string | null;
  cross_file_analysis: boolean;
  recursive_depth: string;
  multi_turn_depth: string;
  requires_reasoning: boolean;
  clarification_needed_score: number;
  is_followup: boolean;
  // Keyword signal counts
  debug_signal_count: number;
  design_signal_count: number;
  implementation_signal_count: number;
  review_signal_count: number;
  explain_signal_count: number;
  generation_signal_count: number;
  reasoning_signal_count: number;
  constraint_signal_count: number;
  comparison_signal_count: number;
  migration_signal_count: number;
  performance_signal_count: number;
}

export interface ShadowPolicyDecision {
  enabled: boolean;
  mode: string;
  candidate_tier: string | null;
  propensity: number;
  exclusion_reason: string | null;
  hard_exclusions_triggered: string[];
}

export interface RedactedPreview {
  system_preview: string;
  message_previews: Array<{ role: string; text: string }>;
  message_count: number;
  preview_count: number;
}

export interface LogEntry {
  request_id: string;
  timestamp: string;
  requested_model: string;
  estimated_tokens: number;
  message_count: number;
  matched_rule: string;
  matched_by: string;
  selected_tier: string;
  min_allowed_tier: string | null;
  degraded_to_tier: string | null;
  quality_guard_applied: boolean;
  quality_guard_reasons: string[];
  routed_model: string;
  routed_tier: string;
  routed_provider: string;
  request_preview: string | null;
  request_context?: {
    system_preview?: string;
    message_previews?: Array<{ role: string; text: string }>;
    message_count?: number;
    preview_count?: number;
  } | null;
  is_fallback: boolean;
  fallback_chain: Array<{ model: string; tier: string; error: string }>;
  latency_ms: number | null;
  ttft_ms: number | null;
  is_stream: boolean;
  status: number;
  error: string | null;
  // Schema v3 fields
  log_schema_version?: number;
  raw_features?: Record<string, number | boolean>;
  semantic_features?: SemanticFeatures;
  router_context?: Record<string, unknown>;
  shadow_policy_decision?: ShadowPolicyDecision;
  redacted_preview?: RedactedPreview;
  task_type?: string;
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
  // Schema v3 enrichment
  feature_snapshot_count: number;
  selected_tier_count: number;
  missing_feature_snapshot_count: number;
  missing_selected_tier_count: number;
  task_types: Record<string, number>;
  schema_versions: Record<string, number>;
  intent_distribution: Record<string, number>;
  difficulty_distribution: Record<string, number>;
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
