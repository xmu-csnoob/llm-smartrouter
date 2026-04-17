import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 15 * 60 * 1000
const MIN_SAMPLES = 15

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function shannonEntropy(counts: Record<string, number>): number {
  const total = Object.values(counts).reduce((s, n) => s + n, 0)
  if (total === 0) return 0
  let h = 0
  for (const count of Object.values(counts)) {
    if (count === 0) continue
    const p = count / total
    h -= p * Math.log2(p)
  }
  return h
}

type EntropyClass = 'HIGH' | 'MODERATE' | 'LOW'

// MAX_H = log2(3) ≈ 1.585 for 3 equal tiers; thresholds normalized to [0, MAX_H]
function entropyClass(h: number): EntropyClass {
  if (h > 1.3) return 'HIGH'
  if (h >= 0.7) return 'MODERATE'
  return 'LOW'
}

const TIER_COLORS: Record<string, string> = {
  tier1: 'hsl(280 65% 65%)',
  tier2: 'hsl(185 80% 55%)',
  tier3: 'hsl(145 65% 55%)',
  unknown: 'hsl(225 45% 35%)',
}

const TIER_LABELS: Record<string, string> = {
  tier1: 'Frontier',
  tier2: 'Workhorse',
  tier3: 'Routine',
}

interface EntropyStats {
  currentH: number
  prevH: number
  deltaH: number
  entropyClass: EntropyClass
  tierProbs: Record<string, number>
  tierCounts: Record<string, number>
  total: number
  windowSize: number
  methodBreakdown: Record<string, number>  // matched_by counts
  ruleCount: number
}

export function RoutingEntropyPanel({ entries }: { entries: LogEntry[] }) {
  const stats = useMemo((): EntropyStats | null => {
    const now = Date.now()
    const timed = entries
      .map(e => {
        const tsMs = parseTimestamp(e.timestamp)
        return tsMs == null ? null : { entry: e, tsMs }
      })
      .filter((item): item is { entry: LogEntry; tsMs: number } => item != null)
      .sort((a, b) => b.tsMs - a.tsMs)

    const recent = timed.filter(({ tsMs }) => now - tsMs <= WINDOW_MS)
    const window = recent.length >= MIN_SAMPLES ? recent : timed.slice(0, 80)
    if (window.length < MIN_SAMPLES) return null

    const midIdx = Math.floor(window.length / 2)
    const prevHalf = window.slice(midIdx)

    const logEntries = window.map(w => w.entry)
    const prevEntries = prevHalf.map(w => w.entry)

    // Current window tier counts
    const tierCounts: Record<string, number> = {}
    for (const e of logEntries) {
      const tier = e.routed_tier || 'unknown'
      tierCounts[tier] = (tierCounts[tier] || 0) + 1
    }

    const total = logEntries.length
    const tierProbs: Record<string, number> = {}
    for (const [tier, count] of Object.entries(tierCounts)) {
      tierProbs[tier] = count / total
    }

    const currentH = shannonEntropy(tierCounts)
    const prevTierCounts: Record<string, number> = {}
    for (const e of prevEntries) {
      const tier = e.routed_tier || 'unknown'
      prevTierCounts[tier] = (prevTierCounts[tier] || 0) + 1
    }
    const prevH = shannonEntropy(prevTierCounts)
    const deltaH = currentH - prevH

    // matched_by breakdown
    const methodBreakdown: Record<string, number> = {}
    for (const e of logEntries) {
      const method = e.matched_by || 'unknown'
      methodBreakdown[method] = (methodBreakdown[method] || 0) + 1
    }

    // Unique rules used
    const rules = new Set(logEntries.map(e => e.matched_rule).filter(Boolean))
    const ruleCount = rules.size

    return {
      currentH,
      prevH,
      deltaH,
      entropyClass: entropyClass(currentH),
      tierProbs,
      tierCounts,
      total,
      windowSize: window.length,
      methodBreakdown,
      ruleCount,
    }
  }, [entries])

  if (!stats) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '985ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT ROUTING DATA
        </div>
      </div>
    )
  }

  const { currentH, prevH, deltaH, entropyClass: ec, tierProbs, tierCounts, total, windowSize, methodBreakdown, ruleCount } = stats

  const classColor = ec === 'HIGH' ? 'hsl(0 72% 55%)' : ec === 'MODERATE' ? 'hsl(38 92% 55%)' : 'hsl(145 65% 55%)'
  const trendColor = deltaH > 0.05 ? 'hsl(0 72% 55%)' : deltaH < -0.05 ? 'hsl(145 65% 55%)' : 'hsl(225 45% 45%)'
  const trendArrow = deltaH > 0.05 ? '↑' : deltaH < -0.05 ? '↓' : '→'

  // Arc gauge: H goes from 0 to log2(3) ≈ 1.585 max for 3 equal tiers
  const MAX_H = Math.log2(3)
  const gaugeRatio = Math.min(currentH / MAX_H, 1)

  const GAUGE_CX = 80
  const GAUGE_CY = 70
  const GAUGE_R = 52
  const GAUGE_START_ANGLE = Math.PI * 0.75
  const GAUGE_END_ANGLE = Math.PI * 2.25
  const GAUGE_SWEEP = GAUGE_END_ANGLE - GAUGE_START_ANGLE

  const arcPath = (r: number, endAngle: number) => {
    const x = GAUGE_CX + r * Math.cos(GAUGE_START_ANGLE + endAngle * GAUGE_SWEEP)
    const y = GAUGE_CY + r * Math.sin(GAUGE_START_ANGLE + endAngle * GAUGE_SWEEP)
    const largeArc = endAngle * GAUGE_SWEEP > Math.PI ? 1 : 0
    return `M ${GAUGE_CX + r * Math.cos(GAUGE_START_ANGLE)} ${GAUGE_CY + r * Math.sin(GAUGE_START_ANGLE)} A ${r} ${r} 0 ${largeArc} 1 ${x} ${y}`
  }

  const needleAngle = GAUGE_START_ANGLE + gaugeRatio * GAUGE_SWEEP
  const needleX = GAUGE_CX + (GAUGE_R - 8) * Math.cos(needleAngle)
  const needleY = GAUGE_CY + (GAUGE_R - 8) * Math.sin(needleAngle)

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '985ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Routing Entropy
        </span>
        <div style={{ display: 'flex', gap: '0.15rem', alignItems: 'center' }}>
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: classColor, background: `${classColor}15`,
            border: `1px solid ${classColor}30`,
            borderRadius: 2, padding: '2px 5px',
            fontWeight: 700,
          }}>
            {ec === 'HIGH' ? 'HIGH ENTROPY' : ec === 'MODERATE' ? 'MODERATE' : 'LOW'}
          </span>
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: trendColor,
          }}>
            {trendArrow} Δ{(deltaH).toFixed(2)}
          </span>
        </div>
      </div>

      {/* Main content: gauge + tier bars */}
      <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'stretch' }}>
        {/* Arc gauge */}
        <div style={{ flex: '0 0 160px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <svg width={160} height={110} style={{ overflow: 'visible' }}>
            {/* Background track */}
            <path
              d={arcPath(GAUGE_R, 1)}
              fill="none"
              stroke="hsl(225 45% 10%)"
              strokeWidth={6}
              strokeLinecap="round"
            />
            {/* Colored segments */}
            {/* LOW zone: 0-0.7 */}
            <path
              d={arcPath(GAUGE_R, Math.min(0.7 / MAX_H, 1))}
              fill="none"
              stroke="hsl(145 65% 55%)"
              strokeWidth={4}
              strokeLinecap="round"
              opacity={0.7}
            />
            {/* MODERATE zone: 0.7-1.3 */}
            <path
              d={arcPath(GAUGE_R, Math.min(1.3 / MAX_H, 1))}
              fill="none"
              stroke="hsl(38 92% 55%)"
              strokeWidth={4}
              strokeLinecap="round"
              opacity={0.5}
            />
            {/* HIGH zone: 1.3-MAX_H */}
            <path
              d={arcPath(GAUGE_R, 1)}
              fill="none"
              stroke="hsl(0 72% 55%)"
              strokeWidth={4}
              strokeLinecap="round"
              opacity={0.7}
            />
            {/* Current value needle */}
            <line
              x1={GAUGE_CX}
              y1={GAUGE_CY}
              x2={needleX}
              y2={needleY}
              stroke={classColor}
              strokeWidth={1.5}
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 3px ${classColor}80)` }}
            />
            {/* Needle center dot */}
            <circle cx={GAUGE_CX} cy={GAUGE_CY} r={3} fill={classColor} opacity={0.8} />
            {/* H value label */}
            <text
              x={GAUGE_CX}
              y={GAUGE_CY + 18}
              fontSize="9"
              fill={classColor}
              fontFamily="var(--font-mono)"
              fontWeight={700}
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ filter: `drop-shadow(0 0 4px ${classColor}60)` }}
            >
              {currentH.toFixed(2)}
            </text>
            <text
              x={GAUGE_CX}
              y={GAUGE_CY + 27}
              fontSize="3.5"
              fill="hsl(225 45% 40%)"
              fontFamily="var(--font-mono)"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              bits/req
            </text>
            {/* Scale labels */}
            <text x={GAUGE_CX - GAUGE_R - 2} y={GAUGE_CY + 2} fontSize="3.5" fill="hsl(225 45% 30%)" fontFamily="var(--font-mono)" textAnchor="end">0</text>
            <text x={GAUGE_CX + GAUGE_R + 2} y={GAUGE_CY + 2} fontSize="3.5" fill="hsl(225 45% 30%)" fontFamily="var(--font-mono)" textAnchor="start">{MAX_H.toFixed(2)}</text>
          </svg>
        </div>

        {/* Right side: tier breakdown + method stats */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.12rem' }}>
          {/* Tier probability bars */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.08rem' }}>
            {(['tier1', 'tier2', 'tier3'] as const).map(tier => {
              const prob = tierProbs[tier] || 0
              const count = tierCounts[tier] || 0
              const color = TIER_COLORS[tier]
              const label = TIER_LABELS[tier]
              return (
                <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
                  <span style={{ width: 24, fontSize: '3.5px', fontFamily: 'var(--font-mono)', color, textAlign: 'right', flexShrink: 0 }}>
                    {label.slice(0, 3)}
                  </span>
                  <div style={{ flex: 1, height: 5, background: 'hsl(225 45% 10%)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(prob * 100).toFixed(1)}%`, background: color, borderRadius: 2, boxShadow: `0 0 4px ${color}40` }} />
                  </div>
                  <span style={{ width: 18, fontSize: '3.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 45%)', textAlign: 'right' }}>
                    {(prob * 100).toFixed(0)}%
                  </span>
                  <span style={{ width: 14, fontSize: '3px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 30%)' }}>
                    n={count}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Method breakdown */}
          <div style={{ display: 'flex', gap: '0.15rem', flexWrap: 'wrap' }}>
            {Object.entries(methodBreakdown).map(([method, count]) => (
              <span key={method} style={{
                fontSize: '3.5px', fontFamily: 'var(--font-mono)',
                color: 'hsl(185 80% 50%)',
                background: 'hsl(185 80% 50% / 0.08)',
                border: '1px solid hsl(185 80% 50% / 0.2)',
                borderRadius: 2, padding: '1px 4px',
              }}>
                {method} {count}
              </span>
            ))}
          </div>

          {/* Delta H vs prior half-window */}
          <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.05rem' }}>
            {[
              { label: 'Prev H', value: prevH.toFixed(2), color: 'hsl(225 45% 40%)' },
              { label: 'ΔH', value: (deltaH >= 0 ? '+' : '') + deltaH.toFixed(2), color: trendColor },
              { label: 'Rules', value: String(ruleCount), color: 'hsl(280 65% 60%)' },
              { label: 'Total', value: String(total), color: 'hsl(225 45% 60%)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontSize: '3px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 35%)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {label}
                </span>
                <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color, fontWeight: 700 }}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '5px',
        color: 'var(--muted-foreground)', textAlign: 'right', opacity: 0.7,
      }}>
        {windowSize} entries · 15-min window · H = -Σ p·log₂p · Δ vs prior half-window
      </div>
    </div>
  )
}
