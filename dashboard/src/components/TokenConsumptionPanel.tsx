import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

function getTokenCount(entry: LogEntry): number {
  const t = entry.tokens_used
  if (typeof t === 'number') return t
  if (t && typeof t === 'object') {
    if ('input' in t && 'output' in t) return (t.input ?? 0) + (t.output ?? 0)
    if ('input' in t) return t.input ?? 0
    if ('output' in t) return t.output ?? 0
  }
  return 0
}

function getInputOutput(entry: LogEntry): { input: number; output: number } | null {
  const t = (entry as unknown as Record<string, unknown>)['tokens_used']
  if (typeof t === 'number') return { input: 0, output: t }
  if (t && typeof t === 'object') {
    const obj = t as Record<string, unknown>
    if ('input' in obj || 'output' in obj) {
      return {
        input: obj.input as number ?? 0,
        output: obj.output as number ?? 0,
      }
    }
  }
  return null
}

type Bucket = '0-1K' | '1K-4K' | '4K-16K' | '16K-32K' | '32K+'

const BUCKET_META: Record<Bucket, { label: string; color: string; range: string }> = {
  '0-1K':   { label: '0–1K',   color: 'hsl(145 65% 55%)', range: '0–1K'   },
  '1K-4K':  { label: '1K–4K',   color: 'hsl(165 60% 50%)', range: '1K–4K'  },
  '4K-16K':  { label: '4K–16K', color: 'hsl(38 92% 55%)',  range: '4K–16K' },
  '16K-32K': { label: '16K–32K', color: 'hsl(25 90% 55%)', range: '16K–32K'},
  '32K+':   { label: '32K+',   color: 'hsl(0 72% 55%)',   range: '32K+'   },
}

function getBucket(count: number): Bucket {
  if (count < 1000) return '0-1K'
  if (count < 4000) return '1K-4K'
  if (count < 16000) return '4K-16K'
  if (count < 32000) return '16K-32K'
  return '32K+'
}

interface BucketBarProps {
  bucket: Bucket
  count: number
  pct: number
  maxCount: number
}

function BucketBar({ bucket, count, pct, maxCount }: BucketBarProps) {
  const meta = BUCKET_META[bucket]
  const width = maxCount > 0 ? (count / maxCount) * 100 : 0
  const isZero = count === 0

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '0.15rem',
      padding: '0.2rem 0.4rem',
      borderBottom: '1px solid hsl(225 45% 10%)',
      opacity: isZero ? 0.3 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        <div style={{
          fontSize: '7px', fontFamily: 'var(--font-mono)',
          color: meta.color, width: 26, flexShrink: 0,
          fontWeight: 700, letterSpacing: '0.04em',
        }}>
          {meta.label}
        </div>

        <div style={{
          flex: 1,
          height: 5,
          background: 'hsl(225 45% 10%)',
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${width}%`,
            height: '100%',
            background: `linear-gradient(90deg, ${meta.color}40, ${meta.color}80)`,
            borderRadius: 2,
            boxShadow: isZero ? 'none' : `0 0 4px ${meta.color}30`,
            transition: 'width 600ms cubic-bezier(0.34, 1.2, 0.64, 1)',
          }} />
        </div>

        <div style={{
          fontSize: '6px', fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)',
          width: 26, flexShrink: 0, textAlign: 'right',
          fontWeight: 600,
        }}>
          {count}
        </div>

        <div style={{
          fontSize: '5.5px', fontFamily: 'var(--font-mono)',
          color: meta.color,
          width: 30, flexShrink: 0, textAlign: 'right',
          fontWeight: 700,
        }}>
          {count > 0 ? `${pct.toFixed(1)}%` : '—'}
        </div>
      </div>
    </div>
  )
}

export function TokenConsumptionPanel({ entries }: Props) {
  const { tokenCounts, total, avg, median, bucketCounts, maxBucketCount, sparklineData, hasInputOutput } = useMemo(() => {
    // Filter entries with tokens_used > 0
    const withTokens = entries.filter(e => getTokenCount(e) > 0)

    const tokenCounts = withTokens.map(e => getTokenCount(e))

    const total = tokenCounts.reduce((s, v) => s + v, 0)
    const avg = tokenCounts.length > 0 ? total / tokenCounts.length : 0

    // Median
    const sorted = [...tokenCounts].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    const median = sorted.length > 0
      ? (sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid])
      : 0

    // Bucket counts
    const bucketCounts: Record<Bucket, number> = {
      '0-1K': 0, '1K-4K': 0, '4K-16K': 0, '16K-32K': 0, '32K+': 0,
    }
    for (const count of tokenCounts) {
      bucketCounts[getBucket(count)]++
    }
    const maxBucketCount = Math.max(...Object.values(bucketCounts), 1)

    // Sparkline: last 10 entries with tokens, reversed for chronological order
    const sparklineData = [...withTokens]
      .reverse()
      .slice(0, 10)
      .map(e => ({
        count: getTokenCount(e),
        io: getInputOutput(e),
      }))

    // Check if any entry has input/output split
    const hasInputOutput = withTokens.some(e => getInputOutput(e) !== null && (getInputOutput(e)!.input > 0 || getInputOutput(e)!.output > 0))

    return { tokenCounts, total, avg, median, bucketCounts, maxBucketCount, sparklineData, hasInputOutput }
  }, [entries])

  const buckets: Bucket[] = ['0-1K', '1K-4K', '4K-16K', '16K-32K', '32K+']

  // Sparkline dimensions
  const sparkWidth = 120
  const sparkHeight = 24
  const maxSpark = Math.max(...sparklineData.map(d => d.count), 1)

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.4rem 0.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '945ms',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '0.1rem' }}>
        <span style={{
          fontSize: '9px', fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)', textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Token Consumption
        </span>
        <span style={{
          fontSize: '5.5px', fontFamily: 'var(--font-mono)',
          color: 'hsl(225 45% 20%)',
        }}>
          {tokenCounts.length} reqs
        </span>
      </div>

      {total === 0 ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            NO TOKEN DATA
          </span>
        </div>
      ) : (
        <>
          {/* Stats row: total, avg, median */}
          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '0.5rem',
            padding: '0.1rem 0.4rem 0.2rem',
            borderBottom: '1px solid hsl(225 45% 12%)',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.2rem' }}>
              <span style={{
                fontSize: '14px', fontFamily: 'var(--font-mono)',
                color: 'hsl(185 80% 50%)', fontWeight: 700,
                letterSpacing: '-0.02em',
              }}>
                {(total / 1000).toFixed(1)}K
              </span>
              <span style={{
                fontSize: '6px', fontFamily: 'var(--font-mono)',
                color: 'var(--muted-foreground)', textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}>
                total
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.15rem' }}>
              <span style={{
                fontSize: '9px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 45%)', fontWeight: 600,
              }}>
                {(avg / 1000).toFixed(1)}K
              </span>
              <span style={{
                fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 20%)', textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}>
                avg
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.15rem' }}>
              <span style={{
                fontSize: '9px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 45%)', fontWeight: 600,
              }}>
                {(median / 1000).toFixed(1)}K
              </span>
              <span style={{
                fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 20%)', textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}>
                med
              </span>
            </div>
          </div>

          {/* Column headers */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
            padding: '0 0.4rem 0.1rem',
            borderBottom: '1px solid hsl(225 45% 12%)',
          }}>
            {[['RANGE', 26], ['', 1], ['', 1], ['N', 26], ['%', 30]].map(([label, width], i) => (
              <div key={i} style={{
                fontSize: '4.5px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 20%)',
                letterSpacing: '0.06em',
                width, flexShrink: 0,
                textAlign: i === 3 || i === 4 ? 'right' : 'left',
              }}>
                {label}
              </div>
            ))}
          </div>

          {/* Bucket bars */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.25rem' }}>
            {buckets.map(bucket => (
              <BucketBar
                key={bucket}
                bucket={bucket}
                count={bucketCounts[bucket]}
                pct={tokenCounts.length > 0 ? (bucketCounts[bucket] / tokenCounts.length) * 100 : 0}
                maxCount={maxBucketCount}
              />
            ))}
          </div>

          {/* Sparkline */}
          {sparklineData.length > 0 && (
            <div style={{
              padding: '0.2rem 0.4rem 0',
              borderTop: '1px solid hsl(225 45% 12%)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}>
              <span style={{
                fontSize: '4.5px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 20%)', textTransform: 'uppercase',
                letterSpacing: '0.06em', flexShrink: 0,
              }}>
                trend
              </span>

              {/* Sparkline SVG */}
              <svg
                width={sparkWidth}
                height={sparkHeight}
                style={{ overflow: 'visible', flexShrink: 0 }}
              >
                {/* Connection line */}
                {sparklineData.length > 1 && (
                  <polyline
                    points={sparklineData.map((d, i) => {
                      const x = (i / (sparklineData.length - 1)) * sparkWidth
                      const y = sparkHeight - (d.count / maxSpark) * sparkHeight
                      return `${x},${y}`
                    }).join(' ')}
                    fill="none"
                    stroke="hsl(185 80% 50%)"
                    strokeWidth="1"
                    strokeOpacity="0.6"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                {/* Dots */}
                {sparklineData.map((d, i) => {
                  const x = sparklineData.length === 1
                    ? sparkWidth / 2
                    : (i / (sparklineData.length - 1)) * sparkWidth
                  const y = sparkHeight - (d.count / maxSpark) * sparkHeight
                  return (
                    <circle
                      key={i}
                      cx={x}
                      cy={y}
                      r={2}
                      fill="hsl(185 80% 50%)"
                    />
                  )
                })}
              </svg>

              {/* Input/output split */}
              {hasInputOutput && sparklineData.length > 0 && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.1rem',
                  flex: 1,
                }}>
                  {sparklineData.slice(-3).map((d, i) => {
                    if (!d.io) return null
                    const totalIO = d.io.input + d.io.output
                    if (totalIO === 0) return null
                    const inPct = d.io.input / totalIO
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                        <div style={{
                          width: 28,
                          height: 4,
                          background: 'hsl(225 45% 10%)',
                          borderRadius: 2,
                          overflow: 'hidden',
                          flexShrink: 0,
                        }}>
                          <div style={{
                            width: `${inPct * 100}%`,
                            height: '100%',
                            background: 'hsl(185 80% 50%)',
                            borderRadius: 2,
                            transition: 'width 400ms ease',
                          }} />
                        </div>
                        <span style={{
                          fontSize: '4px', fontFamily: 'var(--font-mono)',
                          color: 'hsl(225 45% 30%)',
                        }}>
                          {(totalIO / 1000).toFixed(1)}K
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Footer legend */}
          <div style={{
            display: 'flex',
            gap: '0.4rem',
            paddingTop: '0.1rem',
            borderTop: '1px solid hsl(225 45% 12%)',
            flexWrap: 'wrap',
          }}>
            {([
              ['0–1K', 'hsl(145 65% 55%)'],
              ['1K–4K', 'hsl(165 60% 50%)'],
              ['4K–16K', 'hsl(38 92% 55%)'],
              ['16K–32K', 'hsl(25 90% 55%)'],
              ['32K+', 'hsl(0 72% 55%)'],
            ] as const).map(([label, color]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: color }} />
                <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>{label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
