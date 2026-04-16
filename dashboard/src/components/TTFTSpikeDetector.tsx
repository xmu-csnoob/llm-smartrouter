import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

interface TTFTStats {
  values: number[]
  avg: number
  max: number
  median: number
  buckets: { label: string; count: number; color: string; range: string }[]
  spikeCount: number
  last10: number[]
}

const BUCKET_CONFIG = [
  { label: 'FAST', range: '0-500ms', min: 0, max: 500, color: 'hsl(145, 65%, 55%)' },
  { label: 'NORMAL', range: '500-1s', min: 500, max: 1000, color: 'hsl(165, 60%, 50%)' },
  { label: 'SLOW', range: '1-3s', min: 1000, max: 3000, color: 'hsl(38, 92%, 55%)' },
  { label: 'SLUGGISH', range: '3-10s', min: 3000, max: 10000, color: 'hsl(25, 90%, 55%)' },
  { label: 'SPIKE', range: '10s+', min: 10000, max: Infinity, color: 'hsl(0, 72%, 55%)' },
]

function computeTTFTStats(entries: LogEntry[]): TTFTStats {
  const allTTFT: number[] = []
  for (const e of entries) {
    if (e.ttft_ms != null && e.ttft_ms > 0) {
      allTTFT.push(e.ttft_ms)
    }
  }

  if (allTTFT.length === 0) {
    return {
      values: [],
      avg: 0,
      max: 0,
      median: 0,
      buckets: BUCKET_CONFIG.map((b) => ({ label: b.label, count: 0, color: b.color, range: b.range })),
      spikeCount: 0,
      last10: [],
    }
  }

  const sorted = [...allTTFT].sort((a, b) => a - b)
  const total = sorted.reduce((a, b) => a + b, 0)
  const avg = total / sorted.length
  const max = sorted[sorted.length - 1]
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]

  // Bucket counts
  const buckets = BUCKET_CONFIG.map((b) => {
    const count = sorted.filter((v) => v >= b.min && v < b.max).length
    return { label: b.label, count, color: b.color, range: b.range }
  })

  // Spike count: entries with ttft_ms > 3000 (sluggish + spike combined)
  const spikeCount = sorted.filter((v) => v > 3000).length

  // Last 10 values in chronological order (oldest-to-newest left-to-right)
  // entries come newest-first; take first 10 (most recent), reverse for chronological
  const last10: number[] = entries
    .filter((e): e is LogEntry & { ttft_ms: number } => e.ttft_ms != null && e.ttft_ms > 0)
    .slice(0, 10)
    .reverse()
    .map(e => e.ttft_ms)

  return { values: allTTFT, avg, max, median, buckets, spikeCount, last10 }
}

export function TTFTSpikeDetector({ entries }: Props) {
  const stats = useMemo(() => computeTTFTStats(entries), [entries])

  const hasSpike = stats.max > 5000

  // Sparkline dimensions
  const sparkW = 120
  const sparkH = 28
  const sparkPad = 2

  const drawSparkline = () => {
    if (stats.last10.length < 2) return null

    const minV = Math.min(...stats.last10)
    const maxV = Math.max(...stats.last10, 3000)
    const range = maxV - minV || 1

    const xStep = (sparkW - sparkPad * 2) / (stats.last10.length - 1)
    const yScale = (sparkH - sparkPad * 2) / range

    const points = stats.last10.map((v, i) => ({
      x: sparkPad + i * xStep,
      y: sparkH - sparkPad - (v - minV) * yScale,
    }))

    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')

    // Threshold line at 3000ms
    const thresholdY = sparkH - sparkPad - (3000 - minV) * yScale
    const clampedThresholdY = Math.max(sparkPad, Math.min(sparkH - sparkPad, thresholdY))

    return (
      <svg width={sparkW} height={sparkH} style={{ display: 'block' }}>
        {/* Threshold line */}
        <line
          x1={sparkPad}
          y1={clampedThresholdY}
          x2={sparkW - sparkPad}
          y2={clampedThresholdY}
          stroke="hsl(0, 72%, 55%)"
          strokeWidth={0.5}
          strokeDasharray="2,2"
          opacity={0.6}
        />
        {/* Line path */}
        <path
          d={pathD}
          fill="none"
          stroke="hsl(185, 80%, 50%)"
          strokeWidth={1}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Dots */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={1.2}
            fill={stats.last10[i] > 3000 ? 'hsl(0, 72%, 55%)' : 'hsl(185, 80%, 50%)'}
          />
        ))}
      </svg>
    )
  }

  const maxBucketCount = Math.max(...stats.buckets.map((b) => b.count), 1)

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.4rem 0.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.15rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '952ms',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span
            style={{
              fontSize: '9px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--muted-foreground)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            TTFT Spikes
          </span>
          {hasSpike && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: 'hsl(0, 72%, 55%)',
                  boxShadow: '0 0 6px hsl(0, 72%, 55%)',
                  animation: 'pulse-dot 1.5s ease-in-out infinite',
                  display: 'inline-block',
                }}
              />
              <span
                style={{
                  fontSize: '5.5px',
                  fontFamily: 'var(--font-mono)',
                  color: 'hsl(0, 72%, 55%)',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                }}
              >
                SPIKE
              </span>
            </div>
          )}
        </div>
        <span
          style={{
            fontSize: '5.5px',
            fontFamily: 'var(--font-mono)',
            color: stats.spikeCount > 0 ? 'hsl(25, 90%, 55%)' : 'hsl(225, 45%, 20%)',
            fontWeight: 600,
          }}
        >
          {stats.spikeCount} spike{stats.spikeCount !== 1 ? 's' : ''}
        </span>
      </div>

      {stats.values.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span
            style={{
              fontSize: '8px',
              fontFamily: 'var(--font-mono)',
              color: 'hsl(225, 45%, 25%)',
              letterSpacing: '0.06em',
            }}
          >
            NO TTFT DATA
          </span>
        </div>
      ) : (
        <>
          {/* Stats row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.1rem 0.2rem',
            }}
          >
            {[
              { label: 'AVG', value: stats.avg },
              { label: 'MAX', value: stats.max },
              { label: 'MED', value: stats.median },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '0.05rem' }}>
                <span
                  style={{
                    fontSize: '4.5px',
                    fontFamily: 'var(--font-mono)',
                    color: 'hsl(225, 45%, 25%)',
                    letterSpacing: '0.06em',
                  }}
                >
                  {label}
                </span>
                <span
                  style={{
                    fontSize: '8px',
                    fontFamily: 'var(--font-mono)',
                    color: 'hsl(225, 45%, 65%)',
                    fontWeight: 600,
                  }}
                >
                  {value.toFixed(0)}
                  <span style={{ fontSize: '5px', color: 'hsl(225, 45%, 40%)', marginLeft: '1px' }}>ms</span>
                </span>
              </div>
            ))}

            {/* Sparkline */}
            <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
              {drawSparkline()}
            </div>
          </div>

          {/* Bucket bars */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', marginTop: '0.1rem' }}>
            {stats.buckets.map((bucket) => {
              const barWidth = (bucket.count / maxBucketCount) * 100
              return (
                <div
                  key={bucket.label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.2rem',
                  }}
                >
                  <span
                    style={{
                      fontSize: '4.5px',
                      fontFamily: 'var(--font-mono)',
                      color: 'hsl(225, 45%, 30%)',
                      width: 28,
                      flexShrink: 0,
                      letterSpacing: '0.04em',
                    }}
                  >
                    {bucket.range}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 4,
                      background: 'hsl(225, 45%, 10%)',
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${barWidth}%`,
                        height: '100%',
                        background: `linear-gradient(90deg, ${bucket.color}60, ${bucket.color}90)`,
                        borderRadius: 2,
                        boxShadow: `0 0 4px ${bucket.color}30`,
                        transition: 'width 600ms cubic-bezier(0.34, 1.2, 0.64, 1)',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: '5px',
                      fontFamily: 'var(--font-mono)',
                      color: bucket.color,
                      width: 12,
                      textAlign: 'right',
                      flexShrink: 0,
                    }}
                  >
                    {bucket.count}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
