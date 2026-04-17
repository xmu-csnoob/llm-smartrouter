import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

type Bucket = '2xx' | '429' | '4xx-other' | '5xx' | 'other'

const BUCKET_META: Record<Bucket, { label: string; color: string; barColor: string }> = {
  '2xx':       { label: '2xx',  color: 'hsl(145 65% 55%)', barColor: 'hsl(145 65% 55%)' },
  '429':       { label: '429',  color: 'hsl(38 92% 55%)',  barColor: 'hsl(38 92% 55%)'  },
  '4xx-other': { label: '4xx',  color: 'hsl(25 90% 55%)',  barColor: 'hsl(25 90% 55%)'  },
  '5xx':       { label: '5xx',  color: 'hsl(0 72% 55%)',   barColor: 'hsl(0 72% 55%)'   },
  'other':    { label: 'Other', color: 'hsl(225 45% 25%)', barColor: 'hsl(225 45% 20%)' },
}

function getBucket(status: number): Bucket {
  if (status === 429) return '429'
  if (status >= 200 && status < 300) return '2xx'
  if (status >= 400 && status < 500) return '4xx-other'
  if (status >= 500) return '5xx'
  return 'other'
}

interface BucketBarProps {
  bucket: Bucket
  count: number
  pct: number
  codes: Array<{ code: number; count: number }>
  maxCount: number
}

function BucketBar({ bucket, count, pct, codes, maxCount }: BucketBarProps) {
  const meta = BUCKET_META[bucket]
  const width = maxCount > 0 ? (count / maxCount) * 100 : 0
  const isZero = count === 0

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '0.15rem',
      padding: '0.25rem 0.4rem',
      borderBottom: '1px solid hsl(225 45% 10%)',
      opacity: isZero ? 0.3 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        {/* Bucket label */}
        <div style={{
          fontSize: '7px', fontFamily: 'var(--font-mono)',
          color: meta.color, width: 22, flexShrink: 0,
          fontWeight: 700, letterSpacing: '0.04em',
        }}>
          {meta.label}
        </div>

        {/* Bar */}
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
            background: `linear-gradient(90deg, ${meta.barColor}40, ${meta.barColor}80)`,
            borderRadius: 2,
            boxShadow: isZero ? 'none' : `0 0 4px ${meta.barColor}30`,
            transition: 'width 600ms cubic-bezier(0.34, 1.2, 0.64, 1)',
          }} />
        </div>

        {/* Count */}
        <div style={{
          fontSize: '6px', fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)',
          width: 26, flexShrink: 0, textAlign: 'right',
          fontWeight: 600,
        }}>
          {count}
        </div>

        {/* Percent */}
        <div style={{
          fontSize: '5.5px', fontFamily: 'var(--font-mono)',
          color: meta.color,
          width: 30, flexShrink: 0, textAlign: 'right',
          fontWeight: 700,
        }}>
          {count > 0 ? `${pct.toFixed(1)}%` : '—'}
        </div>
      </div>

      {/* Individual codes */}
      {codes.length > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.15rem',
          paddingLeft: 24,
        }}>
          {codes.map(({ code, count: cc }) => (
            <span key={code} style={{
              fontSize: '5px', fontFamily: 'var(--font-mono)',
              color: 'hsl(225 45% 35%)',
              fontWeight: 500,
            }}>
              {code}×{cc}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function StatusCodeDistribution({ entries }: Props) {
  const { bucketCounts, codeCounts, total } = useMemo(() => {
    const bucketCounts: Record<Bucket, number> = {
      '2xx': 0, '429': 0, '4xx-other': 0, '5xx': 0, 'other': 0,
    }
    const codeCounts: Record<number, number> = {}

    for (const entry of entries) {
      const status = entry.status ?? 0
      const bucket = getBucket(status)
      bucketCounts[bucket]++
      codeCounts[status] = (codeCounts[status] ?? 0) + 1
    }

    const total = entries.length

    // Sort codes by count descending
    const sortedCodes = Object.entries(codeCounts)
      .map(([code, count]) => ({ code: Number(code), count }))
      .sort((a, b) => b.count - a.count)

    return { bucketCounts, codeCounts: sortedCodes, total }
  }, [entries])

  const buckets: Bucket[] = ['2xx', '429', '4xx-other', '5xx', 'other']
  const maxCount = Math.max(...buckets.map(b => bucketCounts[b]), 1)

  // Build per-bucket code list
  function codesForBucket(bucket: Bucket) {
    return codeCounts
      .filter(({ code }) => getBucket(code) === bucket)
      .sort((a, b) => b.count - a.count)
  }

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.4rem 0.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '960ms',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '0.1rem' }}>
        <span style={{
          fontSize: '9px', fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)', textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Status Codes
        </span>
        <span style={{
          fontSize: '5.5px', fontFamily: 'var(--font-mono)',
          color: 'hsl(225 45% 20%)',
        }}>
          {total} reqs
        </span>
      </div>

      {/* Column headers */}
      {total > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          padding: '0 0.4rem 0.1rem',
          borderBottom: '1px solid hsl(225 45% 12%)',
        }}>
          {[['CODE', 22], ['', 1], ['', 1], ['N', 26], ['%', 30]].map(([label, width], i) => (
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
      )}

      {/* Buckets — 2 column layout */}
      {total === 0 ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            NO STATUS DATA
          </span>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.25rem' }}>
          {buckets.map(bucket => (
            <BucketBar
              key={bucket}
              bucket={bucket}
              count={bucketCounts[bucket]}
              pct={total > 0 ? (bucketCounts[bucket] / total) * 100 : 0}
              codes={codesForBucket(bucket)}
              maxCount={maxCount}
            />
          ))}
        </div>
      )}

      {/* Footer legend */}
      {total > 0 && (
        <div style={{
          display: 'flex',
          gap: '0.4rem',
          paddingTop: '0.1rem',
          borderTop: '1px solid hsl(225 45% 12%)',
          flexWrap: 'wrap',
        }}>
          {([
            ['2xx', 'hsl(145 65% 55%)'],
            ['429', 'hsl(38 92% 55%)'],
            ['4xx', 'hsl(25 90% 55%)'],
            ['5xx', 'hsl(0 72% 55%)'],
          ] as const).map(([label, color]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
              <div style={{ width: 4, height: 4, borderRadius: '50%', background: color }} />
              <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
