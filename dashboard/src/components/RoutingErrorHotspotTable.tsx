import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const INTENT_ORDER = ['simple', 'debug', 'implementation', 'architecture', 'analysis', 'general'] as const
type Intent = typeof INTENT_ORDER[number]

const TOKEN_BUCKETS = [
  { key: 'tiny', label: '<500', max: 500 },
  { key: 'low', label: '500-2k', max: 2000 },
  { key: 'medium', label: '2k-8k', max: 8000 },
  { key: 'high', label: '8k-32k', max: 32000 },
  { key: 'vhigh', label: '32k+', max: Infinity },
] as const
type TokenBucket = typeof TOKEN_BUCKETS[number]

const INTENT_LABELS: Record<Intent, string> = {
  simple: 'Simple',
  debug: 'Debug',
  implementation: 'Impl',
  architecture: 'Arch',
  analysis: 'Analysis',
  general: 'General',
}

const INTENT_COLORS: Record<Intent, string> = {
  simple: 'hsl(145 65% 55%)',
  debug: 'hsl(38 92% 55%)',
  implementation: 'hsl(200 75% 55%)',
  architecture: 'hsl(280 65% 65%)',
  analysis: 'hsl(260 65% 55%)',
  general: 'hsl(0 0% 55%)',
}

const TOKEN_COLORS: Record<string, string> = {
  tiny: 'hsl(145 65% 55%)',
  low: 'hsl(185 80% 50%)',
  medium: 'hsl(38 92% 55%)',
  high: 'hsl(30 75% 55%)',
  vhigh: 'hsl(0 72% 55%)',
}

interface HotspotRow {
  intent: Intent
  tokenBucket: TokenBucket['key']
  tokenLabel: string
  count: number
  fallbackRate: number
  relativeRisk: number  // fallbackRate / overallFallbackRate
  isHighRisk: boolean  // relativeRisk > 1.5
}

function HotspotBar({ row, maxCount }: { row: HotspotRow; maxCount: number }) {
  const intentColor = INTENT_COLORS[row.intent]
  const tokenColor = TOKEN_COLORS[row.tokenBucket]
  const barWidth = maxCount > 0 ? (row.count / maxCount) * 100 : 0

  const riskColor = row.relativeRisk > 2
    ? 'hsl(0 72% 55%)'
    : row.relativeRisk > 1.5
    ? 'hsl(30 75% 55%)'
    : row.relativeRisk > 1
    ? 'hsl(38 92% 55%)'
    : 'hsl(145 65% 55%)'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.25rem',
      padding: '0.08rem 0.2rem',
      borderRadius: 3,
      background: row.isHighRisk ? 'hsl(0 50% 8% / 0.3)' : 'transparent',
      borderBottom: '1px solid hsl(225 45% 10%)',
      transition: 'background 200ms ease',
    }}>
      {/* Intent badge */}
      <div style={{
        fontSize: '6px', fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        color: intentColor,
        width: 32, flexShrink: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {INTENT_LABELS[row.intent]}
      </div>

      {/* Token bucket */}
      <div style={{
        fontSize: '5.5px', fontFamily: 'var(--font-mono)',
        color: tokenColor,
        width: 40, flexShrink: 0,
      }}>
        {row.tokenLabel}
      </div>

      {/* Count bar */}
      <div style={{
        flex: 1,
        height: 5,
        background: 'hsl(225 45% 10%)',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${barWidth}%`,
          height: '100%',
          background: `linear-gradient(90deg, ${intentColor}30, ${intentColor}70)`,
          borderRadius: 2,
          transition: 'width 600ms cubic-bezier(0.34, 1.2, 0.64, 1)',
        }} />
      </div>

      {/* Count label */}
      <div style={{
        fontSize: '5.5px', fontFamily: 'var(--font-mono)',
        color: 'var(--muted-foreground)',
        width: 24, flexShrink: 0, textAlign: 'right',
      }}>
        {row.count}
      </div>

      {/* Fallback rate */}
      <div style={{
        fontSize: '5.5px', fontFamily: 'var(--font-mono)',
        color: row.fallbackRate > 0.1 ? 'hsl(0 72% 60%)' : row.fallbackRate > 0 ? 'hsl(38 92% 60%)' : 'hsl(145 65% 55%)',
        width: 28, flexShrink: 0, textAlign: 'right',
        fontWeight: 600,
      }}>
        {row.count > 0 ? `${(row.fallbackRate * 100).toFixed(0)}%` : '—'}
      </div>

      {/* Relative risk badge */}
      <div style={{
        fontSize: '5px', fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        color: row.isHighRisk ? riskColor : 'hsl(225 45% 25%)',
        width: 32, flexShrink: 0, textAlign: 'right',
        background: row.isHighRisk ? `${riskColor}20` : 'transparent',
        borderRadius: 2,
        padding: '0 2px',
      }}>
        {row.count > 0 ? `${row.relativeRisk.toFixed(1)}x` : '—'}
      </div>
    </div>
  )
}

export function RoutingErrorHotspotTable({ entries }: Props) {
  const { rows, maxCount, overallFallbackRate, totalEntries } = useMemo(() => {
    const total = entries.length
    const totalFallbacks = entries.filter(e => e.is_fallback).length
    const overallRate = total > 0 ? totalFallbacks / total : 0

    // Build hotspot grid: intent × token bucket
    const grid: Record<string, { count: number; fallbacks: number }> = {}

    for (const entry of entries) {
      const intent = (entry.semantic_features?.intent ?? entry.task_type ?? 'general') as Intent
      const tokens = entry.estimated_tokens ?? 0
      const bucket = TOKEN_BUCKETS.find(b => tokens < b.max)
      const bucketKey = bucket?.key ?? 'vhigh'
      const key = `${intent}::${bucketKey}`

      if (!grid[key]) grid[key] = { count: 0, fallbacks: 0 }
      grid[key].count++
      if (entry.is_fallback) grid[key].fallbacks++
    }

    const rows: HotspotRow[] = []
    let maxCount = 0

    for (const intent of INTENT_ORDER) {
      for (const bucket of TOKEN_BUCKETS) {
        const key = `${intent}::${bucket.key}`
        const data = grid[key]
        if (!data || data.count === 0) continue

        const fallbackRate = data.count > 0 ? data.fallbacks / data.count : 0
        const relativeRisk = overallRate > 0 ? fallbackRate / overallRate : 0

        rows.push({
          intent,
          tokenBucket: bucket.key,
          tokenLabel: bucket.label,
          count: data.count,
          fallbackRate,
          relativeRisk,
          isHighRisk: relativeRisk > 1.5,
        })
        maxCount = Math.max(maxCount, data.count)
      }
    }

    // Sort by fallback rate descending, then by count descending
    rows.sort((a, b) => {
      if (b.relativeRisk !== a.relativeRisk) return b.relativeRisk - a.relativeRisk
      return b.count - a.count
    })

    return { rows: rows.slice(0, 12), maxCount, overallFallbackRate: overallRate, totalEntries: total }
  }, [entries])

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '900ms',
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
            Error Hotspots
          </span>
          {rows.some(r => r.isHighRisk) && (
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: 'hsl(0 72% 55%)',
              boxShadow: '0 0 6px hsl(0 72% 55%)',
              animation: 'pulse-dot 1.5s ease-in-out infinite',
            }} />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: 'var(--muted-foreground)',
          }}>
            baseline
          </span>
          <span style={{
            fontSize: '6px', fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            color: 'var(--muted-foreground)',
          }}>
            {(overallFallbackRate * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.25rem',
        padding: '0 0.2rem',
        borderBottom: '1px solid hsl(225 45% 12%)',
      }}>
        {[['INTENT', 32], ['TOKENS', 40], ['', 1], ['N', 24], ['FB%', 28], ['RISK', 32]].map(([label, width]) => (
          <div key={label} style={{
            fontSize: '4.5px', fontFamily: 'var(--font-mono)',
            color: 'hsl(225 45% 20%)',
            letterSpacing: '0.06em',
            width, flexShrink: 0,
            textAlign: label === 'N' || label === 'FB%' || label === 'RISK' ? 'right' : 'left',
          }}>
            {label}
          </div>
        ))}
      </div>

      {/* Rows */}
      {rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            NO HOTSPOT DATA
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((row) => (
            <HotspotBar key={`${row.intent}::${row.tokenBucket}`} row={row} maxCount={maxCount} />
          ))}
        </div>
      )}

      {/* Footer */}
      {totalEntries > 0 && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: '0.1rem',
          borderTop: '1px solid hsl(225 45% 12%)',
        }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            {totalEntries} requests · top {rows.length} (intent × token bucket)
          </span>
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            {[['Low', 'hsl(145 65% 55%)'], ['Med', 'hsl(38 92% 55%)'], ['High', 'hsl(30 75% 55%)'], ['Crit', 'hsl(0 72% 55%)']].map(([label, color]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: color }} />
                <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
