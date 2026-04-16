import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const TIER_NODES = [
  { key: 'tier1', label: 'T1', desc: 'Frontier', color: 'hsl(280 65% 65%)' },
  { key: 'tier2', label: 'T2', desc: 'Workhorse', color: 'hsl(200 75% 55%)' },
  { key: 'tier3', label: 'T3', desc: 'Routine', color: 'hsl(145 65% 50%)' },
] as const

const DEGRADATION_STEPS = [
  { from: 'tier1', to: 'tier2' },
  { from: 'tier2', to: 'tier3' },
  { from: 'tier1', to: 'tier3' },
] as const

interface FallbackStep {
  from: string
  to: string
  count: number
  isDirect: boolean
}

export function FallbackCascadeDiagram({ entries }: Props) {
  const steps = useMemo((): FallbackStep[] => {
    const counts: Record<string, number> = {}

    for (const entry of entries) {
      if (!entry.is_fallback) continue

      // Build path from fallback_chain
      if (entry.fallback_chain && entry.fallback_chain.length > 0) {
        const chain = entry.fallback_chain
        for (let i = 0; i < chain.length - 1; i++) {
          const from = chain[i].tier
          const to = chain[i + 1].tier
          const key = `${from}→${to}`
          counts[key] = (counts[key] ?? 0) + 1
        }
        // Direct degradation: from selected_tier to first chain tier
        if (chain.length >= 1) {
          const from = entry.selected_tier || entry.routed_tier
          const to = chain[0].tier
          if (from !== to) {
            const directKey = `${from}→${to}`
            counts[directKey] = (counts[directKey] ?? 0) + 1
          }
        }
      } else if (entry.degraded_to_tier) {
        const from = entry.selected_tier || entry.routed_tier
        const to = entry.degraded_to_tier
        const key = `${from}→${to}`
        counts[key] = (counts[key] ?? 0) + 1
      }
    }

    return DEGRADATION_STEPS.map(s => ({
      ...s,
      count: counts[`${s.from}→${s.to}`] ?? 0,
      isDirect: true,
    }))
  }, [entries])

  const totalFallbacks = steps.reduce((s, st) => s + st.count, 0)
  const maxCount = Math.max(...steps.map(s => s.count), 1)

  const tierFallbackCount = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const entry of entries) {
      if (entry.is_fallback) {
        const tier = entry.degraded_to_tier || entry.routed_tier
        if (tier) counts[tier] = (counts[tier] ?? 0) + 1
      }
    }
    return counts
  }, [entries])

  const getEdgeWidth = (count: number) => {
    if (count === 0) return 1
    return Math.max(2, Math.min(8, (count / maxCount) * 8))
  }

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '840ms',
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
            Fallback Cascade
          </span>
          <div style={{
            width: 5, height: 5, borderRadius: '50%',
            background: totalFallbacks > 0 ? 'hsl(38 92% 55%)' : 'hsl(145 65% 55%)',
            boxShadow: `0 0 6px ${totalFallbacks > 0 ? 'hsl(38 92% 55%)' : 'hsl(145 65% 55%)'}`,
            animation: totalFallbacks > 0 ? 'pulse-dot 1.5s ease-in-out infinite' : 'none',
          }} />
        </div>
        {totalFallbacks === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'hsl(145 65% 55%)', boxShadow: '0 0 4px hsl(145 65% 55%)' }} />
            <span style={{ fontSize: '5.5px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'hsl(145 65% 55%)', letterSpacing: '0.05em' }}>NOMINAL</span>
          </div>
        ) : (
          <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'hsl(38 92% 60%)', fontWeight: 600 }}>
            {totalFallbacks} events
          </span>
        )}
      </div>

      {/* Cascade visualization */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.5rem 0.25rem',
        position: 'relative',
      }}>
        {/* SVG for edges */}
        <svg
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
        >
          {/* T1 → T2 */}
          {steps[0].count > 0 && (
            <g>
              <defs>
                <marker id="arrow-t1-t2" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
                  <path d="M0,0 L4,2 L0,4 Z" fill={TIER_NODES[0].color} />
                </marker>
              </defs>
              <line
                x1="28%" y1="50%" x2="46%" y2="50%"
                stroke={TIER_NODES[0].color}
                strokeWidth={getEdgeWidth(steps[0].count)}
                strokeOpacity={0.6 + (steps[0].count / maxCount) * 0.4}
                strokeDasharray={steps[0].count > 0 ? 'none' : '3,2'}
                markerEnd="url(#arrow-t1-t2)"
              />
            </g>
          )}
          {/* T2 → T3 */}
          {steps[1].count > 0 && (
            <g>
              <defs>
                <marker id="arrow-t2-t3" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
                  <path d="M0,0 L4,2 L0,4 Z" fill={TIER_NODES[1].color} />
                </marker>
              </defs>
              <line
                x1="54%" y1="50%" x2="72%" y2="50%"
                stroke={TIER_NODES[1].color}
                strokeWidth={getEdgeWidth(steps[1].count)}
                strokeOpacity={0.6 + (steps[1].count / maxCount) * 0.4}
                markerEnd="url(#arrow-t2-t3)"
              />
            </g>
          )}
          {/* T1 → T3 (skip) */}
          {steps[2].count > 0 && (
            <g>
              <defs>
                <marker id="arrow-t1-t3" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
                  <path d="M0,0 L4,2 L0,4 Z" fill={TIER_NODES[2].color} />
                </marker>
              </defs>
              <path
                d="M 22% 35% Q 50% 10% 78% 35%"
                stroke={TIER_NODES[2].color}
                strokeWidth={getEdgeWidth(steps[2].count)}
                strokeOpacity={0.5}
                fill="none"
                strokeDasharray="4,2"
                markerEnd="url(#arrow-t1-t3)"
              />
            </g>
          )}
          {/* No-data edges (dashed) */}
          {steps[0].count === 0 && (
            <line x1="28%" y1="50%" x2="46%" y2="50%" stroke="hsl(225 45% 15%)" strokeWidth={1} strokeDasharray="3,2" />
          )}
          {steps[1].count === 0 && (
            <line x1="54%" y1="50%" x2="72%" y2="50%" stroke="hsl(225 45% 15%)" strokeWidth={1} strokeDasharray="3,2" />
          )}
          {steps[2].count === 0 && (
            <path d="M 22% 35% Q 50% 10% 78% 35%" stroke="hsl(225 45% 12%)" strokeWidth={1} fill="none" strokeDasharray="3,2" />
          )}
        </svg>

        {/* Tier nodes */}
        {TIER_NODES.map(({ key, label, desc, color }) => {
          const fallbackCount = tierFallbackCount[key] ?? 0
          const isActive = fallbackCount > 0
          return (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem', zIndex: 1 }}>
              <div style={{
                width: 40, height: 40,
                borderRadius: '50%',
                border: `2px solid ${isActive ? color : 'hsl(225 45% 15%)'}`,
                background: isActive ? `${color}20` : 'hsl(225 45% 8%)',
                boxShadow: isActive ? `0 0 10px ${color}40, 0 0 20px ${color}20` : 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                transition: 'all 400ms ease',
              }}>
                <span style={{
                  fontSize: '10px', fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  color: isActive ? color : 'hsl(225 45% 25%)',
                  lineHeight: 1,
                }}>
                  {label}
                </span>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: isActive ? color : 'var(--muted-foreground)', fontWeight: 600 }}>{desc}</div>
                {isActive && (
                  <div style={{
                    fontSize: '6px', fontFamily: 'var(--font-mono)',
                    color: 'hsl(38 92% 60%)', fontWeight: 700, marginTop: 1,
                  }}>
                    -{fallbackCount}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Edge labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 0.25rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
          {steps.filter(s => s.count > 0).map(s => (
            <div key={`${s.from}→${s.to}`} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
              <div style={{
                width: 6, height: getEdgeWidth(s.count),
                background: TIER_NODES.find(t => t.key === s.from)?.color ?? 'hsl(0 0% 50%)',
                borderRadius: 2,
              }} />
              <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
                {s.from.replace('tier','T')}→{s.to.replace('tier','T')}: {s.count}
              </span>
            </div>
          ))}
          {steps.every(s => s.count === 0) && (
            <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'hsl(145 65% 55%)' }}>
              No fallbacks recorded
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
            Line width = fallback frequency
          </span>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            Dashed = no events
          </span>
        </div>
      </div>
    </div>
  )
}
