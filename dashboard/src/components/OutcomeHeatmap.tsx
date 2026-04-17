import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

type Outcome = 'success' | 'fallback' | 'error'

const OUTCOMES: Outcome[] = ['success', 'fallback', 'error']
const HOURS = 24

const OUTCOME_LABELS: Record<Outcome, string> = {
  success: 'OK',
  fallback: 'FB',
  error: 'ERR',
}

const OUTCOME_COLORS: Record<Outcome, string> = {
  success: 'hsl(145 65% 55%)',
  fallback: 'hsl(38 92% 55%)',
  error: 'hsl(0 72% 55%)',
}

interface Cell {
  hour: number
  outcome: Outcome
  count: number
  pct: number  // fraction of this hour's total
  intensity: number  // 0-1 relative to max count across all cells
}

function getOutcome(entry: LogEntry): Outcome {
  if (entry.status >= 400 || entry.error) return 'error'
  if (entry.is_fallback || (entry.fallback_chain && entry.fallback_chain.length > 0)) return 'fallback'
  return 'success'
}

function getHour(timestamp: string): number {
  try {
    return new Date(timestamp).getHours()
  } catch {
    return 0
  }
}

export function OutcomeHeatmap({ entries }: Props) {
  const { cells, hourlyTotals } = useMemo(() => {
    // count[hour][outcome]
    const count: Record<number, Record<Outcome, number>> = {}
    for (let h = 0; h < HOURS; h++) {
      count[h] = { success: 0, fallback: 0, error: 0 }
    }

    for (const entry of entries) {
      const hour = getHour(entry.timestamp)
      const outcome = getOutcome(entry)
      count[hour][outcome]++
    }

    // hourly totals
    const hourlyTotals: number[] = []
    for (let h = 0; h < HOURS; h++) {
      hourlyTotals[h] = count[h].success + count[h].fallback + count[h].error
    }

    // flat cells
    const allCells: Cell[] = []
    let maxCount = 1
    for (let h = 0; h < HOURS; h++) {
      for (const outcome of OUTCOMES) {
        const c = count[h][outcome]
        if (c > maxCount) maxCount = c
        allCells.push({
          hour: h,
          outcome,
          count: c,
          pct: hourlyTotals[h] > 0 ? c / hourlyTotals[h] : 0,
          intensity: 0,
        })
      }
    }

    // normalize intensity
    for (const cell of allCells) {
      cell.intensity = cell.count > 0 ? cell.count / maxCount : 0
    }

    return { cells: allCells, hourlyTotals }
  }, [entries])

  const hasData = hourlyTotals.some(t => t > 0)

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.35rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '970ms',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: '9px', fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)', textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Outcome Heatmap
        </span>
        {hasData && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            {OUTCOMES.map(o => (
              <div key={o} style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: OUTCOME_COLORS[o] }} />
                <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>{OUTCOME_LABELS[o]}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Outcome labels + grid */}
      {!hasData ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            NO OUTCOME DATA
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.08rem' }}>
          {OUTCOMES.map(outcome => (
            <div key={outcome} style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
              {/* Y-axis label */}
              <div style={{
                width: 14, flexShrink: 0,
                fontSize: '4.5px', fontFamily: 'var(--font-mono)',
                color: OUTCOME_COLORS[outcome],
                fontWeight: 700,
                textAlign: 'right',
                letterSpacing: '0.02em',
              }}>
                {OUTCOME_LABELS[outcome]}
              </div>

              {/* 24 hour cells */}
              <div style={{ display: 'flex', gap: '0.05rem', flex: 1 }}>
                {Array.from({ length: HOURS }, (_, h) => {
                  const cell = cells.find(c => c.hour === h && c.outcome === outcome)!
                  const isPeak = hourlyTotals[h] > 0 && cell.intensity === 1
                  return (
                    <div
                      key={h}
                      title={`${String(h).padStart(2, '0')}:00 — ${OUTCOME_LABELS[outcome]}: ${cell.count} (${hourlyTotals[h] > 0 ? (cell.pct * 100).toFixed(0) : 0}%)`}
                      style={{
                        flex: 1,
                        height: 8,
                        borderRadius: 2,
                        background: cell.count > 0
                          ? OUTCOME_COLORS[outcome]
                          : 'hsl(225 45% 10%)',
                        opacity: cell.count > 0 ? 0.15 + cell.intensity * 0.75 : 1,
                        boxShadow: isPeak ? `0 0 4px ${OUTCOME_COLORS[outcome]}60` : 'none',
                        transition: 'opacity 300ms ease, box-shadow 300ms ease',
                        cursor: 'default',
                      }}
                    />
                  )
                })}
              </div>
            </div>
          ))}

          {/* Hour labels */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem', marginTop: '0.05rem' }}>
            <div style={{ width: 14, flexShrink: 0 }} />
            <div style={{ display: 'flex', gap: '0.05rem', flex: 1 }}>
              {[0, 6, 12, 18, 23].map(h => (
                <div key={h} style={{
                  flex: 1,
                  fontSize: '4px', fontFamily: 'var(--font-mono)',
                  color: 'hsl(225 45% 25%)',
                  textAlign: 'center',
                }}>
                  {String(h).padStart(2, '0')}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      {hasData && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: '0.05rem',
          borderTop: '1px solid hsl(225 45% 12%)',
        }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            outcome = success / fallback / error · cell opacity = intensity
          </span>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            {hourlyTotals.reduce((a, b) => a + b, 0)} total
          </span>
        </div>
      )}
    </div>
  )
}
