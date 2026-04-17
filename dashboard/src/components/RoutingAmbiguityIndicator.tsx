import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

// Bin edges for ambiguity score: 0-0.2 low, 0.2-0.4 mild, 0.4-0.6 moderate, 0.6-0.8 high, 0.8-1.0 very high
const BIN_LABELS = ['Low', 'Mild', 'Moderate', 'High', 'V.High'] as const
const BIN_EDGES = [0, 0.2, 0.4, 0.6, 0.8, 1.0] as const
const BIN_COLORS = [
  'hsl(145 65% 55%)',  // Low — green/cyan
  'hsl(185 80% 50%)',  // Mild — cyan
  'hsl(38 92% 55%)',   // Moderate — amber
  'hsl(30 75% 55%)',   // High — orange
  'hsl(0 72% 55%)',    // V.High — red
]

interface BinData {
  label: string
  color: string
  count: number
  pct: number
  filled: boolean
}

function AmbiguityBar({ bins }: { bins: BinData[]; total: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
      {/* Segmented fill bar */}
      <div style={{
        display: 'flex',
        height: 10,
        borderRadius: 5,
        overflow: 'hidden',
        background: 'hsl(225 45% 10%)',
        border: '1px solid hsl(225 45% 15%)',
        gap: 2,
      }}>
        {bins.map((bin, i) => (
          <div
            key={i}
            style={{
              flex: bin.count,
              background: bin.filled
                ? `linear-gradient(90deg, ${bin.color}60, ${bin.color}cc)`
                : 'transparent',
              transition: 'flex 500ms cubic-bezier(0.34, 1.2, 0.64, 1), background 300ms ease',
              boxShadow: bin.filled ? `inset 0 1px 0 ${bin.color}40, 0 0 6px ${bin.color}30` : 'none',
            }}
          />
        ))}
      </div>
      {/* Bin labels row */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {bins.map((bin, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <span style={{
              fontSize: '5px', fontFamily: 'var(--font-mono)',
              color: bin.filled ? bin.color : 'hsl(225 45% 20%)',
              fontWeight: 700,
            }}>
              {bin.pct > 0 ? `${bin.pct.toFixed(0)}%` : ''}
            </span>
            <span style={{
              fontSize: '4px', fontFamily: 'var(--font-mono)',
              color: bin.filled ? 'var(--muted-foreground)' : 'hsl(225 45% 12%)',
              letterSpacing: '0.03em',
            }}>
              {bin.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const w = 120
  const h = 20
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`spark-grad-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.4} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${h} ${points} ${w},${h}`}
        fill={`url(#spark-grad-${color.replace(/[^a-z0-9]/gi, '')})`}
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.9}
      />
    </svg>
  )
}

export function RoutingAmbiguityIndicator({ entries }: Props) {
  const { bins, total, meanScore, trendValues, dominantBin } = useMemo(() => {
    const scores: number[] = []

    for (const entry of entries) {
      const score = entry.semantic_features?.clarification_needed_score
      if (score != null && score >= 0) {
        scores.push(score)
      }
    }

    if (scores.length === 0) {
      return { bins: [], total: 0, meanScore: 0, trendValues: [], dominantBin: 0, oodCount: 0 }
    }

    // Build bins
    const counts = [0, 0, 0, 0, 0]
    for (const s of scores) {
      for (let i = 0; i < BIN_EDGES.length - 1; i++) {
        if (s >= BIN_EDGES[i] && s < BIN_EDGES[i + 1]) {
          counts[i]++
          break
        }
      }
    }
    const total = scores.length
    const bins: BinData[] = BIN_LABELS.map((label, i) => ({
      label,
      color: BIN_COLORS[i],
      count: counts[i],
      pct: total > 0 ? (counts[i] / total) * 100 : 0,
      filled: counts[i] > 0,
    }))

    const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length
    const dominantBin = counts.indexOf(Math.max(...counts))

    // Rolling window trend: slice entries into 6 buckets (oldest → newest)
    const bucketSize = Math.max(1, Math.floor(scores.length / 6))
    const trendValues: number[] = []
    for (let i = 0; i < 6; i++) {
      const start = i * bucketSize
      const end = Math.min(start + bucketSize, scores.length)
      const bucket = scores.slice(start, end)
      if (bucket.length > 0) {
        trendValues.push(bucket.reduce((a, b) => a + b, 0) / bucket.length)
      }
    }

    return { bins, total, meanScore, trendValues, dominantBin }
  }, [entries])

  const statusColor = meanScore < 0.3
    ? 'hsl(145 65% 55%)'
    : meanScore < 0.6
    ? 'hsl(38 92% 55%)'
    : 'hsl(0 72% 55%)'

  const statusLabel = meanScore < 0.3 ? 'CLEAR' : meanScore < 0.6 ? 'AMBIGUOUS' : 'UNCERTAIN'

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '860ms',
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
            Routing Ambiguity
          </span>
          <div style={{
            width: 5, height: 5, borderRadius: '50%',
            background: statusColor,
            boxShadow: `0 0 6px ${statusColor}`,
            animation: meanScore >= 0.6 ? 'pulse-dot 1.5s ease-in-out infinite' : 'none',
          }} />
        </div>
        {total === 0 ? (
          <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            NO DATA
          </span>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span style={{
              fontSize: '6px', fontFamily: 'var(--font-mono)',
              color: 'var(--muted-foreground)',
            }}>
              mean
            </span>
            <span style={{
              fontSize: '8px', fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              color: statusColor,
            }}>
              {meanScore.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      {total === 0 ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            NO CLARIFICATION SCORE DATA
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {/* Segmented bar */}
          <AmbiguityBar bins={bins} total={total} />

          {/* Status badge + trend sparkline */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.2rem',
              padding: '0.1rem 0.3rem',
              borderRadius: 4,
              background: `${statusColor}15`,
              border: `1px solid ${statusColor}30`,
            }}>
              <span style={{
                fontSize: '6px', fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                color: statusColor,
                letterSpacing: '0.06em',
              }}>
                {statusLabel}
              </span>
            </div>

            {/* Dominant bin label */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
              <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
                dominant:
              </span>
              <span style={{
                fontSize: '6px', fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                color: bins[dominantBin]?.color ?? 'var(--muted-foreground)',
              }}>
                {BIN_LABELS[dominantBin]}
              </span>
            </div>

            {/* Trend sparkline */}
            {trendValues.length >= 2 && (
              <MiniSparkline values={trendValues} color={statusColor} />
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      {total > 0 && (
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          paddingTop: '0.1rem',
          borderTop: '1px solid hsl(225 45% 12%)',
        }}>
          <span style={{ fontSize: '5.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            {total} requests · clarification_needed_score
          </span>
        </div>
      )}
    </div>
  )
}
