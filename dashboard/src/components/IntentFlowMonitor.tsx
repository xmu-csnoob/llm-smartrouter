import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 15 * 60 * 1000
const MIN_SAMPLES = 15

const CANONICAL_INTENTS = [
  'debug', 'design', 'implementation', 'review',
  'explain', 'generation', 'reasoning', 'general',
] as const
type Intent = typeof CANONICAL_INTENTS[number]

const INTENT_META: Record<Intent, { color: string; abbr: string }> = {
  debug:         { color: 'hsl(200 75% 55%)', abbr: 'DBG' },
  design:        { color: 'hsl(280 65% 65%)', abbr: 'DSN' },
  implementation:{ color: 'hsl(145 65% 55%)', abbr: 'IMP' },
  review:        { color: 'hsl(38 92% 55%)',  abbr: 'REV' },
  explain:      { color: 'hsl(185 80% 55%)', abbr: 'EXP' },
  generation:    { color: 'hsl(30 85% 60%)',  abbr: 'GEN' },
  reasoning:    { color: 'hsl(330 65% 60%)', abbr: 'RSN' },
  general:      { color: 'hsl(225 45% 45%)', abbr: 'GEN2' },
}

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function detectIntent(e: LogEntry): Intent {
  // Prefer semantic_features.intent
  const sf = e.semantic_features
  if (sf?.intent && typeof sf.intent === 'string') {
    const lower = sf.intent.toLowerCase()
    for (const intent of CANONICAL_INTENTS) {
      if (lower.includes(intent)) return intent
    }
  }
  // Fallback to task_type
  const tt = e.task_type
  if (tt && typeof tt === 'string') {
    const lower = tt.toLowerCase()
    for (const intent of CANONICAL_INTENTS) {
      if (lower.includes(intent)) return intent
    }
  }
  return 'general'
}

interface IntentStats {
  intent: Intent
  count: number
  prevCount: number
  delta: number       // fraction: (count - prevCount) / prevCount
  dominantTier: string
  tierCounts: Record<string, number>
  errorRate: number
  avgLatency: number | null
  latencyCount: number
  alignmentScore: number // % landing in expected tier for this intent
  health: 'NOMINAL' | 'WATCH' | 'CRITICAL'
}

interface WindowStats {
  intents: IntentStats[]
  total: number
  windowSize: number
  hasPrevWindow: boolean
}

const TIER_FOR_INTENT: Record<Intent, string> = {
  debug:          'tier3',
  design:         'tier1',
  implementation: 'tier2',
  review:         'tier2',
  explain:        'tier3',
  generation:     'tier2',
  reasoning:      'tier1',
  general:        'tier3',
}

function fmtDelta(d: number): string {
  if (!Number.isFinite(d)) return '—'
  const sign = d >= 0 ? '+' : ''
  return `${sign}${(d * 100).toFixed(0)}%`
}

export function IntentFlowMonitor({ entries }: { entries: LogEntry[] }) {
  const stats = useMemo((): WindowStats | null => {
    const now = Date.now()
    const timed = entries
      .map(e => {
        const tsMs = parseTimestamp(e.timestamp)
        return tsMs == null ? null : { entry: e, tsMs }
      })
      .filter((item): item is { entry: LogEntry; tsMs: number } => item != null)
      .sort((a, b) => b.tsMs - a.tsMs)

    const recent = timed.filter(({ tsMs }) => now - tsMs <= WINDOW_MS)
    const window = recent.length >= MIN_SAMPLES ? recent : timed.slice(0, 80)
    if (window.length < MIN_SAMPLES) return null

    const midIdx = Math.floor(window.length / 2)
    const prevHalf = window.slice(midIdx)

    const hasPrevWindow = prevHalf.length >= 5

    const logEntries = window.map(w => w.entry)

    const intentMap = new Map<Intent, {
      count: number
      prevCount: number
      tierCounts: Record<string, number>
      errorCount: number
      latencySum: number
      latencyCount: number
      alignedCount: number
    }>()

    for (const intent of CANONICAL_INTENTS) {
      intentMap.set(intent, {
        count: 0, prevCount: 0,
        tierCounts: {},
        errorCount: 0,
        latencySum: 0, latencyCount: 0,
        alignedCount: 0,
      })
    }

    for (const e of logEntries) {
      const intent = detectIntent(e)
      const m = intentMap.get(intent)!
      m.count++
      const tier = e.routed_tier || 'unknown'
      m.tierCounts[tier] = (m.tierCounts[tier] || 0) + 1
      if (e.status >= 400 || !!e.error) m.errorCount++
      if (typeof e.latency_ms === 'number' && Number.isFinite(e.latency_ms) && e.latency_ms > 0) {
        m.latencySum += e.latency_ms
        m.latencyCount++
      }
      // Alignment: did this intent land in the expected tier?
      const expectedTier = TIER_FOR_INTENT[intent]
      if (tier === expectedTier) m.alignedCount++
    }

    if (hasPrevWindow) {
      for (const e of prevHalf.map(w => w.entry)) {
        const intent = detectIntent(e)
        const m = intentMap.get(intent)!
        m.prevCount++
      }
    }

    const total = logEntries.length
    const intents: IntentStats[] = CANONICAL_INTENTS
      .map(intent => {
        const m = intentMap.get(intent)!
        const dominantTier = Object.entries(m.tierCounts)
          .sort((a, b) => b[1] - a[1])[0]?.[0] || '—'
        const errRate = m.count > 0 ? m.errorCount / m.count : 0
        const latAvg = m.latencyCount > 0 ? m.latencySum / m.latencyCount : null
        const delta = m.prevCount > 0 ? (m.count - m.prevCount) / m.prevCount : 0
        const alignmentScore = m.count > 0 ? m.alignedCount / m.count : 0
        let health: 'NOMINAL' | 'WATCH' | 'CRITICAL' = 'NOMINAL'
        if (errRate > 0.10 || alignmentScore < 0.5) health = 'CRITICAL'
        else if (errRate > 0.03 || alignmentScore < 0.7) health = 'WATCH'
        return {
          intent,
          count: m.count,
          prevCount: m.prevCount,
          delta,
          dominantTier,
          tierCounts: m.tierCounts,
          errorRate: errRate,
          avgLatency: latAvg,
          latencyCount: m.latencyCount,
          alignmentScore,
          health,
        } satisfies IntentStats
      })
      .filter(s => s.count > 0)
      .sort((a, b) => b.count - a.count)

    if (intents.length === 0) return null
    return { intents, total, windowSize: window.length, hasPrevWindow }
  }, [entries])

  if (!stats) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '982ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT INTENT DATA
        </div>
      </div>
    )
  }

  const { intents, total, windowSize, hasPrevWindow } = stats

  const healthColor = (h: 'NOMINAL' | 'WATCH' | 'CRITICAL') =>
    h === 'CRITICAL' ? 'hsl(0 72% 55%)' : h === 'WATCH' ? 'hsl(38 92% 55%)' : 'hsl(145 65% 55%)'

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '982ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Intent Flow Monitor
        </span>
        <div style={{ display: 'flex', gap: '0.15rem' }}>
          {([
            { label: total, color: 'hsl(185 80% 55%)' },
          ] as const).map(({ label, color }) => (
            <span key="total" style={{
              fontSize: '5px', fontFamily: 'var(--font-mono)',
              color, background: `${color}15`,
              border: `1px solid ${color}30`,
              borderRadius: 2, padding: '2px 5px',
            }}>
              {label} req
            </span>
          ))}
        </div>
      </div>

      {/* Column headers */}
      <div style={{ display: 'flex', gap: '0.06rem', padding: '0.04rem 0.08rem', borderBottom: '1px solid hsl(225 45% 12%)' }}>
        {['INTENT', 'N', 'Δ', 'TIER', 'ERR%', 'LAT', 'ALIGN', 'HEALTH'].map((h, i) => (
          <span key={h} style={{
            fontSize: '3.5px', fontFamily: 'var(--font-mono)',
            color: 'hsl(145 65% 40%)', letterSpacing: '0.04em',
            flex: i === 0 ? 2 : 1,
            textAlign: i === 4 || i === 5 ? 'right' : 'left',
          }}>{h}</span>
        ))}
      </div>

      {/* Intent rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.04rem' }}>
        {intents.map((s) => {
          const meta = INTENT_META[s.intent]
          const hc = healthColor(s.health)
          const alignColor = s.alignmentScore >= 0.8 ? 'hsl(145 65% 55%)'
            : s.alignmentScore >= 0.6 ? 'hsl(38 92% 55%)'
            : 'hsl(0 72% 55%)'
          const tierColor = s.dominantTier === 'tier1' ? 'hsl(280 65% 65%)'
            : s.dominantTier === 'tier2' ? 'hsl(185 80% 55%)'
            : s.dominantTier === 'tier3' ? 'hsl(145 65% 55%)'
            : 'hsl(225 45% 35%)'
          const pct = (s.count / total * 100).toFixed(0)
          const deltaColor = s.delta > 0.05 ? 'hsl(0 72% 60%)'
            : s.delta < -0.05 ? 'hsl(145 65% 55%)'
            : 'hsl(225 45% 40%)'
          return (
            <div key={s.intent} style={{
              display: 'flex', gap: '0.06rem', padding: '0.05rem 0.08rem',
              borderRadius: 2, alignItems: 'center',
              background: s.health === 'CRITICAL' ? 'hsl(0 72% 55% / 0.08)'
                : s.health === 'WATCH' ? 'hsl(38 92% 55% / 0.06)'
                : 'transparent',
            }}>
              {/* Rank + intent badge */}
              <span style={{
                flex: 2, fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: meta.color, fontWeight: 700, display: 'flex',
                alignItems: 'center', gap: '3px',
              }}>
                <span style={{
                  background: `${meta.color}20`,
                  border: `1px solid ${meta.color}40`,
                  borderRadius: 2, padding: '1px 3px',
                  fontSize: '3.5px', letterSpacing: '0.04em',
                }}>
                  {meta.abbr}
                </span>
                <span style={{ color: 'hsl(225 45% 60%)', fontWeight: 400 }}>
                  {pct}%
                </span>
              </span>
              {/* Count */}
              <span style={{
                flex: 1, fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: 'var(--foreground)', textAlign: 'center', fontWeight: 700,
              }}>
                {s.count}
              </span>
              {/* Delta */}
              <span style={{
                flex: 1, fontSize: '4.5px', fontFamily: 'var(--font-mono)',
                color: deltaColor, textAlign: 'center',
                fontWeight: Math.abs(s.delta) > 0.05 ? 700 : 400,
              }}>
                {hasPrevWindow ? fmtDelta(s.delta) : '—'}
              </span>
              {/* Dominant tier */}
              <span style={{
                flex: 1, fontSize: '4px', fontFamily: 'var(--font-mono)',
                color: tierColor, textAlign: 'center', fontWeight: 700,
              }}>
                {s.dominantTier === '—' ? '—' : s.dominantTier.replace('tier', 'T')}
              </span>
              {/* Error rate */}
              <span style={{
                flex: 1, fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: s.errorRate > 0.05 ? 'hsl(0 72% 60%)' : 'hsl(145 65% 55%)',
                textAlign: 'right', fontWeight: s.errorRate > 0.05 ? 700 : 400,
              }}>
                {(s.errorRate * 100).toFixed(1)}%
              </span>
              {/* Latency */}
              <span style={{
                flex: 1, fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 50%)', textAlign: 'right',
              }}>
                {s.avgLatency === null ? '—'
                  : s.avgLatency >= 1000 ? `${(s.avgLatency / 1000).toFixed(1)}s`
                  : `${Math.round(s.avgLatency)}ms`}
              </span>
              {/* Alignment score */}
              <span style={{
                flex: 1, fontSize: '4.5px', fontFamily: 'var(--font-mono)',
                color: alignColor, textAlign: 'center', fontWeight: 600,
              }}>
                {(s.alignmentScore * 100).toFixed(0)}%
              </span>
              {/* Health */}
              <span style={{
                flex: 1, fontSize: '4px', fontFamily: 'var(--font-mono)',
                color: hc, textAlign: 'center', fontWeight: 700,
              }}>
                {s.health === 'NOMINAL' ? 'OK' : s.health === 'WATCH' ? 'WARN' : 'BAD'}
              </span>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '5px',
        color: 'var(--muted-foreground)', textAlign: 'right', opacity: 0.7,
      }}>
        {windowSize} entries · 15-min window · Δ vs prior half-window · align: intent→expected tier
      </div>
    </div>
  )
}
