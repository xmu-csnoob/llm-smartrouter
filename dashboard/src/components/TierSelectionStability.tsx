import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

interface TierStats {
  total: number
  stable: number
  degraded: number
  stabilityPct: number
}

const TIER_COLORS = {
  tier1: 'hsl(280, 65%, 65%)',
  tier2: 'hsl(185, 80%, 50%)',
  tier3: 'hsl(145, 65%, 55%)',
}

const TIER_LABELS: Record<string, string> = {
  tier1: 'T1',
  tier2: 'T2',
  tier3: 'T3',
}

const SPARKLINE_STABLE = 'hsl(145, 65%, 55%)'
const SPARKLINE_DEGRADED = 'hsl(0, 72%, 55%)'

export function TierSelectionStability({ entries }: Props) {
  const { tierStats, sparkline } = useMemo(() => {
    const counts: Record<string, { total: number; stable: number }> = {
      tier1: { total: 0, stable: 0 },
      tier2: { total: 0, stable: 0 },
      tier3: { total: 0, stable: 0 },
    }

    for (const entry of entries) {
      const tier = (entry as unknown as Record<string, string>).tier as string | undefined
        ?? entry.routed_tier
        ?? entry.selected_tier

      if (!tier || !(tier in counts)) continue

      const isStable = !entry.is_fallback && entry.status < 400 && !entry.error

      counts[tier].total++
      if (isStable) counts[tier].stable++
    }

    const computed: Record<string, TierStats> = {}
    for (const [tier, c] of Object.entries(counts)) {
      computed[tier] = {
        total: c.total,
        stable: c.stable,
        degraded: c.total - c.stable,
        stabilityPct: c.total > 0 ? (c.stable / c.total) * 100 : 0,
      }
    }

    // Rolling window: last 10 entries
    const recent = entries.slice(0, 10).reverse()
    const dots = recent.map(entry => {
      const tier = (entry as unknown as Record<string, string>).tier as string | undefined
        ?? entry.routed_tier
        ?? entry.selected_tier
      const isStable = !entry.is_fallback && entry.status < 400 && !entry.error
      return { tier, isStable }
    })

    return { tierStats: computed, sparkline: dots }
  }, [entries])

  const maxTotal = Math.max(
    tierStats.tier1.total,
    tierStats.tier2.total,
    tierStats.tier3.total,
    1,
  )

  const hasData = tierStats.tier1.total + tierStats.tier2.total + tierStats.tier3.total > 0

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.35rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '940ms',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: '9px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Tier Stability
        </span>
        {hasData && (
          <span style={{
            fontSize: '6px',
            fontFamily: 'var(--font-mono)',
            color: 'hsl(225, 45%, 25%)',
          }}>
            n={tierStats.tier1.total + tierStats.tier2.total + tierStats.tier3.total}
          </span>
        )}
      </div>

      {!hasData ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225, 45%, 20%)' }}>
            NO TIER DATA
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
          {/* Left: 3-tier vertical bar chart */}
          <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'flex-end', flex: '0 0 auto' }}>
            {(['tier1', 'tier2', 'tier3'] as const).map(tier => {
              const stats = tierStats[tier]
              const barHeight = Math.max((stats.total / maxTotal) * 32, stats.total > 0 ? 4 : 0)
              const color = TIER_COLORS[tier]
              return (
                <div
                  key={tier}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.1rem',
                    flex: '0 0 auto',
                  }}
                >
                  <span style={{
                    fontSize: '7px',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    color,
                    lineHeight: 1,
                  }}>
                    {stats.stabilityPct.toFixed(0)}
                    <span style={{ fontSize: '5px', color: 'hsl(225, 45%, 25%)' }}>%</span>
                  </span>
                  <div
                    style={{
                      width: 14,
                      height: barHeight,
                      background: color,
                      borderRadius: '2px 2px 0 0',
                      boxShadow: `0 0 6px ${color}40`,
                      transition: 'height 500ms ease',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Degraded portion overlay */}
                    {stats.degraded > 0 && stats.total > 0 && (
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: `${(stats.degraded / stats.total) * 100}%`,
                          background: 'hsl(0, 72%, 55%)',
                          opacity: 0.7,
                        }}
                      />
                    )}
                  </div>
                  <span style={{
                    fontSize: '6px',
                    fontFamily: 'var(--font-mono)',
                    color: 'hsl(225, 45%, 30%)',
                    fontWeight: 600,
                  }}>
                    {TIER_LABELS[tier]}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Center: Degradation events per tier */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.2rem',
            flex: '0 0 auto',
            padding: '0 0.35rem',
            borderLeft: '1px solid hsl(225, 45%, 10%)',
            borderRight: '1px solid hsl(225, 45%, 10%)',
          }}>
            <span style={{
              fontSize: '4.5px',
              fontFamily: 'var(--font-mono)',
              color: 'hsl(225, 45%, 20%)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: '0.1rem',
            }}>
              Deg Events
            </span>
            {(['tier1', 'tier2', 'tier3'] as const).map(tier => {
              const stats = tierStats[tier]
              const color = TIER_COLORS[tier]
              return (
                <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  <span style={{
                    fontSize: '6px',
                    fontFamily: 'var(--font-mono)',
                    color,
                    fontWeight: 700,
                  }}>
                    {TIER_LABELS[tier]}
                  </span>
                  <span style={{
                    fontSize: '9px',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    color: stats.degraded > 0 ? 'hsl(0, 72%, 55%)' : 'hsl(225, 45%, 30%)',
                  }}>
                    {stats.degraded}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Right: Sparkline — last 10 entries */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.2rem',
            flex: 1,
          }}>
            <span style={{
              fontSize: '4.5px',
              fontFamily: 'var(--font-mono)',
              color: 'hsl(225, 45%, 20%)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              Stability Trend
            </span>
            <div style={{
              display: 'flex',
              gap: '3px',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}>
              {sparkline.length === 0 ? (
                <span style={{
                  fontSize: '5px',
                  fontFamily: 'var(--font-mono)',
                  color: 'hsl(225, 45%, 15%)',
                }}>
                  no entries
                </span>
              ) : (
                sparkline.map((dot, i) => (
                  <div
                    key={i}
                    style={{
                      width: 3,
                      height: 3,
                      borderRadius: '50%',
                      background: dot.isStable ? SPARKLINE_STABLE : SPARKLINE_DEGRADED,
                      boxShadow: `0 0 3px ${dot.isStable ? SPARKLINE_STABLE : SPARKLINE_DEGRADED}`,
                      flex: '0 0 auto',
                    }}
                    title={`${dot.tier ?? '?'} · ${dot.isStable ? 'stable' : 'degraded'}`}
                  />
                ))
              )}
            </div>
            <div style={{
              display: 'flex',
              gap: '3px',
              marginTop: '0.1rem',
            }}>
              {(['tier1', 'tier2', 'tier3'] as const).map(tier => (
                <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <div style={{
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    background: TIER_COLORS[tier],
                    flex: '0 0 auto',
                  }} />
                  <span style={{
                    fontSize: '4px',
                    fontFamily: 'var(--font-mono)',
                    color: 'hsl(225, 45%, 25%)',
                  }}>
                    {TIER_LABELS[tier]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      {hasData && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: '0.05rem',
          borderTop: '1px solid hsl(225, 45%, 12%)',
        }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225, 45%, 20%)' }}>
            stable = !fallback & status &lt; 400 &amp; !error
          </span>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: SPARKLINE_STABLE }}>stable</span>
            <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225, 45%, 20%)' }}>·</span>
            <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: SPARKLINE_DEGRADED }}>degraded</span>
          </div>
        </div>
      )}
    </div>
  )
}
