import { useMemo } from 'react'
import type { LogEntry, SemanticFeatures } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

function getTotalTokens(tokensUsed: LogEntry['tokens_used']): number {
  if (tokensUsed == null) return 0
  if (typeof tokensUsed === 'number') return tokensUsed
  return (tokensUsed.input ?? 0) + (tokensUsed.output ?? 0)
}

function getTaskTypeScore(taskType: string | undefined): number {
  if (!taskType) return 0
  const t = taskType.toLowerCase()
  if (t === 'simple' || t === 'debug' || t === 'conflicts') return 0
  if (t === 'implementation') return 8
  if (t === 'analysis') return 15
  if (t === 'architecture' || t === 'design') return 20
  return 0
}

function getReasoningScore(sf: SemanticFeatures | undefined): number {
  if (!sf) return 0
  if (sf.requires_reasoning) return 20
  if (sf.clarification_needed_score > 0.5) return 10
  return 0
}

function complexityColor(score: number): string {
  if (score <= 30) return 'hsl(145 65% 55%)'     // green - simple
  if (score <= 60) return 'hsl(185 80% 50%)'     // cyan - moderate
  if (score <= 80) return 'hsl(45 85% 55%)'     // yellow - complex
  return 'hsl(0 72% 55%)'                       // red - critical
}

function complexityLabel(score: number): string {
  if (score <= 30) return 'SIMPLE'
  if (score <= 60) return 'MODERATE'
  if (score <= 80) return 'COMPLEX'
  return 'CRITICAL'
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const x1 = cx + r * Math.cos(toRad(startAngle))
  const y1 = cy + r * Math.sin(toRad(startAngle))
  const x2 = cx + r * Math.cos(toRad(endAngle))
  const y2 = cy + r * Math.sin(toRad(endAngle))
  const large = endAngle - startAngle > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
}

interface ScoreBreakdown {
  score: number
  tokenScore: number
  msgScore: number
  taskScore: number
  reasoningScore: number
}

function getBreakdown(entry: LogEntry): ScoreBreakdown {
  const tokens = getTotalTokens(entry.tokens_used)
  const tokenScore = Math.min((tokens / 32000) * 40, 40)
  const msgScore = Math.min((entry.message_count / 10) * 20, 20)
  const taskScore = getTaskTypeScore(entry.task_type)
  const reasoningScore = getReasoningScore(entry.semantic_features)
  const score = Math.min(tokenScore + msgScore + taskScore + reasoningScore, 100)
  return { score, tokenScore, msgScore, taskScore, reasoningScore }
}

export function RequestComplexityScore({ entries }: Props) {
  const stats = useMemo(() => {
    if (entries.length === 0) {
      return {
        scores: [] as number[],
        breakdowns: [] as ScoreBreakdown[],
        avg: 0,
        min: 0,
        max: 0,
        count: 0,
      }
    }

    const breakdowns = entries.map(getBreakdown)
    const scores = breakdowns.map(b => b.score)
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length
    const min = Math.min(...scores)
    const max = Math.max(...scores)
    const last10 = scores.slice(-10)

    return { scores: last10, breakdowns, avg, min, max, count: scores.length }
  }, [entries])

  const { scores, avg, min, max, count, breakdowns } = stats

  // Current = most recent entry's score
  const current = scores.length > 0 ? scores[scores.length - 1] : 0

  // SVG gauge parameters
  const size = 160
  const cx = size / 2
  const cy = size / 2 + 10
  const r = 60
  const startAngle = 180
  const endAngle = 0
  const gaugeSpan = 180

  const fillAngle = (current / 100) * gaugeSpan
  const fillEnd = startAngle - fillAngle

  const bgPath = arcPath(cx, cy, r, startAngle, endAngle)
  const fillPath = fillAngle > 0 ? arcPath(cx, cy, r, startAngle, fillEnd) : null

  const color = complexityColor(current)

  // Breakdown bars
  const breakdownBars = useMemo(() => {
    if (breakdowns.length === 0) return null
    // Use the most recent entry's breakdown
    const bd = breakdowns[breakdowns.length - 1]
    return [
      { label: 'TOKEN', value: bd.tokenScore, max: 40, color: 'hsl(185 80% 50%)' },
      { label: 'MESSAGE', value: bd.msgScore, max: 20, color: 'hsl(145 65% 55%)' },
      { label: 'TASK', value: bd.taskScore, max: 20, color: 'hsl(45 85% 55%)' },
      { label: 'REASONING', value: bd.reasoningScore, max: 20, color: 'hsl(280 60% 65%)' },
    ]
  }, [breakdowns])

  // Dot sparkline
  const sparkH = 28
  const sparkW = 140
  const sparkPoints = useMemo(() => {
    if (scores.length < 2) return ''
    const max = Math.max(...scores, 1)
    const min = Math.min(...scores)
    const range = max - min || 1
    return scores
      .map((v, i) => {
        const x = (i / (scores.length - 1)) * sparkW
        const y = sparkH - ((v - min) / range) * (sparkH - 4) - 2
        return `${x},${y}`
      })
      .join(' ')
  }, [scores])

  if (count === 0) {
    return (
      <div
        className="gs-panel"
        style={{
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          minHeight: 180,
          animation: 'fade-in-up 400ms ease both',
          animationDelay: '962ms',
        }}
      >
        <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Complexity Score
        </span>
        <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          NO DATA
        </span>
      </div>
    )
  }

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.375rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '962ms',
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
          Complexity Score
        </span>
        <span style={{
          fontSize: '7px',
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
          color: color,
          background: `${color}20`,
          border: `1px solid ${color}40`,
          borderRadius: 3,
          padding: '0.1rem 0.3rem',
        }}>
          {complexityLabel(current)}
        </span>
      </div>

      {/* Semi-circle gauge */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <svg width={size} height={size * 0.6} viewBox={`0 0 ${size} ${size * 0.7}`}>
          {/* Track */}
          <path
            d={bgPath}
            fill="none"
            stroke="hsl(225 45% 12%)"
            strokeWidth={10}
            strokeLinecap="round"
          />
          {/* Fill */}
          {fillPath && (
            <path
              d={fillPath}
              fill="none"
              stroke={color}
              strokeWidth={10}
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 4px ${color})` }}
            />
          )}
          {/* Tick marks */}
          {[0, 25, 50, 75, 100].map((tick) => {
            const angle = startAngle - (tick / 100) * gaugeSpan
            const toRad = (d: number) => (d * Math.PI) / 180
            const ix = cx + (r - 14) * Math.cos(toRad(angle))
            const iy = cy + (r - 14) * Math.sin(toRad(angle))
            return (
              <text
                key={tick}
                x={ix}
                y={iy}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', fill: 'var(--muted-foreground)' }}
              >
                {tick}
              </text>
            )
          })}
          {/* Center score */}
          <text
            x={cx}
            y={cy - 6}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ fontSize: '18px', fontFamily: 'var(--font-mono)', fontWeight: 700, fill: color }}
          >
            {current.toFixed(0)}
          </text>
          <text
            x={cx}
            y={cy + 10}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', fill: 'var(--muted-foreground)' }}
          >
            /100
          </text>
        </svg>
      </div>

      {/* Breakdown bars */}
      {breakdownBars && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {breakdownBars.map((bar) => (
            <div key={bar.label} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{
                fontSize: '6px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--muted-foreground)',
                width: '52px',
                textAlign: 'right',
              }}>
                {bar.label}
              </span>
              <div style={{
                flex: 1,
                height: 4,
                background: 'hsl(225 45% 12%)',
                borderRadius: 2,
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${(bar.value / bar.max) * 100}%`,
                  height: '100%',
                  background: bar.color,
                  borderRadius: 2,
                  boxShadow: `0 0 4px ${bar.color}`,
                }} />
              </div>
              <span style={{
                fontSize: '6px',
                fontFamily: 'var(--font-mono)',
                color: bar.color,
                width: '20px',
              }}>
                {bar.value.toFixed(0)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '0.2rem 0.3rem',
          borderRadius: 4,
          background: 'hsl(225 45% 10% / 0.5)',
          border: '1px solid hsl(225 45% 15%)',
        }}>
          <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Avg</span>
          <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'hsl(185 80% 55%)' }}>
            {avg.toFixed(1)}
          </span>
        </div>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '0.2rem 0.3rem',
          borderRadius: 4,
          background: 'hsl(225 45% 10% / 0.5)',
          border: '1px solid hsl(225 45% 15%)',
        }}>
          <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Min</span>
          <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'hsl(145 65% 60%)' }}>
            {min.toFixed(0)}
          </span>
        </div>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '0.2rem 0.3rem',
          borderRadius: 4,
          background: 'hsl(225 45% 10% / 0.5)',
          border: '1px solid hsl(225 45% 15%)',
        }}>
          <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Max</span>
          <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'hsl(0 72% 60%)' }}>
            {max.toFixed(0)}
          </span>
        </div>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '0.2rem 0.3rem',
          borderRadius: 4,
          background: 'hsl(225 45% 10% / 0.5)',
          border: '1px solid hsl(225 45% 15%)',
        }}>
          <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Count</span>
          <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--foreground)' }}>
            {count}
          </span>
        </div>
      </div>

      {/* Dot sparkline */}
      {scores.length >= 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
          <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>
            Trend · last {scores.length}
          </span>
          <svg width={sparkW} height={sparkH} viewBox={`0 0 ${sparkW} ${sparkH}`} preserveAspectRatio="none">
            <polyline
              points={sparkPoints}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 3px ${color})` }}
            />
            {scores.map((v, i) => {
              const x = (i / (scores.length - 1)) * sparkW
              const max = Math.max(...scores, 1)
              const min = Math.min(...scores)
              const range = max - min || 1
              const y = sparkH - ((v - min) / range) * (sparkH - 4) - 2
              return (
                <circle key={i} cx={x} cy={y} r={2} fill={color} style={{ filter: `drop-shadow(0 0 2px ${color})` }} />
              )
            })}
          </svg>
        </div>
      )}
    </div>
  )
}
