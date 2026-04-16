import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const TIER_CONFIG = {
  tier1: { label: 'tier1', color: 'hsl(280 65% 65%)', desc: 'Frontier' },
  tier2: { label: 'tier2', color: 'hsl(185 80% 50%)', desc: 'Workhorse' },
  tier3: { label: 'tier3', color: 'hsl(145 65% 55%)', desc: 'Routine' },
} as const

const EXPECTED_PERCENT = 100 / 3 // 33.33% for equal split

function entropy(counts: Record<string, number>): number {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (total === 0) return 0
  return Object.values(counts)
    .map(c => {
      const p = c / total
      return p > 0 ? -p * Math.log2(p) : 0
    })
    .reduce((a, b) => a + b, 0)
}

export function TierLoadBalancer({ entries }: Props) {
  const { tierCounts, tierPercents, total, dominantTier, entropyScore, imbalanceTiers, recentTiers } = useMemo(() => {
    const counts: Record<string, number> = { tier1: 0, tier2: 0, tier3: 0 }
    for (const entry of entries) {
      const tier = entry.routed_tier
      if (tier && tier in counts) counts[tier]++
    }

    const totalCount = Object.values(counts).reduce((a, b) => a + b, 0)
    const percents: Record<string, number> = {}
    for (const [tier, count] of Object.entries(counts)) {
      percents[tier] = totalCount > 0 ? (count / totalCount) * 100 : 0
    }

    // Dominant tier
    let dominant = 'tier1'
    let maxCount = 0
    for (const [tier, count] of Object.entries(counts)) {
      if (count > maxCount) { maxCount = count; dominant = tier }
    }

    // Entropy — normalized to [0, 1] where 1 = perfectly uniform distribution
    const ent = entropy(counts)
    const maxEntropy = Math.log2(3)
    const normalizedEntropy = maxEntropy > 0 ? ent / maxEntropy : 0

    // Imbalanced tiers: deviation > 20% from expected 33.3%
    const imbalance: string[] = []
    for (const [tier, pct] of Object.entries(percents)) {
      if (Math.abs(pct - EXPECTED_PERCENT) > 20) imbalance.push(tier)
    }

    // Last 10 entries for sparkline
    const recent = entries.slice(0, 10).map(e => e.routed_tier).reverse()

    return {
      tierCounts: counts,
      tierPercents: percents,
      total: totalCount,
      dominantTier: dominant,
      entropyScore: normalizedEntropy,
      imbalanceTiers: imbalance,
      recentTiers: recent,
    }
  }, [entries])

  const hasData = total > 0

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '960ms',
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
          Tier Load Balancer
        </span>
        {hasData && (
          <span style={{
            fontSize: '6px',
            fontFamily: 'var(--font-mono)',
            color: 'hsl(225, 45%, 25%)',
          }}>
            n={total}
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
        <>
          {/* Thermometer Gauges */}
          <div style={{
            display: 'flex',
            gap: '0.6rem',
            justifyContent: 'center',
            alignItems: 'flex-end',
          }}>
            {(['tier1', 'tier2', 'tier3'] as const).map(tier => {
              const config = TIER_CONFIG[tier]
              const pct = tierPercents[tier]
              const count = tierCounts[tier]

              return (
                <div key={tier} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.2rem',
                  flex: 1,
                  maxWidth: 48,
                }}>
                  {/* Percentage */}
                  <span style={{
                    fontSize: '8px',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    color: config.color,
                    lineHeight: 1,
                  }}>
                    {pct.toFixed(1)}
                    <span style={{ fontSize: '5px', color: 'hsl(225, 45%, 25%)' }}>%</span>
                  </span>

                  {/* Thermometer bar */}
                  <div style={{
                    position: 'relative',
                    width: '100%',
                    height: 80,
                    background: 'hsl(225 45% 10%)',
                    borderRadius: 4,
                    border: `1px solid ${config.color}30`,
                    overflow: 'hidden',
                  }}>
                    {/* Fill */}
                    <div style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: `${pct}%`,
                      background: `linear-gradient(to top, ${config.color}40, ${config.color}90)`,
                      borderRadius: '0 0 3px 3px',
                      transition: 'height 600ms cubic-bezier(0.34, 1.2, 0.64, 1)',
                      boxShadow: `0 0 8px ${config.color}50`,
                    }} />
                  </div>

                  {/* Pip indicator */}
                  <div style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: config.color,
                    boxShadow: `0 0 6px ${config.color}60`,
                  }} />

                  {/* Label */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 1,
                  }}>
                    <span style={{
                      fontSize: '7px',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      color: config.color,
                      letterSpacing: '0.04em',
                    }}>
                      {config.label}
                    </span>
                    <span style={{
                      fontSize: '5.5px',
                      fontFamily: 'var(--font-mono)',
                      color: 'hsl(225, 45%, 25%)',
                    }}>
                      {count} reqs
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Imbalance Warning + Expected vs Actual Bar */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
          }}>
            {imbalanceTiers.length > 0 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
              }}>
                <span style={{
                  fontSize: '5px',
                  fontFamily: 'var(--font-mono)',
                  color: 'hsl(0 72% 55%)',
                  background: 'hsl(0 72% 55%)15',
                  padding: '1px 4px',
                  borderRadius: 2,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                }}>
                  IMBALANCED
                </span>
                <span style={{
                  fontSize: '5px',
                  fontFamily: 'var(--font-mono)',
                  color: 'hsl(225, 45%, 30%)',
                }}>
                  {imbalanceTiers.map(t => TIER_CONFIG[t as keyof typeof TIER_CONFIG].label).join(', ')}
                </span>
              </div>
            )}

            {/* Expected vs Actual bar */}
            <div style={{ position: 'relative' }}>
              {/* Expected line at 33.3% */}
              <div style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${EXPECTED_PERCENT}%`,
                width: 0,
                borderLeft: '1px dashed hsl(225, 45%, 35%)',
                zIndex: 2,
              }} />
              <span style={{
                position: 'absolute',
                top: '-6px',
                left: `${EXPECTED_PERCENT}%`,
                transform: 'translateX(-50%)',
                fontSize: '4px',
                fontFamily: 'var(--font-mono)',
                color: 'hsl(225, 45%, 30%)',
              }}>
                33.3%
              </span>

              {/* Actual bar */}
              <div style={{
                height: 4,
                background: 'hsl(225, 45%, 10%)',
                borderRadius: 2,
                overflow: 'hidden',
                display: 'flex',
              }}>
                <div style={{
                  width: `${tierPercents.tier1}%`,
                  background: TIER_CONFIG.tier1.color,
                  transition: 'width 600ms ease',
                }} />
                <div style={{
                  width: `${tierPercents.tier2}%`,
                  background: TIER_CONFIG.tier2.color,
                  transition: 'width 600ms ease',
                }} />
                <div style={{
                  width: `${tierPercents.tier3}%`,
                  background: TIER_CONFIG.tier3.color,
                  transition: 'width 600ms ease',
                }} />
              </div>
            </div>
          </div>

          {/* Sparkline + Stats row */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            paddingTop: '0.1rem',
            borderTop: '1px solid hsl(225, 45%, 12%)',
          }}>
            {/* Sparkline: last 10 entries as colored dots */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.1rem',
              flexShrink: 0,
            }}>
              <span style={{
                fontSize: '4.5px',
                fontFamily: 'var(--font-mono)',
                color: 'hsl(225, 45%, 20%)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}>
                Trend
              </span>
              <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
                {recentTiers.length === 0 ? (
                  <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225, 45%, 15%)' }}>—</span>
                ) : (
                  recentTiers.map((tier, i) => (
                    <div
                      key={i}
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        background: TIER_CONFIG[tier as keyof typeof TIER_CONFIG]?.color ?? 'hsl(225, 45%, 20%)',
                        boxShadow: `0 0 3px ${TIER_CONFIG[tier as keyof typeof TIER_CONFIG]?.color ?? 'transparent'}50`,
                        flex: '0 0 auto',
                      }}
                      title={tier}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Legend dots */}
            <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
              {(['tier1', 'tier2', 'tier3'] as const).map(tier => (
                <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <div style={{
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    background: TIER_CONFIG[tier].color,
                    flex: '0 0 auto',
                  }} />
                  <span style={{
                    fontSize: '4px',
                    fontFamily: 'var(--font-mono)',
                    color: 'hsl(225, 45%, 25%)',
                  }}>
                    {TIER_CONFIG[tier].label}
                  </span>
                </div>
              ))}
            </div>

            {/* Stats */}
            <div style={{
              display: 'flex',
              flex: 1,
              gap: '0.5rem',
              justifyContent: 'flex-end',
              alignItems: 'center',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225, 45%, 20%)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Dominant</span>
                <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: TIER_CONFIG[dominantTier as keyof typeof TIER_CONFIG].color }}>
                  {TIER_CONFIG[dominantTier as keyof typeof TIER_CONFIG].label}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225, 45%, 20%)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Entropy</span>
                <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: entropyScore > 0.7 ? 'hsl(145 65% 55%)' : entropyScore > 0.4 ? 'hsl(185 80% 50%)' : 'hsl(0 72% 55%)' }}>
                  {entropyScore.toFixed(2)}
                  <span style={{ fontSize: '4px', color: 'hsl(225, 45%, 25%)' }}>/1.00</span>
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
