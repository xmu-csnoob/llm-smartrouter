import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const METHOD_ORDER = [
  { key: 'scoring',               label: 'Scoring',    color: 'hsl(185 80% 50%)', group: 'ml' },
  { key: 'legacy-rule+scoring',   label: 'Legacy+Sc',  color: 'hsl(200 75% 55%)', group: 'ml' },
  { key: 'keyword',               label: 'Keyword',    color: 'hsl(38 92% 55%)',  group: 'rule' },
  { key: 'expr',                  label: 'Expr',       color: 'hsl(30 75% 55%)',  group: 'rule' },
  { key: 'default',               label: 'Default',    color: 'hsl(0 0% 55%)',     group: 'rule' },
  { key: 'passthrough',           label: 'Passthrough',color: 'hsl(225 45% 20%)', group: 'other' },
] as const

type MethodKey = typeof METHOD_ORDER[number]['key']

interface MethodBar {
  key: MethodKey
  label: string
  color: string
  group: 'ml' | 'rule' | 'other'
  count: number
  pct: number
}

function MethodBar({ bar, maxCount }: { bar: MethodBar; maxCount: number }) {
  const width = maxCount > 0 ? (bar.count / maxCount) * 100 : 0
  const isZero = bar.count === 0

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.3rem',
      padding: '0.08rem 0.15rem',
      borderBottom: '1px solid hsl(225 45% 10%)',
      opacity: isZero ? 0.35 : 1,
      transition: 'opacity 300ms ease',
    }}>
      {/* Method label */}
      <div style={{
        fontSize: '6px', fontFamily: 'var(--font-mono)',
        color: bar.color,
        width: 42, flexShrink: 0,
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}>
        {bar.label}
      </div>

      {/* Bar */}
      <div style={{
        flex: 1,
        height: 6,
        background: 'hsl(225 45% 10%)',
        borderRadius: 3,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${width}%`,
          height: '100%',
          background: `linear-gradient(90deg, ${bar.color}40, ${bar.color}80)`,
          borderRadius: 3,
          boxShadow: isZero ? 'none' : `0 0 4px ${bar.color}30`,
          transition: 'width 600ms cubic-bezier(0.34, 1.2, 0.64, 1)',
        }} />
      </div>

      {/* Count */}
      <div style={{
        fontSize: '6px', fontFamily: 'var(--font-mono)',
        color: 'var(--muted-foreground)',
        width: 28, flexShrink: 0, textAlign: 'right',
        fontWeight: 600,
      }}>
        {bar.count}
      </div>

      {/* Percent */}
      <div style={{
        fontSize: '5.5px', fontFamily: 'var(--font-mono)',
        color: bar.color,
        width: 28, flexShrink: 0, textAlign: 'right',
        fontWeight: 700,
      }}>
        {bar.count > 0 ? `${bar.pct.toFixed(1)}%` : '—'}
      </div>
    </div>
  )
}

export function RoutingMethodDistribution({ entries }: Props) {
  const { bars, total, mlTotal, ruleTotal } = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const entry of entries) {
      const key = entry.matched_by ?? ''
      if (key) counts[key] = (counts[key] ?? 0) + 1
    }

    const total = entries.length

    const bars: MethodBar[] = METHOD_ORDER.map(({ key, label, color, group }) => {
      const count = counts[key] ?? 0
      const pct = total > 0 ? (count / total) * 100 : 0
      return { key, label, color, group, count, pct }
    }).filter(b => b.count > 0 || b.group !== 'other')

    const mlTotal = bars.filter(b => b.group === 'ml').reduce((s, b) => s + b.count, 0)
    const ruleTotal = bars.filter(b => b.group === 'rule').reduce((s, b) => s + b.count, 0)

    return { bars, total, mlTotal, ruleTotal }
  }, [entries])

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '940ms',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: '9px', fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)', textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Routing Methods
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          {mlTotal > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'hsl(185 80% 50%)', boxShadow: '0 0 4px hsl(185 80% 50%)' }} />
              <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>ML</span>
              <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'hsl(185 80% 50%)' }}>{mlTotal}</span>
            </div>
          )}
          {ruleTotal > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'hsl(38 92% 55%)', boxShadow: '0 0 4px hsl(38 92% 55%)' }} />
              <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>Rule</span>
              <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'hsl(38 92% 55%)' }}>{ruleTotal}</span>
            </div>
          )}
        </div>
      </div>

      {/* Column headers */}
      {total > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.3rem',
          padding: '0 0.15rem',
          borderBottom: '1px solid hsl(225 45% 12%)',
        }}>
          {[['METHOD', 42], ['', 1], ['N', 28], ['%', 28]].map(([label, width]) => (
            <div key={label} style={{
              fontSize: '4.5px', fontFamily: 'var(--font-mono)',
              color: 'hsl(225 45% 20%)',
              letterSpacing: '0.06em',
              width, flexShrink: 0,
              textAlign: label === 'N' || label === '%' ? 'right' : 'left',
            }}>
              {label}
            </div>
          ))}
        </div>
      )}

      {/* Rows */}
      {total === 0 ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            NO ROUTING DATA
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {bars.map(bar => (
            <MethodBar key={bar.key} bar={bar} maxCount={Math.max(...bars.map(b => b.count), 1)} />
          ))}
        </div>
      )}

      {/* Footer */}
      {total > 0 && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: '0.1rem',
          borderTop: '1px solid hsl(225 45% 12%)',
        }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            {total} requests · matched_by field
          </span>
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            {[['ML', 'hsl(185 80% 50%)'], ['Rule', 'hsl(38 92% 55%)']].map(([label, color]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: color }} />
                <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
