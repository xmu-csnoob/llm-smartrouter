import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

type Bucket = '1' | '2-3' | '4-6' | '7-10' | '10+'

const BUCKET_META: Record<Bucket, { label: string; color: string }> = {
  '1':    { label: '1 msg',      color: 'hsl(185, 80%, 50%)' },
  '2-3':  { label: '2–3 msgs',  color: 'hsl(200, 70%, 55%)' },
  '4-6':  { label: '4–6 msgs',  color: 'hsl(220, 60%, 55%)' },
  '7-10': { label: '7–10 msgs', color: 'hsl(260, 55%, 60%)' },
  '10+':  { label: '10+ msgs',  color: 'hsl(280, 65%, 65%)' },
}

function getBucket(count: number): Bucket {
  if (count === 1) return '1'
  if (count <= 3) return '2-3'
  if (count <= 6) return '4-6'
  if (count <= 10) return '7-10'
  return '10+'
}

function BucketBar({ bucket, count, pct, maxCount }: { bucket: Bucket; count: number; pct: number; maxCount: number }) {
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
          color: meta.color, width: 36, flexShrink: 0,
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

export function ConversationLengthPanel({ entries }: Props) {
  const { total, avg, median, max, maxEntry, bucketCounts, maxBucketCount } = useMemo(() => {
    const withMessages = entries.filter(e => e.message_count > 0)
    const counts = withMessages.map(e => e.message_count)

    const total = counts.length
    const avg = total > 0 ? counts.reduce((s, v) => s + v, 0) / total : 0

    const sorted = [...counts].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    const median = sorted.length > 0
      ? (sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid])
      : 0

    const max = sorted.length > 0 ? sorted[sorted.length - 1] : 0

    const maxEntry = withMessages.find(e => e.message_count === max) ?? null

    const bucketCounts: Record<Bucket, number> = {
      '1': 0, '2-3': 0, '4-6': 0, '7-10': 0, '10+': 0,
    }
    for (const count of counts) {
      bucketCounts[getBucket(count)]++
    }
    const maxBucketCount = Math.max(...Object.values(bucketCounts), 1)

    return { total, avg, median, max, maxEntry, bucketCounts, maxBucketCount }
  }, [entries])

  const buckets: Bucket[] = ['1', '2-3', '4-6', '7-10', '10+']

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.4rem 0.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '955ms',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '0.1rem' }}>
        <span style={{
          fontSize: '9px', fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)', textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Conversation Length
        </span>
        <span style={{
          fontSize: '5.5px', fontFamily: 'var(--font-mono)',
          color: 'hsl(225 45% 20%)',
        }}>
          {total} reqs
        </span>
      </div>

      {total === 0 ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            NO MESSAGE DATA
          </span>
        </div>
      ) : (
        <>
          {/* Stats row: avg, median, max */}
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
                {avg.toFixed(1)}
              </span>
              <span style={{
                fontSize: '6px', fontFamily: 'var(--font-mono)',
                color: 'var(--muted-foreground)', textTransform: 'uppercase',
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
                {median.toFixed(1)}
              </span>
              <span style={{
                fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 20%)', textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}>
                med
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.15rem' }}>
              <span style={{
                fontSize: '9px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 45%)', fontWeight: 600,
              }}>
                {max}
              </span>
              <span style={{
                fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 20%)', textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}>
                max
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
            {[['RANGE', 36], ['', 1], ['', 1], ['N', 26], ['%', 30]].map(([label, width], i) => (
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
                pct={total > 0 ? (bucketCounts[bucket] / total) * 100 : 0}
                maxCount={maxBucketCount}
              />
            ))}
          </div>

          {/* Longest conversation callout */}
          {maxEntry && (
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
                longest
              </span>
              <span style={{
                fontSize: '7px', fontFamily: 'var(--font-mono)',
                color: 'hsl(280 65% 65%)', fontWeight: 700,
              }}>
                {maxEntry.request_id.slice(0, 12)}
              </span>
              <span style={{
                fontSize: '6px', fontFamily: 'var(--font-mono)',
                color: 'var(--muted-foreground)',
              }}>
                {maxEntry.message_count} msgs
              </span>
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
              ['1 msg', 'hsl(185, 80%, 50%)'],
              ['2–3 msgs', 'hsl(200, 70%, 55%)'],
              ['4–6 msgs', 'hsl(220, 60%, 55%)'],
              ['7–10 msgs', 'hsl(260, 55%, 60%)'],
              ['10+ msgs', 'hsl(280, 65%, 65%)'],
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
