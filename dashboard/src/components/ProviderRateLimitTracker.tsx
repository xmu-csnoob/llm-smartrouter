import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 5 * 60 * 1000
const MIN_SAMPLES = 10
const MAX_ENTRIES = 50
const SPARKLINE_LIMIT = 12

type RlState = 'NOMINAL' | 'WATCH' | 'CRITICAL'

const STATE_META: Record<RlState, { color: string; bg: string; label: string }> = {
  NOMINAL: { color: 'hsl(145 65% 55%)', bg: 'hsl(145 65% 55% / 0.12)',  label: 'Nominal' },
  WATCH:   { color: 'hsl(38 92% 55%)',  bg: 'hsl(38 92% 55% / 0.12)',   label: 'Watch' },
  CRITICAL:{ color: 'hsl(0 72% 55%)',   bg: 'hsl(0 72% 55% / 0.12)',    label: 'Critical' },
}

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function Sparkline({ values, color, width = 60, height = 16 }: { values: number[]; color: string; width?: number; height?: number }) {
  const finite = values.filter(Number.isFinite)
  if (finite.length < 2) return <svg width={width} height={height} />
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const range = max - min || 1
  const xScale = Math.max(width - 1, 1)
  const yScale = Math.max(height - 2, 1)
  const pts = finite.map((v, i) => {
    const x = finite.length === 1 ? 0 : (i / (finite.length - 1)) * xScale
    const y = 1 + (yScale - ((v - min) / range) * yScale)
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

interface TimedEntry {
  entry: LogEntry
  tsMs: number
}

interface ProviderRl {
  provider: string
  totalCount: number
  rlCount: number
  rlPct: number
  state: RlState
  sparkValues: number[]
  sampleCount: number
}

interface RlStats {
  overallState: RlState
  providers: ProviderRl[]
  totalRlCount: number
  windowSize: number
}

export function ProviderRateLimitTracker({ entries }: { entries: LogEntry[] }) {
  const stats = useMemo((): RlStats | null => {
    const now = Date.now()
    const timed: TimedEntry[] = entries
      .map((e) => {
        const tsMs = parseTimestamp(e.timestamp)
        return tsMs == null ? null : { entry: e, tsMs }
      })
      .filter((item): item is TimedEntry => item != null)
      .sort((a, b) => b.tsMs - a.tsMs)

    const recent = timed.filter(({ tsMs }) => {
      const age = now - tsMs
      return age >= 0 && age <= WINDOW_MS
    })

    if (recent.length < MIN_SAMPLES) {
      const source = timed.slice(0, Math.min(MIN_SAMPLES, timed.length))
      if (source.length < MIN_SAMPLES) return null
      return buildStats(source.map(({ entry }) => entry))
    }
    return buildStats(recent.slice(0, MAX_ENTRIES).map(({ entry }) => entry))
  }, [entries])

  function buildStats(windowEntries: LogEntry[]): RlStats | null {
    if (windowEntries.length < MIN_SAMPLES) return null

    // Per-provider stats
    const byProvider = new Map<string, { total: number; rl: number; series: { total: number; rl: number }[] }>()

    // Build time slices for sparklines
    const sliceSize = Math.max(1, Math.floor(windowEntries.length / SPARKLINE_LIMIT))
    const slices: LogEntry[][] = []
    for (let i = 0; i < windowEntries.length; i += sliceSize) {
      slices.push(windowEntries.slice(i, i + sliceSize))
    }

    for (const entry of windowEntries) {
      const provider = entry.routed_provider || 'unknown'
      if (!byProvider.has(provider)) {
        byProvider.set(provider, { total: 0, rl: 0, series: slices.map(() => ({ total: 0, rl: 0 })) })
      }
      const p = byProvider.get(provider)!
      p.total++
      if (entry.status === 429 || (entry.error && entry.error.toLowerCase().includes('rate limit'))) {
        p.rl++
      }
    }

    // Per-slice per-provider 429 rate for sparklines
    for (let si = 0; si < slices.length; si++) {
      const slice = slices[si]
      for (const [provider, p] of byProvider) {
        const inSlice = slice.filter(e => (e.routed_provider || 'unknown') === provider)
        const rlInSlice = inSlice.filter(e => e.status === 429 || (e.error && e.error.toLowerCase().includes('rate limit')))
        p.series[si] = { total: inSlice.length, rl: rlInSlice.length }
      }
    }

    const providers: ProviderRl[] = []
    let totalRlCount = 0

    for (const [provider, p] of byProvider) {
      const rlPct = p.total > 0 ? (p.rl / p.total) * 100 : 0
      const state: RlState = rlPct === 0 ? 'NOMINAL' : rlPct < 5 ? 'WATCH' : 'CRITICAL'
      const sparkValues = p.series.map(s => s.total > 0 ? (s.rl / s.total) * 100 : 0)
      providers.push({
        provider,
        totalCount: p.total,
        rlCount: p.rl,
        rlPct,
        state,
        sparkValues,
        sampleCount: p.total,
      })
      totalRlCount += p.rl
    }

    providers.sort((a, b) => b.rlPct - a.rlPct)

    const worstState = providers.length > 0
      ? providers.reduce((worst, p) => {
          const order: RlState[] = ['NOMINAL', 'WATCH', 'CRITICAL']
          return order.indexOf(p.state) > order.indexOf(worst) ? p.state : worst
        }, 'NOMINAL' as RlState)
      : 'NOMINAL'

    return {
      overallState: worstState,
      providers,
      totalRlCount,
      windowSize: windowEntries.length,
    }
  }

  if (!stats) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '964ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT RATE-LIMIT DATA
        </div>
      </div>
    )
  }

  const { overallState, providers, totalRlCount, windowSize } = stats
  const meta = STATE_META[overallState]

  const fmtPct = (v: number) => `${v.toFixed(1)}%`

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '964ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Rate Limit Tracker
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          {overallState === 'CRITICAL' && (
            <span style={{
              width: '5px', height: '5px', borderRadius: '50%',
              background: meta.color,
              animation: 'pulse 1s ease-in-out infinite',
              display: 'inline-block',
            }} />
          )}
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: meta.color,
            background: `${meta.color}15`,
            border: `1px solid ${meta.color}30`,
            borderRadius: 2, padding: '2px 5px',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {meta.label}
          </span>
        </div>
      </div>

      {/* Summary row */}
      <div style={{ display: 'flex', gap: '0.3rem', padding: '0.12rem 0.25rem', background: 'hsl(225 45% 8%)', borderRadius: 3 }}>
        {([
          { label: '429s', value: totalRlCount, color: totalRlCount > 0 ? 'hsl(0 72% 55%)' : 'hsl(145 65% 55%)' },
          { label: 'Providers', value: providers.length, color: 'var(--foreground)' },
          { label: 'Entries', value: windowSize, color: 'var(--foreground)' },
          { label: 'Active RL', value: providers.filter(p => p.rlCount > 0).length, color: providers.filter(p => p.rlCount > 0).length > 0 ? 'hsl(38 92% 55%)' : 'hsl(145 65% 55%)' },
        ] as const).map(({ label, value, color }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center' }}>
            <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {label}
            </span>
            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 700, color, textShadow: `0 0 6px ${color}50` }}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Per-provider rate-limit list */}
      {providers.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.06rem' }}>
          {/* Column header */}
          <div style={{ display: 'flex', gap: '0.1rem', padding: '0.04rem 0.08rem', borderBottom: '1px solid hsl(225 45% 12%)' }}>
            {['PROVIDER', '429s', 'RATE', 'TREND', ''].map((h, i) => (
              <span key={h} style={{
                fontSize: '3.5px', fontFamily: 'var(--font-mono)',
                color: 'hsl(145 65% 40%)', letterSpacing: '0.04em',
                flex: i === 0 ? 1.5 : 1,
                textAlign: i === 1 || i === 2 ? 'right' : 'left',
              }}>{h}</span>
            ))}
          </div>
          {providers.slice(0, 6).map((p) => {
            const pm = STATE_META[p.state]
            return (
              <div key={p.provider} style={{
                display: 'flex', gap: '0.1rem', padding: '0.06rem 0.08rem',
                borderRadius: 2, alignItems: 'center',
                background: p.state === 'CRITICAL' ? 'hsl(0 72% 55% / 0.05)'
                  : p.state === 'WATCH' ? 'hsl(38 92% 55% / 0.04)'
                  : 'transparent',
              }}>
                <span style={{
                  flex: 1.5, fontSize: '5px', fontFamily: 'var(--font-mono)',
                  color: 'hsl(225 45% 50%)', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {p.provider}
                </span>
                <span style={{
                  flex: 1, fontSize: '5px', fontFamily: 'var(--font-mono)',
                  color: p.rlCount > 0 ? 'hsl(0 72% 60%)' : 'hsl(225 45% 30%)',
                  textAlign: 'right', fontWeight: p.rlCount > 0 ? 700 : 400,
                }}>
                  {p.rlCount}
                </span>
                <span style={{
                  flex: 1, fontSize: '5.5px', fontFamily: 'var(--font-mono)',
                  color: pm.color, textAlign: 'right', fontWeight: 700,
                  textShadow: `0 0 4px ${pm.color}50`,
                }}>
                  {fmtPct(p.rlPct)}
                </span>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  <Sparkline
                    values={p.sparkValues}
                    color={pm.color}
                    width={36}
                    height={12}
                  />
                </div>
                <span style={{ width: 12, fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)', textAlign: 'right' }}>
                  {p.sampleCount}
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem', color: 'hsl(145 65% 40%)', fontFamily: 'var(--font-mono)', fontSize: '5px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          No rate limits detected
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'flex-end' }}>
        {([
          { label: '0%', state: 'NOMINAL' as RlState },
          { label: '0–5%', state: 'WATCH' as RlState },
          { label: '>5%', state: 'CRITICAL' as RlState },
        ]).map(({ label, state }) => (
          <div key={state} style={{ display: 'flex', alignItems: 'center', gap: '0.08rem' }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: STATE_META[state].color }} />
            <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '5px',
        color: 'var(--muted-foreground)', textAlign: 'right', opacity: 0.7,
      }}>
        {windowSize} entries · 5-min window · n≥{MIN_SAMPLES}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
