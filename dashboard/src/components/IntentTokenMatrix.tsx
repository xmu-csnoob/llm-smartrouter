import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const INTENT_ORDER = ['simple', 'debug', 'implementation', 'architecture', 'analysis', 'general'] as const
type Intent = typeof INTENT_ORDER[number]

const INTENT_LABELS: Record<Intent, string> = {
  simple: 'Simple',
  debug: 'Debug',
  implementation: 'Impl',
  architecture: 'Arch',
  analysis: 'Analysis',
  general: 'General',
}

const INTENT_COLORS: Record<Intent, string> = {
  simple: 'hsl(145 65% 55%)',
  debug: 'hsl(38 92% 55%)',
  implementation: 'hsl(200 75% 55%)',
  architecture: 'hsl(280 65% 65%)',
  analysis: 'hsl(260 65% 55%)',
  general: 'hsl(0 0% 55%)',
}

const TOKEN_BUCKETS = [
  { label: '0-500', min: 0,    max: 500   },
  { label: '500-2k', min: 500,  max: 2000  },
  { label: '2k-8k', min: 2000, max: 8000  },
  { label: '8k+',   min: 8000, max: Infinity },
] as const

type TokenBucket = typeof TOKEN_BUCKETS[number]

interface MatrixCell {
  bucket: TokenBucket
  count: number
  pct: number
  intensity: number  // 0-1 relative to max cell in this row
}

interface MatrixRow {
  intent: Intent
  label: string
  color: string
  cells: MatrixCell[]
  total: number
}

function MatrixCellBlock({ cell, intentColor }: { cell: MatrixCell; intentColor: string }) {
  const width = cell.pct * 100
  const isEmpty = cell.count === 0

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '0.05rem',
    }}>
      {/* Bar */}
      <div style={{
        width: '100%',
        height: 10,
        background: 'hsl(225 45% 10%)',
        borderRadius: 2,
        overflow: 'hidden',
        position: 'relative',
      }}>
        {!isEmpty && (
          <div style={{
            position: 'absolute',
            left: 0, top: 0, bottom: 0,
            width: `${width}%`,
            background: `linear-gradient(180deg, ${intentColor}60, ${intentColor}90)`,
            boxShadow: `0 0 4px ${intentColor}30`,
            borderRadius: 2,
            transition: 'width 500ms cubic-bezier(0.34, 1.2, 0.64, 1)',
          }} />
        )}
      </div>
      {/* Count */}
      <span style={{
        fontSize: '4.5px', fontFamily: 'var(--font-mono)',
        color: isEmpty ? 'hsl(225 45% 15%)' : 'var(--muted-foreground)',
        fontWeight: isEmpty ? 400 : 600,
      }}>
        {isEmpty ? '—' : cell.count}
      </span>
    </div>
  )
}

export function IntentTokenMatrix({ entries }: Props) {
  const { rows, totalEntries } = useMemo(() => {
    const buckets: Record<Intent, Record<string, number>> = {
      simple: {}, debug: {}, implementation: {}, architecture: {}, analysis: {}, general: {},
    }
    for (const bucket of TOKEN_BUCKETS) {
      for (const intent of INTENT_ORDER) {
        buckets[intent][bucket.label] = 0
      }
    }

    let validEntries = 0
    for (const entry of entries) {
      const tokens = entry.estimated_tokens ?? 0
      if (tokens <= 0) continue
      const intent = (entry.semantic_features?.intent ?? entry.task_type ?? 'general') as Intent
      if (!(intent in buckets)) continue

      const bucket = TOKEN_BUCKETS.find(b => tokens > b.min && tokens <= b.max)
        ?? TOKEN_BUCKETS[TOKEN_BUCKETS.length - 1]
      buckets[intent][bucket.label]++
      validEntries++
    }

    const intentTotals: Record<Intent, number> = {} as Record<Intent, number>
    for (const intent of INTENT_ORDER) {
      intentTotals[intent] = Object.values(buckets[intent]).reduce((a, b) => a + b, 0)
    }

    const maxCell = Math.max(...TOKEN_BUCKETS.map(b =>
      Math.max(...INTENT_ORDER.map(i => buckets[i][b.label]))
    ), 1)

    const rows: MatrixRow[] = INTENT_ORDER.map(intent => {
      const cells: MatrixCell[] = TOKEN_BUCKETS.map(bucket => {
        const count = buckets[intent][bucket.label]
        const total = intentTotals[intent]
        const pct = total > 0 ? count / total : 0
        const intensity = count > 0 ? count / maxCell : 0
        return { bucket, count, pct, intensity }
      })
      return { intent, label: INTENT_LABELS[intent], color: INTENT_COLORS[intent], cells, total: intentTotals[intent] }
    }).filter(r => r.total > 0)

    return { rows, totalEntries: validEntries }
  }, [entries])

  const hasData = rows.length > 0

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '960ms',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: '9px', fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)', textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Intent × Token
        </span>
        {hasData ? (
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            {totalEntries} requests
          </span>
        ) : (
          <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>NO DATA</span>
        )}
      </div>

      {/* Column headers */}
      {hasData && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', paddingLeft: 60 }}>
          {TOKEN_BUCKETS.map(b => (
            <div key={b.label} style={{
              flex: 1,
              textAlign: 'center',
              fontSize: '4.5px', fontFamily: 'var(--font-mono)',
              color: 'hsl(225 45% 20%)',
              letterSpacing: '0.04em',
            }}>
              {b.label}
            </div>
          ))}
        </div>
      )}

      {/* Matrix rows */}
      {!hasData ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            NO TOKEN DATA
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
          {rows.map(row => (
            <div key={row.intent} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
              {/* Intent label */}
              <div style={{
                width: 52, flexShrink: 0,
                fontSize: '6px', fontFamily: 'var(--font-mono)',
                color: row.color,
                fontWeight: 700,
                letterSpacing: '0.02em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {row.label}
              </div>

              {/* Cell bars */}
              <div style={{ flex: 1, display: 'flex', gap: '0.15rem' }}>
                {row.cells.map(cell => (
                  <MatrixCellBlock key={cell.bucket.label} cell={cell} intentColor={row.color} />
                ))}
              </div>

              {/* Row total */}
              <div style={{
                width: 18, flexShrink: 0, textAlign: 'right',
                fontSize: '5.5px', fontFamily: 'var(--font-mono)',
                color: 'var(--muted-foreground)',
                fontWeight: 700,
              }}>
                {row.total}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      {hasData && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: '0.1rem',
          borderTop: '1px solid hsl(225 45% 12%)',
        }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            intent × token bucket · estimated_tokens field
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
            <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>bar = %</span>
          </div>
        </div>
      )}
    </div>
  )
}
