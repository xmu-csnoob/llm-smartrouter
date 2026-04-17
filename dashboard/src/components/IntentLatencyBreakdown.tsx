import { useState, useEffect } from 'react'
import type { Stats } from '@/hooks/useApi'

interface Props {
  stats: Stats | null
}

const INTENT_ORDER = ['simple', 'debug', 'implementation', 'architecture', 'analysis', 'general'] as const
type IntentType = typeof INTENT_ORDER[number]

// Complexity weight multipliers applied to overall avg latency
const COMPLEXITY_WEIGHT: Record<IntentType, number> = {
  simple: 0.5,
  debug: 0.7,
  implementation: 1.2,
  architecture: 1.8,
  analysis: 1.5,
  general: 1.0,
}

const INTENT_LABELS: Record<IntentType, string> = {
  simple: 'Simple',
  debug: 'Debug',
  implementation: 'Impl',
  architecture: 'Arch',
  analysis: 'Analysis',
  general: 'General',
}

const BASE_COLORS: Record<IntentType, string> = {
  simple: 'hsl(145 65% 50%)',
  debug: 'hsl(45 85% 60%)',
  implementation: 'hsl(200 75% 55%)',
  architecture: 'hsl(280 65% 65%)',
  analysis: 'hsl(260 65% 55%)',
  general: 'hsl(0 0% 55%)',
}

interface IntentLatencyRow {
  type: IntentType
  label: string
  latencyMs: number
  count: number
}

function latencyColor(ms: number): string {
  if (ms < 1000) return 'hsl(185 80% 50%)' // cyan — fast
  if (ms < 2000) return 'hsl(38 92% 55%)'   // amber — medium
  return 'hsl(0 72% 55%)'                    // red — slow
}

function LatencyBar({ row, maxLatency }: { row: IntentLatencyRow; maxLatency: number }) {
  const color = latencyColor(row.latencyMs)
  const widthPct = maxLatency > 0 ? (row.latencyMs / maxLatency) * 100 : 0
  const isFast = row.latencyMs < 1000
  const isSlow = row.latencyMs >= 2000

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.1rem 0' }}>
      {/* Intent label */}
      <div style={{
        fontSize: '7px', fontFamily: 'var(--font-mono)',
        color: BASE_COLORS[row.type],
        width: 48, flexShrink: 0,
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}>
        {row.label}
      </div>

      {/* Bar track */}
      <div style={{
        flex: 1,
        height: 8,
        background: 'hsl(225 45% 10%)',
        borderRadius: 4,
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: `${widthPct}%`,
          background: `linear-gradient(90deg, ${color}40, ${color}90)`,
          borderRadius: 4,
          boxShadow: `0 0 6px ${color}40`,
          transition: 'width 600ms cubic-bezier(0.34, 1.2, 0.64, 1)',
        }} />
        {/* Threshold markers */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '33%', width: 1, background: 'hsl(225 45% 20%)' }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '66%', width: 1, background: 'hsl(225 45% 20%)' }} />
      </div>

      {/* Latency label */}
      <div style={{
        fontSize: '6.5px', fontFamily: 'var(--font-mono)',
        color,
        width: 36, flexShrink: 0, textAlign: 'right',
        fontWeight: 700,
      }}>
        {row.latencyMs >= 1000
          ? `${(row.latencyMs / 1000).toFixed(1)}s`
          : `${row.latencyMs.toFixed(0)}ms`}
      </div>

      {/* Status badge */}
      <div style={{
        fontSize: '5px', fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        color: isFast ? 'hsl(145 65% 55%)' : isSlow ? 'hsl(0 72% 60%)' : 'hsl(38 92% 60%)',
        letterSpacing: '0.04em',
        width: 24, flexShrink: 0,
      }}>
        {isFast ? 'FAST' : isSlow ? 'SLOW' : 'MED'}
      </div>
    </div>
  )
}

export function IntentLatencyBreakdown({ stats }: Props) {
  const [rows, setRows] = useState<IntentLatencyRow[]>([])
  const [total, setTotal] = useState(0)

  useEffect(() => {
    if (!stats) return

    const intentDist = stats.intent_distribution ?? {}
    const avgLat = stats.avg_latency_ms ?? 0
    const totalCount = Object.values(intentDist).reduce((s, v) => s + v, 0)
    setTotal(totalCount)

    const built: IntentLatencyRow[] = INTENT_ORDER
      .map(type => ({
        type,
        label: INTENT_LABELS[type],
        latencyMs: Math.round(avgLat * COMPLEXITY_WEIGHT[type]),
        count: intentDist[type] ?? 0,
      }))
      .filter(r => r.count > 0)
      .sort((a, b) => b.latencyMs - a.latencyMs)

    setRows(built)
  }, [stats])

  const maxLatency = Math.max(...rows.map(r => r.latencyMs), 1)

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '820ms',
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
            Intent Latency
          </span>
          {/* Live pulse */}
          <div style={{
            width: 5, height: 5, borderRadius: '50%',
            background: 'hsl(185 80% 50%)',
            boxShadow: '0 0 6px hsl(185 80% 50%)',
            animation: 'pulse-dot 2.5s ease-in-out infinite',
          }} />
        </div>
        {/* Threshold legend */}
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          {[['FAST', 'hsl(145 65% 55%)'], ['MED', 'hsl(38 92% 60%)'], ['SLOW', 'hsl(0 72% 60%)']].map(([label, color]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
              <div style={{ width: 4, height: 4, borderRadius: '50%', background: color }} />
              <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Threshold markers legend */}
      <div style={{ display: 'flex', gap: '0.5rem', paddingLeft: 52 }}>
        <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(185 80% 50%)' }}>&lt;1s</span>
        <div style={{ flex: 1, display: 'flex', gap: '0' }}>
          <div style={{ flex: 1, borderTop: '1px dashed hsl(225 45% 15%)' }} />
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(38 92% 60%)', marginLeft: '0.25rem' }}>1s</span>
          <div style={{ flex: 1, borderTop: '1px dashed hsl(225 45% 15%)' }} />
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(0 72% 60%)', marginLeft: '0.25rem' }}>2s</span>
        </div>
      </div>

      {/* Bars */}
      {rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '0.75rem 0' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
            NO INTENT DATA
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
          {rows.map(row => (
            <LatencyBar key={row.type} row={row} maxLatency={maxLatency} />
          ))}
        </div>
      )}

      {/* Footer: total requests */}
      {total > 0 && (
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          paddingTop: '0.1rem',
          borderTop: '1px solid hsl(225 45% 12%)',
        }}>
          <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
            {total.toLocaleString()} total requests · latency × complexity weight estimate
          </span>
        </div>
      )}
    </div>
  )
}
