import { useState, useEffect, useRef } from 'react'
import type { Stats } from '@/hooks/useApi'

interface Props {
  stats: Stats | null
}

// Hardcoded cost-per-request estimates per tier (USD)
const COST_PER_REQUEST: Record<string, number> = {
  tier1: 0.012,
  tier2: 0.003,
  tier3: 0.0008,
}

const TIERS = [
  { key: 'tier1', label: 'T1', color: 'hsl(280 65% 65%)', desc: 'Frontier' },
  { key: 'tier2', label: 'T2', color: 'hsl(200 75% 55%)', desc: 'Workhorse' },
  { key: 'tier3', label: 'T3', color: 'hsl(145 65% 50%)', desc: 'Routine' },
] as const

// Rolling window: estimate requests per minute from total delta
const WINDOW_MS = 60_000

interface TierCost {
  tier: string
  costPerMin: number
  pct: number
  reqPerMin: number
}

function AnimatedNumber({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const prev = useRef(value)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (value !== prev.current) {
      setFlash(true)
      prev.current = value
      setTimeout(() => setFlash(false), 400)
    }
  }, [value])

  return (
    <span style={{
      fontFamily: 'var(--font-mono)',
      fontWeight: 700,
      fontSize: '8px',
      color: flash ? 'hsl(185 80% 60%)' : 'var(--foreground)',
      transition: 'color 200ms ease',
    }}>
      {prefix}{value.toFixed(4)}{suffix}
    </span>
  )
}

export function CostAttributionMeter({ stats }: Props) {
  const prevTotal = useRef(0)
  const prevTimestamp = useRef(0)
  const [tierCosts, setTierCosts] = useState<TierCost[]>([])
  const [totalCostPerMin, setTotalCostPerMin] = useState(0)

  useEffect(() => {
    if (!stats) return

    const now = Date.now()
    const total = stats.total ?? 0
    const dt = prevTimestamp.current > 0 ? (now - prevTimestamp.current) : WINDOW_MS

    // Estimate requests in last window
    const requestsInWindow = Math.max(total - prevTotal.current, 0)
    const reqPerMin = prevTimestamp.current > 0
      ? (requestsInWindow / dt) * WINDOW_MS
      : 0

    prevTotal.current = total
    prevTimestamp.current = now

    // Distribute across tiers (rough proxy based on fallback/error rates)
    const fallbackRate = stats.fallback_rate ?? 0
    const tierWeights = [
      0.08 + (fallbackRate / 100) * 0.04,  // T1: 8-12%
      0.55 - (fallbackRate / 100) * 0.1,   // T2: 45-55%
      0.37 + (fallbackRate / 100) * 0.06,   // T3: 37-43%
    ]

    const costs: TierCost[] = TIERS.map(({ key }, i) => {
      const reqForTier = reqPerMin * tierWeights[i]
      const costForTier = reqForTier * (COST_PER_REQUEST[key] ?? 0.001)
      return {
        tier: key,
        costPerMin: costForTier,
        pct: 0,
        reqPerMin,
      }
    })

    const totalCost = costs.reduce((s, c) => s + c.costPerMin, 0)
    costs.forEach(c => { c.pct = totalCost > 0 ? (c.costPerMin / totalCost) * 100 : 0 })

    setTierCosts(costs)
    setTotalCostPerMin(totalCost)
  }, [stats])

  const maxCost = Math.max(...tierCosts.map(c => c.costPerMin), 0.0001)

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '780ms',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: '9px', fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)', textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Cost Attribution
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <span style={{
            fontSize: '7px', fontFamily: 'var(--font-mono)',
            color: 'var(--muted-foreground)',
          }}>
            $
          </span>
          <AnimatedNumber value={totalCostPerMin} />
          <span style={{
            fontSize: '6px', fontFamily: 'var(--font-mono)',
            color: 'var(--muted-foreground)',
          }}>
            /min
          </span>
        </div>
      </div>

      {/* Stacked bar */}
      <div style={{
        display: 'flex',
        height: 20,
        borderRadius: 4,
        overflow: 'hidden',
        border: '1px solid hsl(225 45% 15%)',
        boxShadow: 'inset 0 0 8px hsl(225 45% 6% / 0.5)',
      }}>
        {tierCosts.map(({ tier, costPerMin, pct }, i) => {
          const tierInfo = TIERS[i]
          const widthPct = (costPerMin / maxCost) * 100
          return (
            <div
              key={tier}
              style={{
                width: `${widthPct}%`,
                background: `linear-gradient(135deg, ${tierInfo.color}40, ${tierInfo.color}80)`,
                borderRight: i < tierCosts.length - 1 ? `1px solid hsl(225 45% 10%)` : 'none',
                boxShadow: `inset 0 1px 0 ${tierInfo.color}30`,
                transition: 'width 600ms cubic-bezier(0.34, 1.2, 0.64, 1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
              title={`${tierInfo.label}: $${costPerMin.toFixed(4)}/min`}
            >
              {pct > 15 && (
                <span style={{
                  fontSize: '6px', fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  color: tierInfo.color,
                  textShadow: `0 0 4px ${tierInfo.color}`,
                  whiteSpace: 'nowrap',
                }}>
                  {pct.toFixed(0)}%
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Per-tier breakdown */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {tierCosts.map(({ tier, costPerMin, reqPerMin }, i) => {
          const tierInfo = TIERS[i]
          const tierReqRate = reqPerMin * (
            tier === 'tier1' ? 0.1 :
            tier === 'tier2' ? 0.5 :
            0.4
          )
          return (
            <div key={tier} style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.1rem',
              padding: '0.2rem 0.3rem',
              borderRadius: 4,
              background: `${tierInfo.color}10`,
              border: `1px solid ${tierInfo.color}25`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{
                  fontSize: '7px', fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  color: tierInfo.color,
                }}>
                  {tierInfo.label}
                </span>
                <span style={{
                  fontSize: '7px', fontFamily: 'var(--font-mono)',
                  color: 'var(--muted-foreground)',
                }}>
                  ${costPerMin.toFixed(4)}
                </span>
              </div>
              <div style={{
                fontSize: '5.5px', fontFamily: 'var(--font-mono)',
                color: 'var(--muted-foreground)',
              }}>
                ~{Math.round(tierReqRate)} req/m
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
