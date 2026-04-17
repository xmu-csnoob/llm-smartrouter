import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const TIER_COLORS: Record<string, string> = {
  tier1: 'hsl(280, 65%, 65%)',
  tier2: 'hsl(185, 80%, 50%)',
  tier3: 'hsl(145, 65%, 50%)',
}

type TierKey = 'tier1' | 'tier2' | 'tier3'

function tierNum(t: string): number {
  if (t === 'tier1') return 1
  if (t === 'tier2') return 2
  if (t === 'tier3') return 3
  return 99
}

function ConstraintBar({
  tier,
  count,
  pct,
  maxCount,
  color,
}: {
  tier: string
  count: number
  pct: number
  maxCount: number
  color: string
}) {
  const width = maxCount > 0 ? (count / maxCount) * 100 : 0
  const isZero = count === 0

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.15rem',
        padding: '0.15rem 0.4rem',
        borderBottom: '1px solid hsl(225 45% 10%)',
        opacity: isZero ? 0.3 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        <div
          style={{
            fontSize: '7px',
            fontFamily: 'var(--font-mono)',
            color,
            width: 44,
            flexShrink: 0,
            fontWeight: 700,
            letterSpacing: '0.04em',
          }}
        >
          {tier.toUpperCase()}
        </div>

        <div
          style={{
            flex: 1,
            height: 5,
            background: 'hsl(225 45% 10%)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${width}%`,
              height: '100%',
              background: `linear-gradient(90deg, ${color}40, ${color}80)`,
              borderRadius: 2,
              boxShadow: isZero ? 'none' : `0 0 4px ${color}30`,
              transition: 'width 600ms cubic-bezier(0.34, 1.2, 0.64, 1)',
            }}
          />
        </div>

        <div
          style={{
            fontSize: '6px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--muted-foreground)',
            width: 26,
            flexShrink: 0,
            textAlign: 'right',
            fontWeight: 600,
          }}
        >
          {count}
        </div>

        <div
          style={{
            fontSize: '5.5px',
            fontFamily: 'var(--font-mono)',
            color,
            width: 30,
            flexShrink: 0,
            textAlign: 'right',
            fontWeight: 700,
          }}
        >
          {count > 0 ? `${pct.toFixed(1)}%` : '—'}
        </div>
      </div>
    </div>
  )
}

export function TierConstraintMonitor({ entries }: Props) {
  const { total, constrained, constrainedPct, perTier, forcedUp, atMin, aboveMin, maxTierCount } =
    useMemo(() => {
      const constrainedEntries = entries.filter((e) => e.min_allowed_tier != null)
      const constrainedCount = constrainedEntries.length
      const constrainedPct = entries.length > 0 ? (constrainedCount / entries.length) * 100 : 0

      const perTierCount: Record<TierKey, number> = { tier1: 0, tier2: 0, tier3: 0 }
      let forcedUpCount = 0
      let atMinCount = 0
      let aboveMinCount = 0

      for (const e of constrainedEntries) {
        const minTier = e.min_allowed_tier as string
        const selTier = e.selected_tier

        if (minTier in perTierCount) {
          perTierCount[minTier as TierKey]++
        }

        const minNum = tierNum(minTier)
        const selNum = tierNum(selTier)

        if (selNum > minNum) {
          forcedUpCount++
        } else if (selNum === minNum) {
          atMinCount++
        } else {
          aboveMinCount++
        }
      }

      const maxTierCount = Math.max(...Object.values(perTierCount), 1)

      return {
        total: entries.length,
        constrained: constrainedCount,
        constrainedPct,
        perTier: perTierCount,
        forcedUp: forcedUpCount,
        atMin: atMinCount,
        aboveMin: aboveMinCount,
        maxTierCount,
      }
    }, [entries])

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.4rem 0.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '965ms',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: '0.1rem',
        }}
      >
        <span
          style={{
            fontSize: '9px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--muted-foreground)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Tier Constraints
        </span>
        <span
          style={{
            fontSize: '5.5px',
            fontFamily: 'var(--font-mono)',
            color: 'hsl(225 45% 20%)',
          }}
        >
          {total} reqs
        </span>
      </div>

      {total === 0 ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span
            style={{
              fontSize: '8px',
              fontFamily: 'var(--font-mono)',
              color: 'hsl(225 45% 20%)',
            }}
          >
            NO CONSTRAINT DATA
          </span>
        </div>
      ) : (
        <>
          {/* Key metric row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.1rem 0.4rem 0.2rem',
              borderBottom: '1px solid hsl(225 45% 12%)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '0.2rem',
              }}
            >
              <span
                style={{
                  fontSize: '14px',
                  fontFamily: 'var(--font-mono)',
                  color: 'hsl(185 80% 50%)',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                }}
              >
                {constrainedPct.toFixed(1)}%
              </span>
              <span
                style={{
                  fontSize: '6px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--muted-foreground)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                constrained
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '0.15rem',
              }}
            >
              <span
                style={{
                  fontSize: '9px',
                  fontFamily: 'var(--font-mono)',
                  color: constrained > 0 ? 'hsl(280 65% 65%)' : 'hsl(225 45% 45%)',
                  fontWeight: 600,
                }}
              >
                {forcedUp}
              </span>
              <span
                style={{
                  fontSize: '5px',
                  fontFamily: 'var(--font-mono)',
                  color: 'hsl(225 45% 20%)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                forced up
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '0.15rem',
              }}
            >
              <span
                style={{
                  fontSize: '9px',
                  fontFamily: 'var(--font-mono)',
                  color: 'hsl(225 45% 45%)',
                  fontWeight: 600,
                }}
              >
                {atMin}
              </span>
              <span
                style={{
                  fontSize: '5px',
                  fontFamily: 'var(--font-mono)',
                  color: 'hsl(225 45% 20%)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                at min
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '0.15rem',
              }}
            >
              <span
                style={{
                  fontSize: '9px',
                  fontFamily: 'var(--font-mono)',
                  color: 'hsl(145 65% 50%)',
                  fontWeight: 600,
                }}
              >
                {aboveMin}
              </span>
              <span
                style={{
                  fontSize: '5px',
                  fontFamily: 'var(--font-mono)',
                  color: 'hsl(225 45% 20%)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                above
              </span>
            </div>
          </div>

          {/* Column headers */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0 0.4rem 0.1rem',
              borderBottom: '1px solid hsl(225 45% 12%)',
            }}
          >
            {[
              ['TIER', 44],
              ['', 1],
              ['', 1],
              ['N', 26],
              ['%', 30],
            ].map(([label, width], i) => (
              <div
                key={i}
                style={{
                  fontSize: '4.5px',
                  fontFamily: 'var(--font-mono)',
                  color: 'hsl(225 45% 20%)',
                  letterSpacing: '0.06em',
                  width,
                  flexShrink: 0,
                  textAlign: i === 3 || i === 4 ? 'right' : 'left',
                }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Constraint bars per tier */}
          <div>
            {(Object.keys(perTier) as TierKey[]).map((tier) => (
              <ConstraintBar
                key={tier}
                tier={tier}
                count={perTier[tier]}
                pct={
                  constrained > 0 ? (perTier[tier] / constrained) * 100 : 0
                }
                maxCount={maxTierCount}
                color={TIER_COLORS[tier]}
              />
            ))}
          </div>

          {/* Footer legend */}
          <div
            style={{
              display: 'flex',
              gap: '0.4rem',
              paddingTop: '0.1rem',
              borderTop: '1px solid hsl(225 45% 12%)',
              flexWrap: 'wrap',
            }}
          >
            {([
              ['FORCED UP', 'hsl(280, 65%, 65%)'],
              ['AT MIN', 'hsl(225, 45%, 45%)'],
              ['ABOVE', 'hsl(145, 65%, 50%)'],
            ] as const).map(([label, color]) => (
              <div
                key={label}
                style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}
              >
                <div
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    background: color,
                  }}
                />
                <span
                  style={{
                    fontSize: '4.5px',
                    fontFamily: 'var(--font-mono)',
                    color: 'hsl(225 45% 25%)',
                  }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
