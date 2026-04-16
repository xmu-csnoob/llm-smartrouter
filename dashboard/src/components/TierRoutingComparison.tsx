import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const DIFFICULTY_ORDER = ['simple', 'debug', 'implementation', 'architecture', 'analysis', 'general'] as const
type Difficulty = typeof DIFFICULTY_ORDER[number]

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  simple: 'Simple',
  debug: 'Debug',
  implementation: 'Impl',
  architecture: 'Arch',
  analysis: 'Analysis',
  general: 'General',
}

const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  simple: 'hsl(145 65% 55%)',
  debug: 'hsl(38 92% 55%)',
  implementation: 'hsl(200 75% 55%)',
  architecture: 'hsl(280 65% 65%)',
  analysis: 'hsl(260 65% 55%)',
  general: 'hsl(0 0% 55%)',
}

const ROUTER_COLORS = {
  ml: 'hsl(185 80% 50%)',
  rule: 'hsl(38 92% 55%)',
} as const

const MIN_SAMPLE = 5

interface ComparisonRow {
  difficulty: Difficulty
  label: string
  color: string
  mlRate: number      // non-fallback rate (0-1)
  ruleRate: number
  mlCount: number
  ruleCount: number
  delta: number       // mlRate - ruleRate (positive = ML better)
  mlLowN: boolean
  ruleLowN: boolean
}

function ComparisonBar({ row }: { row: ComparisonRow }) {
  const mlWidth = row.mlRate * 100
  const ruleWidth = row.ruleRate * 100
  const mlColor = ROUTER_COLORS.ml
  const ruleColor = ROUTER_COLORS.rule
  const deltaColor = row.delta > 0.05 ? mlColor : row.delta < -0.05 ? ruleColor : 'hsl(225 45% 25%)'
  const absDelta = Math.abs(row.delta)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.1rem 0' }}>
      {/* Difficulty label */}
      <div style={{
        fontSize: '7px', fontFamily: 'var(--font-mono)',
        color: row.color,
        width: 44, flexShrink: 0,
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}>
        {row.label}
      </div>

      {/* ML bar */}
      <div style={{ position: 'relative', flex: 1 }}>
        <div style={{
          height: 7,
          background: 'hsl(225 45% 10%)',
          borderRadius: 3,
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute',
            left: 0, top: 0, bottom: 0,
            width: `${mlWidth}%`,
            background: row.mlLowN
              ? `repeating-linear-gradient(90deg, ${mlColor}30, ${mlColor}30 3px, ${mlColor}60 3px, ${mlColor}60 6px)`
              : `linear-gradient(90deg, ${mlColor}40, ${mlColor}90)`,
            borderRadius: 3,
            boxShadow: row.mlLowN ? 'none' : `0 0 5px ${mlColor}40`,
            transition: 'width 600ms cubic-bezier(0.34, 1.2, 0.64, 1)',
          }} />
        </div>
        {!row.mlLowN && (
          <div style={{
            position: 'absolute',
            right: 2, top: 0, bottom: 0,
            display: 'flex', alignItems: 'center',
          }}>
            <span style={{
              fontSize: '5px', fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              color: mlColor,
            }}>
              {(row.mlRate * 100).toFixed(0)}%
            </span>
          </div>
        )}
        {row.mlLowN && (
          <div style={{
            position: 'absolute',
            right: 2, top: 0, bottom: 0,
            display: 'flex', alignItems: 'center',
          }}>
            <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>LOW-N</span>
          </div>
        )}
      </div>

      {/* Rule bar */}
      <div style={{ position: 'relative', flex: 1 }}>
        <div style={{
          height: 7,
          background: 'hsl(225 45% 10%)',
          borderRadius: 3,
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute',
            left: 0, top: 0, bottom: 0,
            width: `${ruleWidth}%`,
            background: row.ruleLowN
              ? `repeating-linear-gradient(90deg, ${ruleColor}30, ${ruleColor}30 3px, ${ruleColor}60 3px, ${ruleColor}60 6px)`
              : `linear-gradient(90deg, ${ruleColor}40, ${ruleColor}90)`,
            borderRadius: 3,
            boxShadow: row.ruleLowN ? 'none' : `0 0 5px ${ruleColor}40`,
            transition: 'width 600ms cubic-bezier(0.34, 1.2, 0.64, 1)',
          }} />
        </div>
        {!row.ruleLowN && (
          <div style={{
            position: 'absolute',
            right: 2, top: 0, bottom: 0,
            display: 'flex', alignItems: 'center',
          }}>
            <span style={{
              fontSize: '5px', fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              color: ruleColor,
            }}>
              {(row.ruleRate * 100).toFixed(0)}%
            </span>
          </div>
        )}
        {row.ruleLowN && (
          <div style={{
            position: 'absolute',
            right: 2, top: 0, bottom: 0,
            display: 'flex', alignItems: 'center',
          }}>
            <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>LOW-N</span>
          </div>
        )}
      </div>

      {/* Delta */}
      <div style={{
        width: 36, flexShrink: 0, textAlign: 'right',
        fontSize: '5.5px', fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        color: deltaColor,
      }}>
        {absDelta < 0.05 ? '~' : row.delta > 0 ? `+${(row.delta * 100).toFixed(0)}` : `${(row.delta * 100).toFixed(0)}`}
        {absDelta >= 0.05 && (
          <span style={{ fontSize: '4px', color: 'hsl(225 45% 25%)', marginLeft: 1 }}>pp</span>
        )}
      </div>
    </div>
  )
}

export function TierRoutingComparison({ entries }: Props) {
  const { rows, mlOverall, ruleOverall, mlTotal, ruleTotal } = useMemo(() => {
    // Group entries by difficulty (from semantic_features.difficulty or task_type fallback)
    const buckets: Record<Difficulty, { ml: LogEntry[]; rule: LogEntry[] }> = {
      simple: { ml: [], rule: [] },
      debug: { ml: [], rule: [] },
      implementation: { ml: [], rule: [] },
      architecture: { ml: [], rule: [] },
      analysis: { ml: [], rule: [] },
      general: { ml: [], rule: [] },
    }

    for (const entry of entries) {
      const diff = (entry.semantic_features?.difficulty ?? entry.task_type ?? 'general') as Difficulty
      const bucket = buckets[diff] ?? buckets.general
      if (entry.matched_by === 'ml') bucket.ml.push(entry)
      else bucket.rule.push(entry)
    }

    const mlEntries: LogEntry[] = []
    const ruleEntries: LogEntry[] = []

    const rows: ComparisonRow[] = DIFFICULTY_ORDER.map(diff => {
      const { ml, rule } = buckets[diff]
      mlEntries.push(...ml)
      ruleEntries.push(...rule)

      const mlNoFallback = ml.filter(e => !e.is_fallback).length
      const ruleNoFallback = rule.filter(e => !e.is_fallback).length

      const mlRate = ml.length > 0 ? mlNoFallback / ml.length : 0
      const ruleRate = rule.length > 0 ? ruleNoFallback / rule.length : 0

      return {
        difficulty: diff,
        label: DIFFICULTY_LABELS[diff],
        color: DIFFICULTY_COLORS[diff],
        mlRate,
        ruleRate,
        mlCount: ml.length,
        ruleCount: rule.length,
        delta: mlRate - ruleRate,
        mlLowN: ml.length < MIN_SAMPLE,
        ruleLowN: rule.length < MIN_SAMPLE,
      }
    }).filter(r => r.mlCount > 0 || r.ruleCount > 0)

    const mlNoFallbackAll = mlEntries.filter(e => !e.is_fallback).length
    const ruleNoFallbackAll = ruleEntries.filter(e => !e.is_fallback).length
    const mlOverall = mlEntries.length > 0 ? mlNoFallbackAll / mlEntries.length : 0
    const ruleOverall = ruleEntries.length > 0 ? ruleNoFallbackAll / ruleEntries.length : 0

    return { rows, mlOverall, ruleOverall, mlTotal: mlEntries.length, ruleTotal: ruleEntries.length }
  }, [entries])

  const hasData = mlTotal > 0 || ruleTotal > 0

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '880ms',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{
            fontSize: '9px', fontFamily: 'var(--font-mono)',
            color: 'var(--muted-foreground)', textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            ML vs Rule
          </span>
          <div style={{
            width: 5, height: 5, borderRadius: '50%',
            background: mlOverall > ruleOverall ? ROUTER_COLORS.ml : ROUTER_COLORS.rule,
            boxShadow: `0 0 6px ${mlOverall > ruleOverall ? ROUTER_COLORS.ml : ROUTER_COLORS.rule}`,
            animation: Math.abs(mlOverall - ruleOverall) > 0.05 ? 'pulse-dot 2s ease-in-out infinite' : 'none',
          }} />
        </div>

        {/* Proxy label */}
        <span style={{
          fontSize: '5px', fontFamily: 'var(--font-mono)',
          color: 'hsl(225 45% 20%)',
          letterSpacing: '0.03em',
        }}>
          non-fallback rate proxy
        </span>
      </div>

      {/* Column headers */}
      {hasData && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <div style={{ width: 44, flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: ROUTER_COLORS.ml, boxShadow: `0 0 4px ${ROUTER_COLORS.ml}` }} />
            <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>ML</span>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: ROUTER_COLORS.rule, boxShadow: `0 0 4px ${ROUTER_COLORS.rule}` }} />
            <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>Rule</span>
          </div>
          <div style={{ width: 36, flexShrink: 0, textAlign: 'right' }}>
            <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>delta</span>
          </div>
        </div>
      )}

      {/* Rows */}
      {rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '0.75rem 0' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            NO MATCHED-BY DATA
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.05rem' }}>
          {rows.map(row => (
            <ComparisonBar key={row.difficulty} row={row} />
          ))}
        </div>
      )}

      {/* Footer summary */}
      {hasData && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: '0.1rem',
          borderTop: '1px solid hsl(225 45% 12%)',
        }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            ML={mlTotal} Rule={ruleTotal} · n≥{MIN_SAMPLE} per bucket
          </span>
          {mlTotal >= MIN_SAMPLE && ruleTotal >= MIN_SAMPLE ? (
            <span style={{
              fontSize: '6px', fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              color: mlOverall > ruleOverall ? ROUTER_COLORS.ml : ROUTER_COLORS.rule,
            }}>
              ML {(mlOverall * 100).toFixed(0)}% vs Rule {(ruleOverall * 100).toFixed(0)}%
            </span>
          ) : (
            <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
              overall requires n≥{MIN_SAMPLE} per router
            </span>
          )}
        </div>
      )}
    </div>
  )
}
