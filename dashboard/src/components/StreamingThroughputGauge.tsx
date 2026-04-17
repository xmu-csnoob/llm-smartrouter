import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const MAX_THROUGHPUT = 100 // tok/s max for gauge

function getTotalTokens(tokensUsed: LogEntry['tokens_used']): number {
  if (tokensUsed == null) return 0
  if (typeof tokensUsed === 'number') return tokensUsed
  return (tokensUsed.input ?? 0) + (tokensUsed.output ?? 0)
}

function getThroughput(entry: LogEntry): number | null {
  if (!entry.is_stream) return null
  const tokens = getTotalTokens(entry.tokens_used)
  if (tokens <= 0 || entry.latency_ms == null || entry.latency_ms <= 0) return null
  return tokens / (entry.latency_ms / 1000)
}

function throughputColor(tps: number): string {
  if (tps > 30) return 'hsl(145 65% 55%)'     // green
  if (tps >= 15) return 'hsl(185 80% 50%)'   // cyan
  if (tps >= 5) return 'hsl(45 85% 55%)'    // yellow
  return 'hsl(0 72% 55%)'                     // red
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

export function StreamingThroughputGauge({ entries }: Props) {
  const stats = useMemo(() => {
    const throughputs: number[] = []
    let streamingCount = 0
    let nonStreamingCount = 0

    for (const entry of entries) {
      if (entry.is_stream) {
        streamingCount++
        const t = getThroughput(entry)
        if (t != null) throughputs.push(t)
      } else {
        nonStreamingCount++
      }
    }

    if (throughputs.length === 0) {
      return { current: 0, peak: 0, avg: 0, throughputs: [], streamingCount, nonStreamingCount, health: 'POOR' as const }
    }

    const peak = Math.max(...throughputs)
    const avg = throughputs.reduce((s, v) => s + v, 0) / throughputs.length
    const current = throughputs[throughputs.length - 1]

    let health: 'NOMINAL' | 'DEGRADED' | 'POOR'
    if (avg > 15) health = 'NOMINAL'
    else if (avg >= 5) health = 'DEGRADED'
    else health = 'POOR'

    // Last 10 throughputs for sparkline
    const sparklineData = throughputs.slice(-10)

    return { current, peak, avg, throughputs: sparklineData, streamingCount, nonStreamingCount, health }
  }, [entries])

  const { current, peak, avg, throughputs, streamingCount, nonStreamingCount, health } = stats

  // SVG gauge parameters
  const size = 160
  const cx = size / 2
  const cy = size / 2 + 10
  const r = 60
  const startAngle = 180
  const endAngle = 0
  const gaugeSpan = 180 // degrees

  const fillAngle = Math.min((current / MAX_THROUGHPUT) * gaugeSpan, gaugeSpan)
  const fillEnd = startAngle - fillAngle

  const bgPath = arcPath(cx, cy, r, startAngle, endAngle)
  const fillPath = fillAngle > 0 ? arcPath(cx, cy, r, startAngle, fillEnd) : null

  const color = throughputColor(current)

  // Sparkline points (SVG polyline)
  const sparkH = 32
  const sparkW = 140
  const sparkPoints = useMemo(() => {
    if (throughputs.length < 2) return ''
    const max = Math.max(...throughputs, 1)
    const min = Math.min(...throughputs)
    const range = max - min || 1
    return throughputs
      .map((v, i) => {
        const x = (i / (throughputs.length - 1)) * sparkW
        const y = sparkH - ((v - min) / range) * (sparkH - 4) - 2
        return `${x},${y}`
      })
      .join(' ')
  }, [throughputs])

  const healthColor =
    health === 'NOMINAL' ? 'hsl(145 65% 55%)' :
    health === 'DEGRADED' ? 'hsl(45 85% 55%)' :
    'hsl(0 72% 55%)'

  if (throughputs.length === 0) {
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
          animationDelay: '957ms',
        }}
      >
        <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Streaming Throughput
        </span>
        <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          NO STREAMING DATA
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
        animationDelay: '957ms',
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
          Streaming Throughput
        </span>
        <span style={{
          fontSize: '7px',
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
          color: healthColor,
          background: `${healthColor}20`,
          border: `1px solid ${healthColor}40`,
          borderRadius: 3,
          padding: '0.1rem 0.3rem',
        }}>
          {health}
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
            const angle = startAngle - (tick / MAX_THROUGHPUT) * gaugeSpan
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
          {/* Center value */}
          <text
            x={cx}
            y={cy - 6}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ fontSize: '18px', fontFamily: 'var(--font-mono)', fontWeight: 700, fill: color }}
          >
            {current.toFixed(1)}
          </text>
          <text
            x={cx}
            y={cy + 10}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', fill: 'var(--muted-foreground)' }}
          >
            tok/s
          </text>
        </svg>
      </div>

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
          <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Peak</span>
          <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'hsl(145 65% 60%)' }}>
            {peak.toFixed(1)}
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
          <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Streaming</span>
          <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--foreground)' }}>
            {streamingCount}
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
          <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Non-Stream</span>
          <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--foreground)' }}>
            {nonStreamingCount}
          </span>
        </div>
      </div>

      {/* Sparkline */}
      {throughputs.length >= 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
          <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>
            Trend · last {throughputs.length}
          </span>
          <svg width={sparkW} height={sparkH} viewBox={`0 0 ${sparkW} ${sparkH}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.4} />
                <stop offset="95%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <polyline
              points={sparkPoints}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 3px ${color})` }}
            />
            {throughputs.map((v, i) => {
              const x = (i / (throughputs.length - 1)) * sparkW
              const max = Math.max(...throughputs, 1)
              const min = Math.min(...throughputs)
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
