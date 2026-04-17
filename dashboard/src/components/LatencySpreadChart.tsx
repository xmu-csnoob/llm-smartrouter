import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 15 * 60 * 1000
const MIN_SAMPLES = 20
const NUM_BUCKETS = 15

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo)
}

interface BucketStats {
  p10: number
  p50: number
  p90: number
  skewness: number   // p90 - p50 spread
  count: number
  isWarm: boolean
}

interface SpreadStats {
  buckets: BucketStats[]
  overallP10: number
  overallP50: number
  overallP90: number
  overallSkew: number
  maxLatency: number
  tier: string
  windowSize: number
}

function computeStats(entries: LogEntry[], tier: string): SpreadStats | null {
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

  const logEntries = window.map(w => w.entry)
    .filter(e => e.routed_tier === tier && typeof e.latency_ms === 'number' && e.latency_ms !== null && e.latency_ms > 0)

  if (logEntries.length < 5) return null

  const bucketSize = Math.ceil(logEntries.length / NUM_BUCKETS)
  // window is already sorted newest-first by tsMs desc

  const buckets: BucketStats[] = []
  for (let i = 0; i < NUM_BUCKETS; i++) {
    const slice = logEntries.slice(i * bucketSize, (i + 1) * bucketSize)
    const vals = slice.map(e => e.latency_ms as number)
    if (vals.length === 0) continue
    const p10 = percentile(vals, 10)
    const p50 = percentile(vals, 50)
    const p90 = percentile(vals, 90)
    const skew = p90 - p50
    buckets.push({ p10, p50, p90, skewness: skew, count: vals.length, isWarm: i < NUM_BUCKETS / 2 })
  }

  const allVals = logEntries.map(e => e.latency_ms as number)
  const overallP10 = percentile(allVals, 10)
  const overallP50 = percentile(allVals, 50)
  const overallP90 = percentile(allVals, 90)
  const maxLatency = Math.max(...allVals)

  return {
    buckets,
    overallP10,
    overallP50,
    overallP90,
    overallSkew: overallP90 - overallP50,
    maxLatency,
    tier,
    windowSize: window.length,
  }
}

const TIER_META: Record<string, { color: string; label: string }> = {
  tier1: { color: 'hsl(280 65% 65%)', label: 'Frontier' },
  tier2: { color: 'hsl(185 80% 55%)', label: 'Workhorse' },
  tier3: { color: 'hsl(145 65% 55%)', label: 'Routine' },
}

const TIER_KEYS = ['tier1', 'tier2', 'tier3'] as const

export function LatencySpreadChart({ entries }: { entries: LogEntry[] }) {
  const stats = useMemo((): SpreadStats[] | null => {
    const results = TIER_KEYS
      .map(tier => computeStats(entries, tier))
      .filter((s): s is SpreadStats => s !== null)
    return results.length > 0 ? results : null
  }, [entries])

  if (!stats) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '984ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT LATENCY DATA
        </div>
      </div>
    )
  }

  const SVG_W = 420
  const SVG_H = 160
  const PAD_L = 36
  const PAD_R = 8
  const PAD_T = 12
  const PAD_B = 18
  const CHART_W = SVG_W - PAD_L - PAD_R
  const CHART_H = SVG_H - PAD_T - PAD_B

  const allMaxLatency = Math.max(...stats.map(s => s.overallP90), 1)
  const xScale = (bi: number) => PAD_L + (bi / (NUM_BUCKETS - 1)) * CHART_W
  const yScale = (v: number) => PAD_T + CHART_H - (v / allMaxLatency) * CHART_H

  const skewColor = (skew: number, max: number): string => {
    const ratio = Math.min(skew / max, 1)
    if (ratio < 0.3) return 'hsl(145 65% 55%)'     // green = tight spread
    if (ratio < 0.6) return 'hsl(38 92% 55%)'      // amber = moderate
    return 'hsl(0 72% 55%)'                         // red = wide spread
  }

  const overallMaxSkew = Math.max(...stats.map(s => s.overallSkew), 1)

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '984ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Latency Spread
        </span>
        <div style={{ display: 'flex', gap: '0.15rem', alignItems: 'center' }}>
          {([
            { label: 'P10', color: 'hsl(145 65% 55%)' },
            { label: 'P50', color: 'hsl(185 80% 55%)' },
            { label: 'P90', color: 'hsl(38 92% 55%)' },
          ] as const).map(({ label, color }) => (
            <span key={label} style={{
              fontSize: '5px', fontFamily: 'var(--font-mono)',
              color, background: `${color}15`,
              border: `1px solid ${color}30`,
              borderRadius: 2, padding: '2px 5px',
            }}>
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Sub-header: per-tier summary */}
      <div style={{ display: 'flex', gap: '0.3rem', overflow: 'hidden' }}>
        {stats.map(s => {
          const meta = TIER_META[s.tier]
          const sc = skewColor(s.overallSkew, overallMaxSkew)
          return (
            <div key={s.tier} style={{
              flex: 1, display: 'flex', flexDirection: 'column', gap: '1px',
              background: 'hsl(225 45% 8%)', borderRadius: 3, padding: '4px 6px',
            }}>
              <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: meta.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {meta.label}
              </span>
              <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'var(--foreground)', fontWeight: 700 }}>
                P50 <span style={{ color: 'hsl(185 80% 55%)' }}>{s.overallP50 < 1000 ? `${Math.round(s.overallP50)}ms` : `${(s.overallP50 / 1000).toFixed(1)}s`}</span>
              </span>
              <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: sc }}>
                P90−P50 <span style={{ fontWeight: 700 }}>{(s.overallSkew).toFixed(0)}ms</span>
              </span>
              <span style={{ fontSize: '3.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 40%)' }}>
                n={s.buckets.reduce((acc, b) => acc + b.count, 0)}
              </span>
            </div>
          )
        })}
      </div>

      {/* SVG chart */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <svg width={SVG_W} height={SVG_H} style={{ overflow: 'visible' }}>
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map(ratio => (
            <line
              key={ratio}
              x1={PAD_L} y1={yScale(allMaxLatency * ratio)}
              x2={SVG_W - PAD_R} y2={yScale(allMaxLatency * ratio)}
              stroke="hsl(225 45% 12%)"
              strokeWidth={0.5}
            />
          ))}

          {/* Y-axis labels */}
          {[0, 0.5, 1].map(ratio => (
            <text
              key={ratio}
              x={PAD_L - 2}
              y={yScale(allMaxLatency * ratio) + 1}
              fontSize="3.5"
              fill="hsl(225 45% 30%)"
              fontFamily="var(--font-mono)"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {ratio === 0 ? '0' : ratio === 1 ? `${(allMaxLatency / 1000).toFixed(1)}s` : `${(allMaxLatency * ratio / 1000).toFixed(1)}s`}
            </text>
          ))}

          {/* Per-tier area bands */}
          {stats.map((s) => {
            const meta = TIER_META[s.tier]
            const tc = meta.color
            const buckets = s.buckets
            if (buckets.length < 2) return null

            // Build area path: P10→P50→P90 band
            const p10Path = buckets.map((b, i) => {
              const x = xScale(i)
              const y = yScale(b.p10)
              return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
            }).join(' ')

            // P90 closing path: walk backwards from last bucket to first
            const p90ClosePath = [...buckets].reverse().map((b, i) => {
              const x = xScale(buckets.length - 1 - i)
              const y = yScale(b.p90)
              return `${i === 0 ? 'L' : 'L'} ${x} ${y}`
            }).join(' ')

            const p50Path = buckets.map((b, i) => {
              const x = xScale(i)
              const y = yScale(b.p50)
              return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
            }).join(' ')

            const skewPath = buckets.map((b, i) => {
              const x = xScale(i)
              const y = yScale(b.p90 - b.p50)
              return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
            }).join(' ')

            return (
              <g key={s.tier}>
                {/* P10-P90 fill band */}
                <path
                  d={p10Path + p90ClosePath + ' Z'}
                  fill={tc}
                  opacity={0.06}
                />
                {/* P50 line */}
                <path
                  d={p50Path}
                  fill="none"
                  stroke={tc}
                  strokeWidth={1.5}
                  strokeOpacity={0.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* Skew indicator (p90-p50) as dashed overlay */}
                <path
                  d={skewPath}
                  fill="none"
                  stroke={skewColor(s.overallSkew, overallMaxSkew)}
                  strokeWidth={0.8}
                  strokeOpacity={0.5}
                  strokeDasharray="3 2"
                  strokeLinecap="round"
                />
              </g>
            )
          })}

          {/* X-axis bucket ticks */}
          {stats[0]?.buckets.map((b, i) => {
            if (i % 3 !== 0) return null
            return (
              <text
                key={i}
                x={xScale(i)}
                y={SVG_H - 2}
                fontSize="3"
                fill="hsl(225 45% 25%)"
                fontFamily="var(--font-mono)"
                textAnchor="middle"
              >
                {b.isWarm ? '▲' : ''}
              </text>
            )
          })}

          {/* Legend */}
          <text x={PAD_L + 4} y={PAD_T - 1} fontSize="3.5" fill="hsl(225 45% 35%)" fontFamily="var(--font-mono)">
            ▲ recent
          </text>
        </svg>
      </div>

      {/* Color legend */}
      <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>spread:</span>
        {([
          { label: 'tight', color: 'hsl(145 65% 55%)' },
          { label: 'moderate', color: 'hsl(38 92% 55%)' },
          { label: 'wide', color: 'hsl(0 72% 55%)' },
        ] as const).map(({ label, color }) => (
          <span key={label} style={{
            fontSize: '4px', fontFamily: 'var(--font-mono)',
            color, display: 'flex', alignItems: 'center', gap: '2px',
          }}>
            <span style={{ width: 6, height: 3, background: color, borderRadius: 1, display: 'inline-block' }} />
            {label}
          </span>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '5px',
        color: 'var(--muted-foreground)', textAlign: 'right', opacity: 0.7,
      }}>
        {stats[0]?.windowSize} entries · 15-min window · P10/P50/P90 percentiles · spread = P90−P50 skew
      </div>
    </div>
  )
}
