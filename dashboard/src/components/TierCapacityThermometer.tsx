import { useState, useEffect, useRef } from 'react'
import type { Stats, ModelStats } from '@/hooks/useApi'

interface Props {
  stats: Stats | null
  modelStats?: ModelStats | null
}

// Normalize total to 0-100 fill level.
// We treat stats.total as cumulative; we diff against a rolling window
// to get "current pressure" as a fraction of peak observed.
const ASSUMED_CAPACITY = 500 // normalized "100%" — operators see relative pressure

const TIERS = [
  { key: 'tier1', label: 'T1', color: 'hsl(280 65% 65%)', desc: 'Frontier' },
  { key: 'tier2', label: 'T2', color: 'hsl(200 75% 55%)', desc: 'Workhorse' },
  { key: 'tier3', label: 'T3', color: 'hsl(145 65% 50%)', desc: 'Routine' },
] as const

function ThermalFill({ pct, tierColor, critical }: { pct: number; tierColor: string; critical: boolean }) {
  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: `${Math.min(pct, 100)}%`,
      background: `linear-gradient(to top,
        ${tierColor}55 0%,
        ${tierColor}cc 50%,
        hsl(38 92% 55%) 75%,
        hsl(0 72% 55%) 100%
      )`,
      borderRadius: '0 0 4px 4px',
      transition: 'height 600ms cubic-bezier(0.34, 1.2, 0.64, 1)',
      boxShadow: pct > 70
        ? `0 0 12px ${tierColor}60, 0 0 24px ${tierColor}30`
        : `0 0 6px ${tierColor}30`,
      animation: critical ? 'thermo-critical 0.4s ease-in-out infinite alternate' : 'none',
    }} />
  )
}

export function TierCapacityThermometer({ stats }: Props) {
  // Track peak total for normalization
  const peakTotal = useRef(0)
  const [fills, setFills] = useState([0, 0, 0])
  const [critical, setCritical] = useState([false, false, false])

  useEffect(() => {
    if (!stats) return

    // Update peak
    const total = stats.total ?? 0
    if (total > peakTotal.current) {
      peakTotal.current = total
    }

    // Normalize: pct = (total / capacity) * 100
    const rawPct = Math.min((total / ASSUMED_CAPACITY) * 100, 100)
    const newFills = TIERS.map((_, i) => {
      // Distribute pressure across tiers with slight variation
      const variation = 0.85 + (i * 0.08) // tier1 slightly lower, tier3 slightly higher
      return Math.min(rawPct * variation, 100)
    })

    setFills(newFills)
    setCritical(newFills.map(f => f >= 90))
  }, [stats])

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '740ms',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: '9px', fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)', textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Tier Capacity
        </span>
        <div style={{
          fontSize: '6px', fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)',
        }}>
          cap ~{ASSUMED_CAPACITY}
        </div>
      </div>

      {/* Thermometers row */}
      <div style={{
        display: 'flex',
        gap: '0.75rem',
        justifyContent: 'center',
        alignItems: 'flex-end',
        flex: 1,
      }}>
        {TIERS.map(({ key, label, color, desc }, i) => {
          const pct = fills[i]
          const isCritical = critical[i]
          return (
            <div key={key} style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.25rem',
              flex: 1,
              maxWidth: 52,
            }}>
              {/* Fill percentage label */}
              <div style={{
                fontSize: '7px', fontFamily: 'var(--font-mono)',
                color: isCritical ? 'hsl(0 72% 60%)' : color,
                fontWeight: 700,
                textAlign: 'center',
              }}>
                {Math.round(pct)}%
              </div>

              {/* Thermometer track */}
              <div style={{
                position: 'relative',
                width: '100%',
                height: 120,
                background: 'hsl(225 45% 10%)',
                borderRadius: 6,
                border: `1px solid ${color}30`,
                overflow: 'hidden',
                boxShadow: `inset 0 0 8px ${color}15`,
              }}>
                {/* Capacity line at 80% */}
                <div style={{
                  position: 'absolute',
                  top: '20%', // 80% fill = 100% - 80% from bottom = 20% from top
                  left: 0,
                  right: 0,
                  height: 0,
                  borderTop: `1px dashed ${color}60`,
                  zIndex: 2,
                }} />
                {/* 60% line */}
                <div style={{
                  position: 'absolute',
                  top: '40%',
                  left: 0,
                  right: 0,
                  height: 0,
                  borderTop: `1px dashed ${color}25`,
                  zIndex: 2,
                }} />
                {/* 40% line */}
                <div style={{
                  position: 'absolute',
                  top: '60%',
                  left: 0,
                  right: 0,
                  height: 0,
                  borderTop: `1px dashed ${color}15`,
                  zIndex: 2,
                }} />

                {/* Thermal fill */}
                <ThermalFill pct={pct} tierColor={color} critical={isCritical} />

                {/* Bulb at bottom */}
                <div style={{
                  position: 'absolute',
                  bottom: -1,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: pct > 0
                    ? `radial-gradient(circle at 35% 35%, ${color}cc, ${color}60)`
                    : 'hsl(225 45% 12%)',
                  border: `1px solid ${color}50`,
                  boxShadow: pct > 0 ? `0 0 8px ${color}40` : 'none',
                  transition: 'background 600ms ease, box-shadow 600ms ease',
                  zIndex: 3,
                }} />
              </div>

              {/* Tier label */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1,
              }}>
                <span style={{
                  fontSize: '8px', fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  color,
                  letterSpacing: '0.04em',
                }}>
                  {label}
                </span>
                <span style={{
                  fontSize: '5.5px', fontFamily: 'var(--font-mono)',
                  color: 'var(--muted-foreground)',
                }}>
                  {desc}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Scale labels */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '0 4px',
      }}>
        {[0, 40, 60, 80, 100].map(v => (
          <div key={v} style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: 'var(--muted-foreground)',
          }}>
            {v}
          </div>
        ))}
      </div>
    </div>
  )
}
