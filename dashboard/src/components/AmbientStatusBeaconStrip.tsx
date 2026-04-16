import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 5 * 60 * 1000

type BeaconLevel = 'NOMINAL' | 'WATCH' | 'CRITICAL'

const BEACON_META: Record<BeaconLevel, { color: string; glow: string; label: string }> = {
  NOMINAL: { color: 'hsl(145 65% 55%)', glow: '0 0 4px hsl(145 65% 55% / 0.6)', label: 'NOMINAL' },
  WATCH:   { color: 'hsl(38 92% 55%)',  glow: '0 0 6px hsl(38 92% 55% / 0.8)',  label: 'WATCH' },
  CRITICAL:{ color: 'hsl(0 72% 55%)',   glow: '0 0 8px hsl(0 72% 55% / 0.9)',   label: 'CRITICAL' },
}

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

interface BeaconItem {
  id: string
  label: string
  level: BeaconLevel
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0
  const valid = values.filter(Number.isFinite)
  if (valid.length === 0) return 0
  const m = valid.reduce((a, b) => a + b, 0) / valid.length
  const variance = valid.reduce((a, b) => a + (b - m) ** 2, 0) / valid.length
  return Math.sqrt(variance)
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function AmbientStatusBeaconStrip({ entries }: { entries: LogEntry[] }) {
  const beacons = useMemo((): BeaconItem[] => {
    const now = Date.now()
    const timed = entries
      .map(e => {
        const tsMs = parseTimestamp(e.timestamp)
        return tsMs == null ? null : { entry: e, tsMs }
      })
      .filter((item): item is { entry: LogEntry; tsMs: number } => item != null)
      .sort((a, b) => b.tsMs - a.tsMs)

    const recent = timed.filter(({ tsMs }) => now - tsMs <= WINDOW_MS)
    const window = recent.length >= 8 ? recent : timed.slice(0, 40)
    if (window.length < 4) return []

    const logEntries = window.map(w => w.entry)

    // ── Error rate ──────────────────────────────────────────────
    const errors = logEntries.filter(e => e.status >= 400 || !!e.error)
    const errorRate = errors.length / logEntries.length
    const errorBeacon: BeaconItem = {
      id: 'error',
      label: 'Error Rate',
      level: errorRate > 0.10 ? 'CRITICAL' : errorRate > 0.03 ? 'WATCH' : 'NOMINAL',
    }

    // ── Tier1 routing drift ─────────────────────────────────────
    const byTier = { tier1: 0, tier2: 0, tier3: 0, unknown: 0 }
    for (const e of logEntries) {
      const t = e.routed_tier
      if (t === 'tier1') byTier.tier1++
      else if (t === 'tier2') byTier.tier2++
      else if (t === 'tier3') byTier.tier3++
      else byTier.unknown++
    }
    const totalTier = byTier.tier1 + byTier.tier2 + byTier.tier3 + byTier.unknown || 1
    const tier1Pct = byTier.tier1 / totalTier
    const tier1Beacon: BeaconItem = {
      id: 'tier1',
      label: 'Tier-1 Load',
      level: tier1Pct > 0.50 ? 'CRITICAL' : tier1Pct > 0.35 ? 'WATCH' : 'NOMINAL',
    }

    // ── Latency jitter (CV) ─────────────────────────────────────
    const latencies = logEntries.map(e => e.latency_ms).filter((l): l is number => typeof l === 'number' && Number.isFinite(l) && l > 0)
    let jitterBeacon: BeaconItem = { id: 'jitter', label: 'Latency Jitter', level: 'NOMINAL' }
    if (latencies.length >= 5) {
      const m = latencies.reduce((a, b) => a + b, 0) / latencies.length
      const s = stddev(latencies)
      const cv = m > 0 ? s / m : 0
      jitterBeacon = {
        id: 'jitter',
        label: 'Latency Jitter',
        level: cv > 0.40 ? 'CRITICAL' : cv > 0.20 ? 'WATCH' : 'NOMINAL',
      }
    }

    // ── Token estimate drift ────────────────────────────────────
    let driftBeacon: BeaconItem = { id: 'token-drift', label: 'Token Drift', level: 'NOMINAL' }
    const pairs: { est: number; actual: number }[] = []
    for (const e of logEntries) {
      const est = typeof e.estimated_tokens === 'number' && e.estimated_tokens > 0 ? e.estimated_tokens : null
      let actual: number | null = null
      if (typeof e.tokens_used === 'number') {
        actual = e.tokens_used
      } else if (typeof e.tokens_used === 'object' && e.tokens_used) {
        const tu = e.tokens_used as { input?: number; output?: number }
        const sum = (tu.input ?? 0) + (tu.output ?? 0)
        actual = sum > 0 ? sum : null
      }
      if (est != null && actual != null) pairs.push({ est, actual })
    }
    if (pairs.length >= 6) {
      const errPcts = pairs.map(p => ((p.actual - p.est) / p.est) * 100)
      const mdErr = median(errPcts)
      const mape = errPcts.reduce((a, b) => a + Math.abs(b), 0) / errPcts.length
      driftBeacon = {
        id: 'token-drift',
        label: 'Token Drift',
        level: mape > 25 || Math.abs(mdErr) > 15 ? 'CRITICAL' : mape > 10 || Math.abs(mdErr) > 8 ? 'WATCH' : 'NOMINAL',
      }
    }

    // ── 429 rate limit beacon ───────────────────────────────────
    const rlEntries = logEntries.filter(e => e.status === 429 || (e.error && e.error.toLowerCase().includes('rate limit')))
    const rlRate = rlEntries.length / logEntries.length
    const rlBeacon: BeaconItem = {
      id: 'rate-limit',
      label: 'Rate Limits',
      level: rlRate > 0.05 ? 'CRITICAL' : rlEntries.length > 0 ? 'WATCH' : 'NOMINAL',
    }

    // ── TTFT spike beacon ────────────────────────────────────────
    let ttftBeacon: BeaconItem = { id: 'ttft', label: 'TTFT Spike', level: 'NOMINAL' }
    const ttfts = logEntries.map(e => e.ttft_ms).filter((t): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0)
    if (ttfts.length >= 4) {
      const p95idx = Math.floor(ttfts.length * 0.95)
      const sorted = [...ttfts].sort((a, b) => a - b)
      const p95 = sorted[p95idx]
      ttftBeacon = {
        id: 'ttft',
        label: 'TTFT Spike',
        level: p95 > 5000 ? 'CRITICAL' : p95 > 2000 ? 'WATCH' : 'NOMINAL',
      }
    }

    return [errorBeacon, tier1Beacon, jitterBeacon, driftBeacon, rlBeacon, ttftBeacon]
  }, [entries])

  const nonNominal = beacons.filter(b => b.level !== 'NOMINAL')
  if (nonNominal.length === 0) return null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.35rem',
      padding: '0.2rem 0.75rem',
      background: 'hsl(225 45% 6%)',
      borderBottom: '1px solid hsl(225 45% 10%)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      overflow: 'hidden',
    }}>
      {/* Ambient pulse bar */}
      <div style={{
        width: 3, height: 16, borderRadius: 2,
        background: 'hsl(38 92% 55%)',
        boxShadow: '0 0 8px hsl(38 92% 55% / 0.8)',
        animation: 'beacon-pulse 1.5s ease-in-out infinite',
        flexShrink: 0,
      }} />

      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: '4.5px',
        color: 'hsl(38 92% 55%)', textTransform: 'uppercase',
        letterSpacing: '0.08em', flexShrink: 0,
      }}>
        {nonNominal.length} Alert{nonNominal.length > 1 ? 's' : ''}
      </span>

      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', overflow: 'hidden' }}>
        {nonNominal.map(b => {
          const meta = BEACON_META[b.level]
          return (
            <div key={b.id} style={{
              display: 'flex', alignItems: 'center', gap: '0.15rem',
              padding: '0.1rem 0.3rem',
              background: `${meta.color}12`,
              border: `1px solid ${meta.color}30`,
              borderRadius: 3,
            }}>
              <div style={{
                width: 4, height: 4, borderRadius: '50%',
                background: meta.color,
                boxShadow: meta.glow,
                animation: b.level === 'CRITICAL' ? 'beacon-blink 0.8s ease-in-out infinite' : 'beacon-pulse 1.5s ease-in-out infinite',
                flexShrink: 0,
              }} />
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '4px',
                color: meta.color, textTransform: 'uppercase',
                letterSpacing: '0.04em', whiteSpace: 'nowrap',
              }}>
                {b.label}
              </span>
            </div>
          )
        })}
      </div>

      <style>{`
        @keyframes beacon-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes beacon-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.1; }
        }
      `}</style>
    </div>
  )
}
