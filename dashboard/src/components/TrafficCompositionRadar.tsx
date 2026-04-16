import { useMemo } from 'react'
import type { Stats } from '@/hooks/useApi'

interface Props {
  stats: Stats | null
}

const INTENT_LABELS: Record<string, string> = {
  debug: 'Debug',
  design: 'Design',
  implementation: 'Impl',
  review: 'Review',
  explain: 'Explain',
  generation: 'Generation',
  reasoning: 'Reasoning',
  constraints: 'Constraints',
  comparison: 'Comparison',
  migration: 'Migration',
  performance: 'Perf',
}

const INTENT_COLORS: Record<string, string> = {
  debug: 'hsl(0 72% 60%)',
  design: 'hsl(280 65% 60%)',
  implementation: 'hsl(200 75% 55%)',
  review: 'hsl(145 65% 48%)',
  explain: 'hsl(45 85% 50%)',
  generation: 'hsl(330 70% 55%)',
  reasoning: 'hsl(190 80% 45%)',
  constraints: 'hsl(260 65% 65%)',
  comparison: 'hsl(30 80% 55%)',
  migration: 'hsl(170 60% 55%)',
  performance: 'hsl(15 90% 55%)',
}

export function TrafficCompositionRadar({ stats }: Props) {
  const { intents, maxCount } = useMemo(() => {
    if (!stats?.intent_distribution) return { intents: [], maxCount: 1 }
    const entries = Object.entries(stats.intent_distribution)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
    const total = entries.reduce((s, [, c]) => s + c, 0)
    const max = entries[0]?.[1] ?? 1
    return {
      intents: entries.map(([name, count]) => ({
        name,
        label: INTENT_LABELS[name] ?? name,
        count,
        pct: total > 0 ? (count / total) * 100 : 0,
        color: INTENT_COLORS[name] ?? 'hsl(200 75% 55%)',
      })),
      maxCount: max,
    }
  }, [stats])

  if (!stats || intents.length === 0) {
    return (
      <div className="gs-empty-state" style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          NO INTENT DATA
        </div>
      </div>
    )
  }

  const cx = 140
  const cy = 130
  const maxR = 95

  // Build polygon points for the radar
  const points = intents.map((intent, i) => {
    const angle = (i / intents.length) * 2 * Math.PI - Math.PI / 2
    const r = maxR * (intent.count / maxCount)
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      ...intent,
    }
  })

  // Grid circles at 25%, 50%, 75%, 100%
  const gridLevels = [0.25, 0.5, 0.75, 1.0]

  return (
    <div style={{ padding: '0.5rem 0.25rem 0.25rem 0.25rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.125rem' }}>
        <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Intent Distribution
        </span>
        <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          {stats.total} total
        </span>
      </div>

      {/* Radar SVG */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <svg width="280" height="220" viewBox="0 0 280 220">
          {/* Background grid circles */}
          {gridLevels.map((level) => (
            <circle
              key={level}
              cx={cx}
              cy={cy}
              r={maxR * level}
              fill="none"
              stroke="var(--border)"
              strokeWidth="0.5"
              strokeDasharray={level === 1 ? 'none' : '3 3'}
              opacity={level === 1 ? 0.8 : 0.4}
            />
          ))}

          {/* Axis lines */}
          {intents.map((_, i) => {
            const angle = (i / intents.length) * 2 * Math.PI - Math.PI / 2
            const x2 = cx + maxR * Math.cos(angle)
            const y2 = cy + maxR * Math.sin(angle)
            return (
              <line
                key={i}
                x1={cx}
                y1={cy}
                x2={x2}
                y2={y2}
                stroke="var(--border)"
                strokeWidth="0.5"
                opacity="0.5"
              />
            )
          })}

          {/* Data polygon fill */}
          {points.length >= 3 && (
            <polygon
              points={points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="hsl(185 80% 50% / 0.15)"
              stroke="hsl(185 80% 50%)"
              strokeWidth="1.5"
              strokeLinejoin="round"
              style={{
                filter: 'drop-shadow(0 0 6px hsl(185 80% 50% / 0.4))',
              }}
            />
          )}

          {/* Data points */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={3.5}
              fill={p.color}
              stroke="var(--card)"
              strokeWidth="1.5"
              style={{ filter: `drop-shadow(0 0 4px ${p.color}80)` }}
            />
          ))}

          {/* Axis labels */}
          {points.map((p, i) => {
            const labelR = maxR + 16
            const angle = (i / intents.length) * 2 * Math.PI - Math.PI / 2
            const lx = cx + labelR * Math.cos(angle)
            const ly = cy + labelR * Math.sin(angle)
            const anchor =
              Math.abs(lx - cx) < 10 ? 'middle' : lx > cx ? 'start' : 'end'
            return (
              <text
                key={i}
                x={lx}
                y={ly}
                textAnchor={anchor}
                dominantBaseline="middle"
                fill={p.color}
                fontSize="8"
                fontFamily="var(--font-mono)"
                fontWeight="600"
              >
                {p.label}
              </text>
            )
          })}

          {/* Center dot */}
          <circle cx={cx} cy={cy} r="2" fill="var(--muted-foreground)" opacity="0.6" />
        </svg>
      </div>

      {/* Legend with pct bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', padding: '0 0.25rem' }}>
        {intents.slice(0, 7).map((intent) => (
          <div key={intent.name} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: intent.color, flexShrink: 0, boxShadow: `0 0 4px ${intent.color}80` }} />
            <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', width: 36, flexShrink: 0 }}>{intent.label}</span>
            <div style={{ flex: 1, height: 3, background: 'var(--muted)', borderRadius: 2, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${intent.pct}%`,
                  height: '100%',
                  background: intent.color,
                  borderRadius: 2,
                  opacity: 0.75,
                  transition: 'width 600ms ease',
                }}
              />
            </div>
            <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'var(--foreground)', width: 28, textAlign: 'right', flexShrink: 0 }}>
              {intent.pct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
