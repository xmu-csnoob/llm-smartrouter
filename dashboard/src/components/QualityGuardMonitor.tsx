import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const REASON_LIMIT = 5

interface ReasonEntry {
  reason: string
  count: number
  pct: number
}

export function QualityGuardMonitor({ entries }: Props) {
  const { guardCount, total, rate, reasons, activeNow, exclusionReasons } = useMemo(() => {
    let guardCount = 0
    const reasonMap: Record<string, number> = {}
    const exclusionMap: Record<string, number> = {}

    for (const entry of entries) {
      if (entry.quality_guard_applied) {
        guardCount++
        for (const reason of entry.quality_guard_reasons ?? []) {
          reasonMap[reason] = (reasonMap[reason] ?? 0) + 1
        }
      }

      const sp = entry.shadow_policy_decision
      if (sp?.exclusion_reason) {
        exclusionMap[sp.exclusion_reason] = (exclusionMap[sp.exclusion_reason] ?? 0) + 1
      }
    }

    const total = entries.length
    const rate = total > 0 ? (guardCount / total) * 100 : 0

    // Top guard reasons
    const reasonEntries: ReasonEntry[] = Object.entries(reasonMap)
      .map(([reason, count]) => ({ reason, count, pct: guardCount > 0 ? (count / guardCount) * 100 : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, REASON_LIMIT)

    // Top exclusion reasons
    const exclusionEntries: ReasonEntry[] = Object.entries(exclusionMap)
      .map(([reason, count]) => ({ reason, count, pct: 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, REASON_LIMIT)

    // Active now: guards applied in the last 5 entries (newest)
    const recentEntries = entries.slice(0, 5)
    const activeNow = recentEntries.some(e => e.quality_guard_applied)

    return { guardCount, total, rate, reasons: reasonEntries, activeNow, exclusionReasons: exclusionEntries }
  }, [entries])

  const maxReasonCount = Math.max(...reasons.map(r => r.count), 1)

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.35rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '955ms',
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
            Quality Guard
          </span>
          {activeNow && (
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'hsl(280 65% 65%)', boxShadow: '0 0 6px hsl(280 65% 65%)', animation: 'pulse-dot 1.5s ease-in-out infinite' }} />
          )}
        </div>
        {total > 0 && (
          <span style={{
            fontSize: '6px', fontFamily: 'var(--font-mono)',
            color: rate > 10 ? 'hsl(280 65% 65%)' : rate > 5 ? 'hsl(38 92% 55%)' : 'hsl(145 65% 55%)',
            fontWeight: 700,
          }}>
            {rate.toFixed(1)}% applied
          </span>
        )}
      </div>

      {/* Stats row */}
      {total === 0 ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            NO QUALITY GUARD DATA
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {/* Guard count + exclusion count */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.2rem' }}>
                <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'hsl(280 65% 65%)' }}>{guardCount}</span>
                <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>guards</span>
              </div>
              <div style={{ height: 3, borderRadius: 2, background: 'hsl(225 45% 10%)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(rate, 100)}%`, height: '100%', background: 'hsl(280 65% 65%)', borderRadius: 2, boxShadow: '0 0 4px hsl(280 65% 65% / 0.4)', transition: 'width 500ms ease' }} />
              </div>
            </div>

            {exclusionReasons.length > 0 && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.2rem' }}>
                  <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'hsl(0 72% 55%)' }}>{exclusionReasons.reduce((s, r) => s + r.count, 0)}</span>
                  <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>exclusions</span>
                </div>
                <div style={{ height: 3, borderRadius: 2, background: 'hsl(225 45% 10%)', overflow: 'hidden' }}>
                  <div style={{ width: '100%', height: '100%', background: 'hsl(0 72% 55%)', borderRadius: 2, boxShadow: '0 0 4px hsl(0 72% 55% / 0.4)', opacity: 0.6 }} />
                </div>
              </div>
            )}
          </div>

          {/* Guard reasons */}
          {reasons.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
              <div style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Guard Reasons</div>
              {reasons.map(({ reason, count }) => (
                <div key={reason} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  <div style={{
                    flex: 1,
                    fontSize: '5px', fontFamily: 'var(--font-mono)',
                    color: 'hsl(280 65% 65%)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontWeight: 500,
                  }}>
                    {reason || '(empty)'}
                  </div>
                  <div style={{ width: 40, height: 3, background: 'hsl(225 45% 10%)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${(count / maxReasonCount) * 100}%`, height: '100%', background: 'hsl(280 65% 65%)', opacity: 0.6, borderRadius: 2, transition: 'width 400ms ease' }} />
                  </div>
                  <div style={{ width: 20, textAlign: 'right', fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 30%)', fontWeight: 600 }}>
                    {count}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Exclusion reasons */}
          {exclusionReasons.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', borderTop: '1px solid hsl(225 45% 10%)', paddingTop: '0.15rem' }}>
              <div style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Exclusion Reasons</div>
              {exclusionReasons.map(({ reason, count }) => (
                <div key={reason} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  <div style={{
                    flex: 1,
                    fontSize: '5px', fontFamily: 'var(--font-mono)',
                    color: 'hsl(0 72% 55%)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontWeight: 500,
                  }}>
                    {reason || '(empty)'}
                  </div>
                  <div style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 30%)', fontWeight: 600 }}>
                    {count}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      {total > 0 && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: '0.05rem',
          borderTop: '1px solid hsl(225 45% 12%)',
        }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            {total} total requests · quality_guard_applied field
          </span>
          {activeNow && (
            <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(280 65% 65%)', fontWeight: 700 }}>● ACTIVE</span>
          )}
        </div>
      )}
    </div>
  )
}
