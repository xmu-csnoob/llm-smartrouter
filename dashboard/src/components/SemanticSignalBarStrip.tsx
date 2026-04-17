import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 15 * 60 * 1000
const MIN_SAMPLES = 10

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

const SIGNAL_KEYS = [
  'debug_signal_count',
  'design_signal_count',
  'implementation_signal_count',
  'review_signal_count',
  'explain_signal_count',
  'generation_signal_count',
  'reasoning_signal_count',
  'constraint_signal_count',
  'performance_signal_count',
] as const

type SignalKey = typeof SIGNAL_KEYS[number]

const SIGNAL_LABELS: Record<SignalKey, string> = {
  debug_signal_count: 'DEBUG',
  design_signal_count: 'DESIGN',
  implementation_signal_count: 'IMPL',
  review_signal_count: 'REVIEW',
  explain_signal_count: 'EXPLAIN',
  generation_signal_count: 'GEN',
  reasoning_signal_count: 'REASON',
  constraint_signal_count: 'CONST',
  performance_signal_count: 'PERF',
}

const SIGNAL_COLORS: Record<SignalKey, string> = {
  debug_signal_count: 'hsl(38 92% 55%)',
  design_signal_count: 'hsl(280 65% 65%)',
  implementation_signal_count: 'hsl(200 75% 55%)',
  review_signal_count: 'hsl(145 65% 55%)',
  explain_signal_count: 'hsl(185 80% 55%)',
  generation_signal_count: 'hsl(260 65% 60%)',
  reasoning_signal_count: 'hsl(30 85% 60%)',
  constraint_signal_count: 'hsl(15 80% 55%)',
  performance_signal_count: 'hsl(0 72% 55%)',
}

interface SignalStat {
  key: SignalKey
  total: number
  avg: number
  count: number
}

interface SignalStats {
  signals: SignalStat[]
  total: number
  windowSize: number
  topSignal: SignalKey | null
  dominantSignal: SignalKey | null
}

export function SemanticSignalBarStrip({ entries }: { entries: LogEntry[] }) {
  const stats = useMemo((): SignalStats | null => {
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

    const logEntries = window.map(w => w.entry)
    const total = logEntries.length

    const signalTotals: Record<SignalKey, number> = {} as Record<SignalKey, number>
    const signalCounts: Record<SignalKey, number> = {} as Record<SignalKey, number>
    for (const key of SIGNAL_KEYS) {
      signalTotals[key] = 0
      signalCounts[key] = 0
    }

    for (const entry of logEntries) {
      const sf = entry.semantic_features
      if (!sf) continue
      for (const key of SIGNAL_KEYS) {
        const val = sf[key]
        if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
          signalTotals[key] += val
          signalCounts[key]++
        }
      }
    }

    const signals: SignalStat[] = SIGNAL_KEYS.map(key => ({
      key,
      total: signalTotals[key],
      avg: signalCounts[key] > 0 ? signalTotals[key] / signalCounts[key] : 0,
      count: signalCounts[key],
    })).filter(s => s.count > 0)

    signals.sort((a, b) => b.avg - a.avg)

    const topSignal = signals.length > 0 ? signals[0].key : null
    const dominantSignal = signals.length > 0 && signals[0].avg > 2 ? signals[0].key : null

    return { signals, total, windowSize: window.length, topSignal, dominantSignal }
  }, [entries])

  if (!stats) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '985ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT SIGNAL DATA
        </div>
      </div>
    )
  }

  const { signals, total, windowSize, topSignal, dominantSignal } = stats
  const maxAvg = Math.max(...signals.map(s => s.avg), 0.01)

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.15rem', animation: 'fade-in-up 400ms ease both', animationDelay: '985ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Signal Signature
        </span>
        <div style={{ display: 'flex', gap: '0.15rem', alignItems: 'center' }}>
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: 'hsl(225 45% 60%)',
            background: 'hsl(225 45% 8%)',
            border: '1px solid hsl(225 45% 15%)',
            borderRadius: 2, padding: '2px 5px',
          }}>
            {total} total
          </span>
          {dominantSignal && (
            <span style={{
              fontSize: '5px', fontFamily: 'var(--font-mono)',
              color: SIGNAL_COLORS[dominantSignal],
              background: `${SIGNAL_COLORS[dominantSignal]}15`,
              border: `1px solid ${SIGNAL_COLORS[dominantSignal]}30`,
              borderRadius: 2, padding: '2px 5px',
              fontWeight: 700,
            }}>
              {SIGNAL_LABELS[dominantSignal]}
            </span>
          )}
        </div>
      </div>

      {/* Signal bars — ranked by avg */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.06rem' }}>
        {signals.map(s => {
          const sc = SIGNAL_COLORS[s.key]
          const barPct = (s.avg / maxAvg) * 100
          const isTop = s.key === topSignal
          return (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
              <span style={{
                width: 26, fontSize: '3.5px', fontFamily: 'var(--font-mono)',
                color: sc, flexShrink: 0, fontWeight: isTop ? 700 : 400,
                letterSpacing: '0.03em',
              }}>
                {SIGNAL_LABELS[s.key]}
              </span>
              <div style={{
                flex: 1, height: 5, background: 'hsl(225 45% 10%)',
                borderRadius: 2, overflow: 'hidden', position: 'relative',
              }}>
                <div style={{
                  position: 'absolute',
                  left: 0, top: 0, bottom: 0,
                  width: `${barPct.toFixed(1)}%`,
                  background: sc,
                  borderRadius: 2,
                  boxShadow: isTop ? `0 0 4px ${sc}60` : 'none',
                  opacity: isTop ? 1 : 0.65,
                }} />
              </div>
              <span style={{
                width: 18, fontSize: '3.5px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 45%)', textAlign: 'right',
                fontWeight: isTop ? 700 : 400,
              }}>
                {s.avg.toFixed(1)}
              </span>
              <span style={{
                width: 10, fontSize: '3px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 25%)', textAlign: 'right',
              }}>
                ×{s.count}
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
        {windowSize} entries · 15-min window · semantic_features.*_signal_count avg
      </div>
    </div>
  )
}
