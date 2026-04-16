import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const TIERS = ['tier1', 'tier2', 'tier3'] as const
type Tier = typeof TIERS[number]

const TIER_LABELS: Record<Tier, string> = {
  tier1: 'tier1 (Frontier)',
  tier2: 'tier2 (Workhorse)',
  tier3: 'tier3 (Routine)',
}

type TaskCategory = 'simple' | 'implementation' | 'architecture' | 'unknown'

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  simple: 'simple / debug / conflicts',
  implementation: 'implementation / analysis',
  architecture: 'architecture / design',
  unknown: 'unknown',
}

function categorizeTaskType(taskType?: string): TaskCategory {
  if (!taskType) return 'unknown'
  const lower = taskType.toLowerCase()
  if (lower === 'simple' || lower === 'debug' || lower === 'conflicts') return 'simple'
  if (lower === 'implementation' || lower === 'analysis') return 'implementation'
  if (lower === 'architecture' || lower === 'design') return 'architecture'
  return 'unknown'
}

function isCorrectRouting(category: TaskCategory, tier: string): boolean {
  if (category === 'simple') return tier === 'tier3'
  if (category === 'implementation') return tier === 'tier2'
  if (category === 'architecture') return tier === 'tier1'
  return false
}

function isMismatch(category: TaskCategory, tier: string): boolean {
  if (category === 'unknown') return false
  return !isCorrectRouting(category, tier)
}

const CATEGORY_ROWS: TaskCategory[] = ['simple', 'implementation', 'architecture', 'unknown']

export function TierEfficiencyMatrix({ entries }: Props) {
  const { matrix, totalKnown, mismatchCount } = useMemo(() => {
    const matrix: Record<TaskCategory, Record<Tier, number>> = {
      simple: { tier1: 0, tier2: 0, tier3: 0 },
      implementation: { tier1: 0, tier2: 0, tier3: 0 },
      architecture: { tier1: 0, tier2: 0, tier3: 0 },
      unknown: { tier1: 0, tier2: 0, tier3: 0 },
    }
    let totalKnown = 0
    let mismatchCount = 0

    for (const entry of entries) {
      const category = categorizeTaskType(entry.task_type)
      const tier = entry.routed_tier as Tier | undefined

      if (!tier) continue
      if (category !== 'unknown' && TIERS.includes(tier as Tier)) {
        totalKnown++
        if (isMismatch(category, tier)) {
          mismatchCount++
        }
      }

      if (tier && TIERS.includes(tier as Tier)) {
        matrix[category][tier as Tier]++
      }
    }

    return { matrix, totalKnown, mismatchCount }
  }, [entries])

  const maxCell = Math.max(
    ...CATEGORY_ROWS.flatMap((cat) =>
      TIERS.map((tier) => matrix[cat][tier])
    )
  )

  const efficiency = totalKnown > 0 ? ((totalKnown - mismatchCount) / totalKnown) * 100 : 0

  return (
    <div
      style={{
        padding: '0.375rem 0.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        animation: 'fade-in-up 600ms ease-out 966ms both',
      }}
    >
      {/* Grid container */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {/* Column headers */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '140px 1fr 1fr 1fr',
            gap: 3,
          }}
        >
          <div />
          {TIERS.map((tier) => (
            <div key={tier} style={{ textAlign: 'center' }}>
              <span
                style={{
                  fontSize: '8px',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  color:
                    tier === 'tier1'
                      ? 'hsl(280 65% 65%)'
                      : tier === 'tier2'
                      ? 'hsl(200 75% 60%)'
                      : 'hsl(145 65% 55%)',
                  textShadow:
                    tier === 'tier1'
                      ? '0 0 6px hsl(280 65% 65% / 0.5)'
                      : tier === 'tier2'
                      ? '0 0 6px hsl(200 75% 55% / 0.5)'
                      : '0 0 6px hsl(145 65% 48% / 0.5)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {TIER_LABELS[tier]}
              </span>
            </div>
          ))}
        </div>

        {/* Data rows */}
        {CATEGORY_ROWS.map((category) => {
          const rowTotal = TIERS.reduce((sum, tier) => sum + matrix[category][tier], 0)
          const isUnknown = category === 'unknown'

          return (
            <div
              key={category}
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr 1fr 1fr',
                gap: 3,
                alignItems: 'center',
              }}
            >
              {/* Row label */}
              <div style={{ textAlign: 'left' }}>
                <span
                  style={{
                    fontSize: '8px',
                    fontFamily: 'var(--font-mono)',
                    color: isUnknown ? 'var(--muted-foreground)' : 'var(--foreground)',
                    opacity: isUnknown ? 0.5 : 1,
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                  }}
                >
                  {CATEGORY_LABELS[category]}
                </span>
                {rowTotal > 0 && (
                  <span
                    style={{
                      fontSize: '7px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--muted-foreground)',
                      marginLeft: '0.35rem',
                    }}
                  >
                    ({rowTotal})
                  </span>
                )}
              </div>

              {/* Cells */}
              {TIERS.map((tier) => {
                const count = matrix[category][tier]
                const intensity = maxCell > 0 ? count / maxCell : 0
                const correct = isCorrectRouting(category, tier)
                const mismatched = isMismatch(category, tier)
                const isEmpty = count === 0

                let bg: string
                let borderColor: string
                let textColor: string
                let glow: string

                if (isEmpty) {
                  bg = 'transparent'
                  borderColor = 'var(--border)'
                  borderColor += '30'
                  textColor = 'var(--muted-foreground)'
                  glow = 'none'
                } else if (correct) {
                  bg = `hsl(145 65% 48% / ${0.1 + intensity * 0.25})`
                  borderColor = `hsl(145 65% 55% / 0.6)`
                  textColor = 'hsl(145 65% 70%)'
                  glow = `0 0 8px hsl(145 65% 48% / ${0.3 + intensity * 0.4})`
                } else if (mismatched) {
                  bg = `hsl(38 92% 55% / ${0.08 + intensity * 0.2})`
                  borderColor = `hsl(38 92% 55% / 0.6)`
                  textColor = 'hsl(38 92% 65%)'
                  glow = `0 0 8px hsl(38 92% 55% / ${0.2 + intensity * 0.35})`
                } else {
                  // Non-empty unknown-category cell
                  bg = `hsl(200 75% 50% / ${0.05 + intensity * 0.15})`
                  borderColor = `hsl(200 75% 50% / 0.3)`
                  textColor = 'var(--muted-foreground)'
                  glow = 'none'
                }

                return (
                  <div
                    key={tier}
                    style={{
                      background: bg,
                      border: `1px solid ${borderColor}`,
                      borderRadius: 4,
                      padding: '0.3rem 0.25rem',
                      textAlign: 'center',
                      transition: 'background 300ms ease, box-shadow 300ms ease',
                      boxShadow: glow !== 'none' ? glow : undefined,
                      minHeight: 42,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span
                      style={{
                        fontSize: count > 0 ? '14px' : '10px',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: count > 0 ? 700 : 400,
                        color: textColor,
                        lineHeight: 1,
                      }}
                    >
                      {count > 0 ? count : '—'}
                    </span>
                    {count > 0 && (
                      <span
                        style={{
                          fontSize: '7px',
                          fontFamily: 'var(--font-mono)',
                          color: textColor,
                          opacity: 0.7,
                          marginTop: 2,
                        }}
                      >
                        {intensity > 0 ? `${(intensity * 100).toFixed(0)}%` : ''}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Stats row */}
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          justifyContent: 'center',
          paddingTop: '0.25rem',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span
            style={{
              fontSize: '8px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--muted-foreground)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Efficiency
          </span>
          <span
            style={{
              fontSize: '12px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              color: efficiency >= 80 ? 'hsl(145 65% 60%)' : efficiency >= 50 ? 'hsl(45 85% 55%)' : 'hsl(25 95% 60%)',
              textShadow:
                efficiency >= 80
                  ? '0 0 8px hsl(145 65% 48% / 0.5)'
                  : efficiency >= 50
                  ? '0 0 8px hsl(45 85% 55% / 0.5)'
                  : '0 0 8px hsl(25 95% 55% / 0.5)',
            }}
          >
            {efficiency.toFixed(1)}%
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span
            style={{
              fontSize: '8px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--muted-foreground)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Mismatched
          </span>
          <span
            style={{
              fontSize: '12px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              color: mismatchCount > 0 ? 'hsl(38 92% 60%)' : 'hsl(145 65% 60%)',
              textShadow:
                mismatchCount > 0
                  ? '0 0 8px hsl(38 92% 55% / 0.5)'
                  : '0 0 8px hsl(145 65% 48% / 0.5)',
            }}
          >
            {mismatchCount}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span
            style={{
              fontSize: '8px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--muted-foreground)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Total
          </span>
          <span
            style={{
              fontSize: '12px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              color: 'var(--foreground)',
            }}
          >
            {totalKnown}
          </span>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: 'hsl(145 65% 48% / 0.25)',
              border: '1px solid hsl(145 65% 55% / 0.6)',
              boxShadow: '0 0 4px hsl(145 65% 48% / 0.4)',
            }}
          />
          <span
            style={{
              fontSize: '7px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--muted-foreground)',
            }}
          >
            Correct
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: 'hsl(38 92% 55% / 0.2)',
              border: '1px solid hsl(38 92% 55% / 0.6)',
              boxShadow: '0 0 4px hsl(38 92% 55% / 0.35)',
            }}
          />
          <span
            style={{
              fontSize: '7px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--muted-foreground)',
            }}
          >
            Mismatched
          </span>
        </div>
      </div>
    </div>
  )
}
