import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 15 * 60 * 1000
const MIN_SAMPLES = 10

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

interface ComplexityFlag {
  key: string
  label: string
  color: string
  total: number
  count: number
  rate: number
  byTier: Record<string, number>
  topRequests: Array<{
    requestId: string
    tier: string
    status: number
    tsMs: number
  }>
}

interface ComplexityStats {
  flags: ComplexityFlag[]
  total: number
  windowSize: number
  compositeCount: number
  compositeRate: number
}

const COMPLEXITY_FLAGS: Array<{ key: string; label: string; color: string }> = [
  { key: 'is_followup', label: 'FOLLOWUP', color: 'hsl(280 65% 65%)' },
  { key: 'cross_file_analysis', label: 'CROSS-FILE', color: 'hsl(38 92% 55%)' },
  { key: 'requires_reasoning', label: 'REASONING', color: 'hsl(185 80% 55%)' },
]

const tierColor = (tier: string) =>
  tier === 'tier1' ? 'hsl(280 65% 65%)'
  : tier === 'tier2' ? 'hsl(185 80% 55%)'
  : tier === 'tier3' ? 'hsl(145 65% 55%)'
  : 'hsl(225 45% 40%)'

function getNestedValue<T>(obj: unknown, path: string): T | undefined {
  const parts = path.split('.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let val: any = obj
  for (const part of parts) {
    if (val == null) return undefined
    val = val[part]
  }
  return val as T
}

export function ContextComplexityProfile({ entries }: { entries: LogEntry[] }) {
  const stats = useMemo((): ComplexityStats | null => {
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

    const flagMap: Record<string, ComplexityFlag> = {}
    for (const { key, label, color } of COMPLEXITY_FLAGS) {
      flagMap[key] = { key, label, color, total: 0, count: 0, rate: 0, byTier: {}, topRequests: [] }
    }

    let compositeCount = 0

    for (const { entry, tsMs } of window) {
      const tier = entry.routed_tier || 'unknown'
      const sf = entry.semantic_features

      let flagCount = 0

      for (const { key } of COMPLEXITY_FLAGS) {
        const flag = flagMap[key]
        const rawVal = sf ? getNestedValue<boolean>(sf, key) : undefined
        if (rawVal === true) {
          flag.count++
          flag.total++
          flag.byTier[tier] = (flag.byTier[tier] || 0) + 1
          if (flag.topRequests.length < 4) {
            flag.topRequests.push({
              requestId: entry.request_id.slice(-6),
              tier,
              status: entry.status,
              tsMs,
            })
          }
          flagCount++
        } else {
          flag.total++
        }
      }

      if (flagCount >= 2) compositeCount++
    }

    const flags = COMPLEXITY_FLAGS.map(({ key, label, color }) => {
      const f = flagMap[key]
      return {
        ...f,
        label,
        color,
        rate: f.total > 0 ? f.count / f.total : 0,
      }
    })

    return {
      flags,
      total,
      windowSize: window.length,
      compositeCount,
      compositeRate: total > 0 ? compositeCount / total : 0,
    }
  }, [entries])

  if (!stats) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '984ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT COMPLEXITY DATA
        </div>
      </div>
    )
  }

  const { flags, total, windowSize, compositeRate } = stats
  const maxRate = Math.max(...flags.map(f => f.rate), 0.01)

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.15rem', animation: 'fade-in-up 400ms ease both', animationDelay: '984ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Context Complexity
        </span>
        <div style={{ display: 'flex', gap: '0.15rem', alignItems: 'center' }}>
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: compositeRate > 0.15 ? 'hsl(38 92% 55%)' : 'hsl(145 65% 55%)',
            background: compositeRate > 0.15 ? 'hsl(38 92% 55% / 0.15)' : 'hsl(145 65% 55% / 0.15)',
            border: `1px solid ${compositeRate > 0.15 ? 'hsl(38 92% 55% / 0.3)' : 'hsl(145 65% 55% / 0.3)'}`,
            borderRadius: 2, padding: '2px 5px',
            fontWeight: 700,
          }}>
            {compositeRate > 0 ? `${(compositeRate * 100).toFixed(0)}%` : '0%'} multi-flag
          </span>
        </div>
      </div>

      {/* Flag rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.08rem' }}>
        {flags.map(f => {
          const barPct = (f.rate / maxRate) * 100
          const isActive = f.rate > 0
          return (
            <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
                <span style={{
                  width: 32, fontSize: '3.5px', fontFamily: 'var(--font-mono)',
                  color: f.color, flexShrink: 0, fontWeight: 700,
                  letterSpacing: '0.03em',
                }}>
                  {f.label}
                </span>
                <div style={{
                  flex: 1, height: 5, background: 'hsl(225 45% 10%)',
                  borderRadius: 2, overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${barPct.toFixed(1)}%`,
                    background: f.color,
                    borderRadius: 2,
                    boxShadow: `0 0 4px ${f.color}50`,
                    opacity: isActive ? 1 : 0.2,
                  }} />
                </div>
                <span style={{ width: 16, fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 45%)', textAlign: 'right' }}>
                  {f.rate > 0 ? `${(f.rate * 100).toFixed(0)}%` : '—'}
                </span>
                <span style={{ width: 14, fontSize: '3.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)', textAlign: 'right' }}>
                  {f.count}/{total}
                </span>
              </div>

              {/* Tier breakdown */}
              {Object.keys(f.byTier).length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem', paddingLeft: 32 }}>
                  <span style={{ fontSize: '3px', color: 'hsl(225 45% 20%)' }}>→</span>
                  {Object.entries(f.byTier).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([tier, cnt]) => (
                    <span key={tier} style={{
                      fontSize: '3px', fontFamily: 'var(--font-mono)',
                      color: tierColor(tier), fontWeight: 700,
                    }}>
                      {tier.replace('tier', 'T')}{cnt}
                    </span>
                  ))}
                </div>
              )}

              {/* Top request IDs */}
              {f.topRequests.length > 0 && (
                <div style={{ display: 'flex', gap: '0.08rem', paddingLeft: 32, flexWrap: 'wrap' }}>
                  {f.topRequests.map(r => (
                    <span key={r.requestId} style={{
                      fontSize: '3px', fontFamily: 'var(--font-mono)',
                      color: r.status >= 400 ? 'hsl(0 72% 60%)' : f.color,
                      background: r.status >= 400 ? 'hsl(0 72% 55% / 0.08)' : `${f.color}15`,
                      borderRadius: 2, padding: '1px 3px',
                    }}>
                      {r.requestId}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '5px',
        color: 'var(--muted-foreground)', textAlign: 'right', opacity: 0.7,
      }}>
        {windowSize} entries · 15-min window · is_followup × cross_file_analysis × requires_reasoning
      </div>
    </div>
  )
}
