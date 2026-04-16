import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const INTENT_ORDER = ['simple', 'debug', 'implementation', 'architecture', 'analysis', 'general'] as const
type Intent = typeof INTENT_ORDER[number]

const INTENT_LABELS: Record<Intent, string> = {
  simple: 'Simp',
  debug: 'Debug',
  implementation: 'Impl',
  architecture: 'Arch',
  analysis: 'Anal',
  general: 'Gen',
}

const INTENT_COLORS: Record<Intent, string> = {
  simple: 'hsl(145 65% 55%)',
  debug: 'hsl(38 92% 55%)',
  implementation: 'hsl(200 75% 55%)',
  architecture: 'hsl(280 65% 65%)',
  analysis: 'hsl(260 65% 55%)',
  general: 'hsl(0 0% 55%)',
}

const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  const h = i % 12 || 12
  const suffix = i < 12 ? 'a' : 'p'
  return `${h}${suffix}`
})

const MIN_SAMPLE = 3

interface HourBar {
  hour: number
  label: string
  counts: Record<Intent, number>
  total: number
  dominant: Intent | null
  isPeak: boolean // among non-zero hours, top 3 by total are "peak"
}

function IntentBar({ bar }: { bar: HourBar }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.25rem',
      padding: '0.06rem 0.15rem',
      borderRadius: 3,
      background: bar.isPeak ? 'hsl(280 65% 8% / 0.3)' : 'transparent',
      borderBottom: '1px solid hsl(225 45% 10%)',
      transition: 'background 200ms ease',
    }}>
      {/* Hour label */}
      <div style={{
        fontSize: '6px', fontFamily: 'var(--font-mono)',
        color: bar.isPeak ? 'hsl(280 65% 65%)' : 'var(--muted-foreground)',
        width: 20, flexShrink: 0,
        fontWeight: bar.isPeak ? 700 : 400,
      }}>
        {bar.label}
      </div>

      {/* Stacked bar */}
      <div style={{
        flex: 1,
        height: 8,
        background: 'hsl(225 45% 10%)',
        borderRadius: 3,
        overflow: 'hidden',
        display: 'flex',
      }}>
        {INTENT_ORDER.map(intent => {
          const count = bar.counts[intent]
          if (count === 0) return null
          const pct = bar.total > 0 ? count / bar.total : 0
          return (
            <div
              key={intent}
              style={{
                width: `${pct * 100}%`,
                height: '100%',
                background: INTENT_COLORS[intent],
                opacity: 0.75,
                transition: 'width 500ms cubic-bezier(0.34, 1.2, 0.64, 1)',
              }}
              title={`${INTENT_LABELS[intent]}: ${count}`}
            />
          )
        })}
      </div>

      {/* Total count */}
      <div style={{
        fontSize: '6px', fontFamily: 'var(--font-mono)',
        color: bar.total > 0 ? 'var(--muted-foreground)' : 'hsl(225 45% 15%)',
        width: 20, flexShrink: 0, textAlign: 'right',
        fontWeight: bar.isPeak ? 700 : 400,
      }}>
        {bar.total > 0 ? bar.total : '—'}
      </div>

      {/* Dominant intent badge */}
      {bar.dominant && bar.total >= MIN_SAMPLE && (
        <div style={{
          fontSize: '5px', fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          color: INTENT_COLORS[bar.dominant],
          width: 24, flexShrink: 0, textAlign: 'right',
          background: `${INTENT_COLORS[bar.dominant]}15`,
          borderRadius: 2,
          padding: '0 2px',
        }}>
          {INTENT_LABELS[bar.dominant]}
        </div>
      )}
      {(!bar.dominant || bar.total < MIN_SAMPLE) && (
        <div style={{ width: 24, flexShrink: 0 }} />
      )}
    </div>
  )
}

export function HourlyIntentComposition({ entries }: Props) {
  const { bars, peakHours, totalEntries } = useMemo(() => {
    const hourBuckets: Record<number, Record<Intent, number>> = {}
    for (let h = 0; h < 24; h++) hourBuckets[h] = { simple: 0, debug: 0, implementation: 0, architecture: 0, analysis: 0, general: 0 }

    let validEntries = 0
    for (const entry of entries) {
      const ts = entry.timestamp ? new Date(entry.timestamp) : null
      if (!ts || isNaN(ts.getTime())) continue
      const hour = ts.getHours()
      const intent = (entry.semantic_features?.intent ?? entry.task_type ?? 'general') as Intent
      if (intent in hourBuckets[hour]) {
        hourBuckets[hour][intent]++
        validEntries++
      }
    }

    const hourTotals = Object.fromEntries(
      Object.entries(hourBuckets).map(([h, counts]) => [h, Object.values(counts).reduce((a, b) => a + b, 0)])
    )

    // Peak hours: top 3 by total volume
    const sortedHours = Object.entries(hourTotals)
      .filter(([, t]) => t > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([h]) => parseInt(h))
    const peakSet = new Set(sortedHours)

    const bars: HourBar[] = Array.from({ length: 24 }, (_, i) => {
      const counts = hourBuckets[i]
      const total = hourTotals[i]
      const dominant = (Object.entries(counts).sort(([, a], [, b]) => b - a)[0][0] as Intent)
      const isPeak = peakSet.has(i)
      return {
        hour: i,
        label: HOUR_LABELS[i],
        counts,
        total,
        dominant: total > 0 ? dominant : null,
        isPeak,
      }
    })

    return { bars, peakHours: sortedHours.length, totalEntries: validEntries }
  }, [entries])

  const hasData = totalEntries > 0

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '920ms',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{
            fontSize: '9px', fontFamily: 'var(--font-mono)',
            color: 'var(--muted-foreground)', textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            Intent by Hour
          </span>
          {peakHours > 0 && (
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: 'hsl(280 65% 65%)',
              boxShadow: '0 0 6px hsl(280 65% 65%)',
              animation: 'pulse-dot 2s ease-in-out infinite',
            }} />
          )}
        </div>
        {hasData ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>peak</span>
            <span style={{
              fontSize: '6px', fontFamily: 'var(--font-mono)',
              fontWeight: 700, color: 'hsl(280 65% 65%)',
            }}>
              {bars.filter(b => b.isPeak).map(b => b.label).join(', ')}
            </span>
          </div>
        ) : (
          <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>NO DATA</span>
        )}
      </div>

      {/* Column headers */}
      {hasData && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          padding: '0 0.15rem',
          borderBottom: '1px solid hsl(225 45% 12%)',
        }}>
          {[['HR', 20], ['', 1], ['N', 20], ['DOM', 24]].map(([label, width]) => (
            <div key={label} style={{
              fontSize: '4.5px', fontFamily: 'var(--font-mono)',
              color: 'hsl(225 45% 20%)',
              letterSpacing: '0.06em',
              width, flexShrink: 0,
              textAlign: label === 'N' || label === 'DOM' ? 'right' : 'left',
            }}>
              {label}
            </div>
          ))}
        </div>
      )}

      {/* Rows */}
      {!hasData ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            NO TIMESTAMP DATA
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {bars.map(bar => (
            <IntentBar key={bar.hour} bar={bar} />
          ))}
        </div>
      )}

      {/* Legend */}
      {hasData && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: '0.1rem',
          borderTop: '1px solid hsl(225 45% 12%)',
        }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            {totalEntries} requests · 24h · top-3 peak highlighted · timestamp field
          </span>
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {INTENT_ORDER.map(intent => (
              <div key={intent} style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
                <div style={{ width: 6, height: 6, borderRadius: 1, background: INTENT_COLORS[intent], opacity: 0.75 }} />
                <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>
                  {INTENT_LABELS[intent]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
