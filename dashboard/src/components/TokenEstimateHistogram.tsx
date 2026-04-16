import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const TIER_COLORS: Record<string, string> = {
  tier1: 'hsl(280 65% 60%)',
  tier2: 'hsl(200 75% 55%)',
  tier3: 'hsl(145 65% 48%)',
}

// Log-scaled bins from 16 tokens to 128k tokens
const BINS = [
  { label: '16', min: 0, max: 64 },
  { label: '64', min: 64, max: 256 },
  { label: '256', min: 256, max: 1024 },
  { label: '1K', min: 1024, max: 4096 },
  { label: '4K', min: 4096, max: 16384 },
  { label: '16K', min: 16384, max: 65536 },
  { label: '65K', min: 65536, max: Infinity },
]

function getBinIndex(tokens: number): number {
  for (let i = 0; i < BINS.length; i++) {
    if (tokens < BINS[i].max) return i
  }
  return BINS.length - 1
}

export function TokenEstimateHistogram({ entries }: Props) {
  const { bins, maxBin, total } = useMemo(() => {
    // Count per bin, and per tier within each bin
    const binCounts = BINS.map(() => 0)
    const tierInBin: Record<number, Record<string, number>> = {}
    BINS.forEach((_, i) => { tierInBin[i] = {} })
    let totalEntries = 0

    for (const entry of entries) {
      const tokens = entry.estimated_tokens
      if (tokens == null || tokens <= 0) continue
      totalEntries++
      const idx = getBinIndex(tokens)
      binCounts[idx]++
      const tier = entry.routed_tier || 'tier2'
      tierInBin[idx][tier] = (tierInBin[idx][tier] || 0) + 1
    }

    const maxBin = Math.max(...binCounts, 1)

    return {
      bins: BINS.map((b, i) => ({ ...b, count: binCounts[i], tierCounts: tierInBin[i] })),
      maxBin,
      total: totalEntries,
    }
  }, [entries])

  if (total === 0) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center' }}>
        <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          NO TOKEN DATA
        </span>
      </div>
    )
  }

  return (
    <div style={{ padding: '0.375rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Token Distribution
        </span>
        <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          {total} samples · log scale
        </span>
      </div>

      {/* Stacked bar chart */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 80 }}>
        {bins.map((bin, i) => {
          const pct = bin.count / maxBin
          const hasData = bin.count > 0
          const tiers = ['tier1', 'tier2', 'tier3'] as const

          return (
            <div
              key={i}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: 1,
                height: '100%',
                position: 'relative',
              }}
            >
              {/* Stacked bar */}
              <div
                style={{
                  width: '100%',
                  height: hasData ? `${Math.max(4, pct * 72)}px` : '3px',
                  background: hasData ? 'var(--muted)' : 'var(--muted)',
                  borderRadius: 2,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                  transition: 'height 400ms ease',
                }}
              >
                {([...tiers].reverse()).map((tier) => {
                  const tc = bin.tierCounts[tier] || 0
                  if (tc === 0) return null
                  const tierPct = tc / bin.count
                  return (
                    <div
                      key={tier}
                      style={{
                        width: '100%',
                        height: `${tierPct * 100}%`,
                        background: TIER_COLORS[tier],
                        opacity: 0.75,
                        minHeight: 2,
                      }}
                    />
                  )
                })}
              </div>

              {/* Count label */}
              {hasData && (
                <span style={{
                  fontSize: '7px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--muted-foreground)',
                  position: 'absolute',
                  bottom: -14,
                }}>
                  {bin.count}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* X-axis labels */}
      <div style={{ display: 'flex', gap: 3, marginTop: '0.875rem' }}>
        {bins.map((bin, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center' }}>
            <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
              {bin.label}
            </span>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'center', marginTop: '0.125rem' }}>
        {(['tier1', 'tier2', 'tier3'] as const).map((tier) => (
          <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: TIER_COLORS[tier], opacity: 0.75 }} />
            <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
              {tier.replace('tier', 'T')}
            </span>
          </div>
        ))}
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.125rem' }}>
        {(() => {
          const tokens = entries.map(e => e.estimated_tokens).filter(t => t != null && t > 0)
          if (tokens.length === 0) return null
          const avg = tokens.reduce((s, t) => s + t, 0) / tokens.length
          const med = [...tokens].sort((a, b) => a - b)[Math.floor(tokens.length / 2)]
          const p95 = [...tokens].sort((a, b) => a - b)[Math.floor(tokens.length * 0.95)]
          return [
            { label: 'avg', v: avg },
            { label: 'med', v: med },
            { label: 'p95', v: p95 },
          ].map(({ label, v }) => (
            <div key={label} style={{ flex: 1, background: 'var(--muted)', borderRadius: 4, padding: '0.2rem 0.35rem', textAlign: 'center', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>{label}</div>
              <div style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--foreground)', marginTop: 1 }}>
                {v >= 1000 ? `${(v / 1024).toFixed(1)}K` : `${Math.round(v)}`}
              </div>
            </div>
          ))
        })()}
      </div>
    </div>
  )
}
