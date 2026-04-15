const API_BASE = '/api';

export interface LogEntry {
  request_id: string;
  timestamp: string;
  requested_model: string;
  estimated_tokens: number;
  message_count: number;
  matched_rule: string;
  matched_by: string;
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
}

export interface Stats {
  total: number;
  errors: number;
  error_rate: number;
  fallbacks: number;
  fallback_rate: number;
  avg_latency_ms: number | null;
  avg_ttft_ms: number | null;
  models: Record<string, {
    count: number;
    errors: number;
    total_latency: number;
    avg_latency_ms: number;
  }>;
}

export async function fetchRecent(limit = 50): Promise<LogEntry[]> {
  const res = await fetch(`${API_BASE}/logs/recent?limit=${limit}`);
  return res.json();
}

export async function fetchStats(hours = 24): Promise<Stats> {
  const res = await fetch(`${API_BASE}/logs/stats?hours=${hours}`);
  return res.json();
}
