import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const TIERS = ['tier1', 'tier2', 'tier3']
const TIER_COLORS: Record<string, string> = {
  tier1: 'hsl(280 65% 60%)',
  tier2: 'hsl(200 75% 55%)',
  tier3: 'hsl(145 65% 48%)',
}
const TIER_LABELS: Record<string, string> = {
  tier1: 'T1',
  tier2: 'T2',
  tier3: 'T3',
}

export function TierConfusionMatrix({ entries }: Props) {
  const { matrix, totals, grand } = useMemo(() => {
    const matrix: Record<string, Record<string, number>> = {}
    const totals: Record<string, number> = {}
    for (const sel of TIERS) { matrix[sel] = {}; totals[sel] = 0 }
    let grand = 0

    for (const entry of entries) {
      const sel = entry.selected_tier
      const rot = entry.routed_tier
      if (!matrix[sel]) matrix[sel] = {}
      matrix[sel][rot] = (matrix[sel][rot] || 0) + 1
      totals[sel] = (totals[sel] || 0) + 1
      grand++
    }

    return { matrix, totals, grand }
  }, [entries])

  if (grand === 0) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center' }}>
        <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          NO ROUTING DATA
        </span>
      </div>
    )
  }

  const maxCell = Math.max(
    ...TIERS.flatMap((sel) =>
      TIERS.map((rot) => matrix[sel]?.[rot] || 0)
    )
  )

  return (
    <div style={{ padding: '0.375rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Selected vs Routed
        </span>
        <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          {grand} samples
        </span>
      </div>

      {/* Matrix grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 1fr 1fr', gap: 3 }}>
          <div />
          {TIERS.map((rot) => (
            <div key={rot} style={{ textAlign: 'center' }}>
              <span style={{
                fontSize: '8px',
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                color: TIER_COLORS[rot],
                textShadow: `0 0 6px ${TIER_COLORS[rot]}60`,
              }}>
                →{TIER_LABELS[rot]}
              </span>
            </div>
          ))}
        </div>

        {/* Rows */}
        {TIERS.map((sel) => {
          const rowTotal = totals[sel]
          return (
            <div key={sel} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 1fr 1fr', gap: 3, alignItems: 'center' }}>
              {/* Row label */}
              <div style={{ textAlign: 'right' }}>
                <span style={{
                  fontSize: '8px',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  color: TIER_COLORS[sel],
                  textShadow: `0 0 6px ${TIER_COLORS[sel]}60`,
                }}>
                  {TIER_LABELS[sel]}→
                </span>
              </div>

              {/* Cells */}
              {TIERS.map((rot) => {
                const count = matrix[sel]?.[rot] || 0
                const pct = rowTotal > 0 ? count / rowTotal : 0
                const intensity = maxCell > 0 ? count / maxCell : 0
                const isDiag = sel === rot
                const bg =
                  count === 0
                    ? 'var(--muted)'
                    : isDiag
                    ? `hsl(145 65% 48% / ${0.1 + intensity * 0.4})`
                    : `hsl(25 95% 55% / ${0.1 + intensity * 0.4})`
                const borderColor = isDiag ? TIER_COLORS[sel] : 'var(--border)'
                const textColor = count > 0
                  ? isDiag
                    ? 'hsl(145 65% 70%)'
                    : 'hsl(25 95% 65%)'
                  : 'var(--muted-foreground)'

                return (
                  <div
                    key={rot}
                    style={{
                      background: bg,
                      border: `1px solid ${borderColor}`,
                      borderRadius: 4,
                      padding: '0.2rem 0.3rem',
                      textAlign: 'center',
                      transition: 'background 300ms ease',
                    }}
                  >
                    <span style={{
                      fontSize: '9px',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: count > 0 ? 700 : 400,
                      color: textColor,
                    }}>
                      {count > 0 ? `${count}` : '—'}
                    </span>
                    {count > 0 && (
                      <span style={{
                        fontSize: '7px',
                        fontFamily: 'var(--font-mono)',
                        color: textColor,
                        opacity: 0.7,
                        display: 'block',
                      }}>
                        {(pct * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '0.125rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: 'hsl(145 65% 48% / 0.4)', border: '1px solid hsl(145 65% 48%)' }} />
          <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>Agreed</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: 'hsl(25 95% 55% / 0.4)', border: '1px solid hsl(25 95% 55%)' }} />
          <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>Rerouted</span>
        </div>
      </div>
    </div>
  )
}
