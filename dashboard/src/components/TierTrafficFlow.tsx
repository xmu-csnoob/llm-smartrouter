import { useRef } from 'react'
import { useI18n } from '@/i18n'
import type { Stats } from '@/hooks/useApi'

interface Props {
  stats: Stats | null
}

// Tier order for display
const TIER_ORDER = ['tier1', 'tier2', 'tier3']
const TIER_LABELS: Record<string, string> = {
  tier1: 'Frontier',
  tier2: 'Workhorse',
  tier3: 'Routine',
}
const TIER_COLORS: Record<string, string> = {
  tier1: 'hsl(280 65% 60%)',
  tier2: 'hsl(200 75% 55%)',
  tier3: 'hsl(145 65% 48%)',
}

function getTierFromModelName(name: string): string {
  const n = name.toLowerCase()
  if (/sonnet|opus|gpt-4|claude|gemini-2|grok/.test(n)) return 'tier1'
  if (/mini|tiny|gpt-3|haiku|qwen|deepseek-7/.test(n)) return 'tier3'
  return 'tier2'
}

export function TierTrafficFlow({ stats }: Props) {
  const { t } = useI18n()
  const canvasRef = useRef<SVGSVGElement>(null)

  if (!stats || Object.keys(stats.models).length === 0) {
    return (
      <div className="gs-empty-state">
        {t('chart.noData')}
      </div>
    )
  }

  const totalRequests = Object.values(stats.models).reduce((s, m) => s + m.count, 0)

  // Positions
  const TIER_X: Record<string, number> = { tier1: 120, tier2: 300, tier3: 480 }
  const TIER_Y = 90
  const MODEL_Y_TOP = 160
  const MODEL_SPACING = 36

  const allModels = Object.keys(stats.models)
  const maxCount = Math.max(...allModels.map((m) => stats.models[m].count))

  // Build connections: tier → model
  type Connection = { tx: number; ty: number; mx: number; my: number; width: number; count: number; model: string; tier: string }
  const connections: Connection[] = []

  allModels.forEach((model, i) => {
    const modelStats = stats.models[model]
    const tier = getTierFromModelName(model)
    const count = modelStats.count
    const width = Math.max(1, (count / maxCount) * 18)
    const my = MODEL_Y_TOP + i * MODEL_SPACING

    connections.push({
      tx: TIER_X[tier] + 40,
      ty: TIER_Y,
      mx: TIER_X[tier] - 20,
      my,
      width,
      count,
      model,
      tier,
    })
  })

  // Tier totals
  const tierTotals: Record<string, number> = { tier1: 0, tier2: 0, tier3: 0 }
  allModels.forEach((m) => {
    const tier = getTierFromModelName(m)
    tierTotals[tier] += stats.models[m].count
  })

  return (
    <div style={{ padding: '0.5rem 0.25rem', position: 'relative', overflow: 'hidden' }}>
      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', justifyContent: 'center' }}>
        {TIER_ORDER.map((tier) => (
          <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: TIER_COLORS[tier], boxShadow: `0 0 6px ${TIER_COLORS[tier]}` }} />
            <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
              {TIER_LABELS[tier]} ({tierTotals[tier].toLocaleString()})
            </span>
          </div>
        ))}
      </div>

      <svg ref={canvasRef} viewBox="0 0 600 320" style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        <defs>
          {TIER_ORDER.map((tier) => (
            <linearGradient key={tier} id={`flow-grad-${tier}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={TIER_COLORS[tier]} stopOpacity="0.6" />
              <stop offset="100%" stopColor={TIER_COLORS[tier]} stopOpacity="0.15" />
            </linearGradient>
          ))}
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Connection paths */}
        {connections.map((conn, i) => (
          <g key={i}>
            {/* Glow underlay */}
            <path
              d={`M ${conn.tx} ${conn.ty} C ${(conn.tx + conn.mx) / 2} ${conn.ty}, ${(conn.tx + conn.mx) / 2} ${conn.my}, ${conn.mx} ${conn.my}`}
              fill="none"
              stroke={TIER_COLORS[conn.tier]}
              strokeWidth={conn.width + 4}
              strokeOpacity="0.12"
              style={{ filter: 'url(#glow)' }}
            />
            {/* Main path */}
            <path
              d={`M ${conn.tx} ${conn.ty} C ${(conn.tx + conn.mx) / 2} ${conn.ty}, ${(conn.tx + conn.mx) / 2} ${conn.my}, ${conn.mx} ${conn.my}`}
              fill="none"
              stroke={`url(#flow-grad-${conn.tier})`}
              strokeWidth={conn.width}
              strokeLinecap="round"
              className="tier-flow-path"
              style={{
                '--tier-color': TIER_COLORS[conn.tier],
                animationDelay: `${i * 80}ms`,
              } as React.CSSProperties}
            />
            {/* Animated particle */}
            <circle r="2.5" fill={TIER_COLORS[conn.tier]} opacity="0.9">
              <animateMotion
                dur={`${1.2 + (conn.count / maxCount) * 1.5}s`}
                repeatCount="indefinite"
                path={`M ${conn.tx} ${conn.ty} C ${(conn.tx + conn.mx) / 2} ${conn.ty}, ${(conn.tx + conn.mx) / 2} ${conn.my}, ${conn.mx} ${conn.my}`}
              />
            </circle>
          </g>
        ))}

        {/* Tier nodes */}
        {TIER_ORDER.map((tier) => {
          const total = tierTotals[tier]
          const pct = totalRequests > 0 ? ((total / totalRequests) * 100).toFixed(0) : '0'
          return (
            <g key={tier}>
              {/* Tier card */}
              <rect
                x={TIER_X[tier] - 10}
                y={TIER_Y - 22}
                width={90}
                height={44}
                rx={6}
                fill="var(--card)"
                stroke={TIER_COLORS[tier]}
                strokeWidth={1.5}
                strokeOpacity={0.6}
                style={{ filter: `drop-shadow(0 0 8px ${TIER_COLORS[tier]}30)` }}
              />
              {/* Top accent line */}
              <rect x={TIER_X[tier] - 10} y={TIER_Y - 22} width={90} height={2} rx={1} fill={TIER_COLORS[tier]} />
              {/* Tier label */}
              <text
                x={TIER_X[tier] + 35}
                y={TIER_Y - 5}
                textAnchor="middle"
                fontSize={10}
                fontFamily="var(--font-mono)"
                fontWeight={700}
                fill={TIER_COLORS[tier]}
              >
                {TIER_LABELS[tier]}
              </text>
              {/* Count */}
              <text
                x={TIER_X[tier] + 35}
                y={TIER_Y + 10}
                textAnchor="middle"
                fontSize={14}
                fontFamily="var(--font-mono)"
                fontWeight={700}
                fill="var(--foreground)"
              >
                {total.toLocaleString()}
              </text>
              {/* Pct */}
              <text
                x={TIER_X[tier] + 35}
                y={TIER_Y + 22}
                textAnchor="middle"
                fontSize={8}
                fontFamily="var(--font-mono)"
                fill="var(--muted-foreground)"
              >
                {pct}% of traffic
              </text>
            </g>
          )
        })}

        {/* Model nodes */}
        {allModels.map((model, i) => {
          const modelStats = stats.models[model]
          const tier = getTierFromModelName(model)
          const my = MODEL_Y_TOP + i * MODEL_SPACING
          const barWidth = Math.max(4, (modelStats.count / maxCount) * 80)
          const isHighLatency = modelStats.avg_latency_ms > 3000
          const isError = modelStats.errors > 0

          return (
            <g key={model}>
              {/* Model label */}
              <text
                x={TIER_X[tier] - 22}
                y={my + 4}
                textAnchor="end"
                fontSize={9}
                fontFamily="var(--font-mono)"
                fill={isError ? 'hsl(0 72% 60%)' : 'var(--foreground)'}
              >
                {model.length > 16 ? model.slice(0, 15) + '…' : model}
              </text>
              {/* Bar */}
              <rect
                x={TIER_X[tier] - 20}
                y={my - 6}
                width={barWidth}
                height={12}
                rx={3}
                fill={TIER_COLORS[tier]}
                opacity={0.5}
                style={{ filter: isError ? `drop-shadow(0 0 4px hsl(0 72% 60%))` : undefined }}
              />
              {/* Count badge */}
              <rect
                x={TIER_X[tier] - 20 + barWidth + 3}
                y={my - 6}
                width={40}
                height={12}
                rx={3}
                fill="var(--muted)"
                stroke="var(--border)"
                strokeWidth={0.5}
              />
              <text
                x={TIER_X[tier] - 20 + barWidth + 23}
                y={my + 4}
                textAnchor="middle"
                fontSize={8}
                fontFamily="var(--font-mono)"
                fill={isHighLatency ? 'hsl(25 95% 60%)' : 'var(--muted-foreground)'}
              >
                {modelStats.avg_latency_ms}ms
              </text>
              {/* Error indicator */}
              {isError && (
                <circle cx={TIER_X[tier] + 75} cy={my} r={3} fill="hsl(0 72% 60%)" style={{ filter: 'url(#glow)' }} />
              )}
            </g>
          )
        })}
      </svg>

      <style>{`
        .tier-flow-path {
          stroke-dasharray: 600;
          stroke-dashoffset: 600;
          animation: tier-flow-draw 1.2s ease-out forwards;
        }
        @keyframes tier-flow-draw {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  )
}
