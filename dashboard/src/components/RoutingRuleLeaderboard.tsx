import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 15 * 60 * 1000
const MIN_SAMPLES = 10
const MIN_PER_RULE = 5

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

type HealthState = 'HEALTHY' | 'WATCH' | 'UNHEALTHY'

const HEALTH_META: Record<HealthState, { color: string; bg: string; label: string }> = {
  HEALTHY:  { color: 'hsl(145 65% 55%)', bg: 'hsl(145 65% 55% / 0.1)',  label: 'OK' },
  WATCH:    { color: 'hsl(38 92% 55%)',   bg: 'hsl(38 92% 55% / 0.1)',   label: 'WARN' },
  UNHEALTHY:{ color: 'hsl(0 72% 55%)',    bg: 'hsl(0 72% 55% / 0.1)',    label: 'BAD' },
}

function healthState(fallbackRate: number, errorRate: number): HealthState {
  if (fallbackRate > 0.15 || errorRate > 0.10) return 'UNHEALTHY'
  if (fallbackRate > 0.05 || errorRate > 0.03) return 'WATCH'
  return 'HEALTHY'
}

interface RuleStats {
  rule: string
  count: number
  fallbackCount: number
  errorCount: number
  fallbackRate: number
  errorRate: number
  avgLatency: number | null
  latencySamples: number
  dominantTier: string
  effectivenessScore: number
  health: HealthState
  tierBreakdown: Record<string, number>
}

export function RoutingRuleLeaderboard({ entries }: { entries: LogEntry[] }) {
  const stats = useMemo((): RuleStats[] | null => {
    const now = Date.now()
    const timed = entries
      .map(e => {
        const tsMs = parseTimestamp(e.timestamp)
        return tsMs == null ? null : { entry: e, tsMs }
      })
      .filter((item): item is { entry: LogEntry; tsMs: number } => item != null)
      .sort((a, b) => b.tsMs - a.tsMs)

    const recent = timed.filter(({ tsMs }) => now - tsMs <= WINDOW_MS)
    const window = recent.length >= MIN_SAMPLES ? recent : timed.slice(0, 80)
    if (window.length < MIN_SAMPLES) return null

    const logEntries = window.map(w => w.entry)

    // Group by matched_rule
    const ruleMap = new Map<string, {
      count: number
      fallbackCount: number
      errorCount: number
      latencySum: number
      latencyCount: number
      tierCounts: Record<string, number>
    }>()

    for (const e of logEntries) {
      const rule = e.matched_rule || '__no_rule__'
      if (!ruleMap.has(rule)) {
        ruleMap.set(rule, {
          count: 0, fallbackCount: 0, errorCount: 0,
          latencySum: 0, latencyCount: 0,
          tierCounts: {},
        })
      }
      const r = ruleMap.get(rule)!
      r.count++
      if (e.is_fallback) r.fallbackCount++
      if (e.status >= 400 || !!e.error) r.errorCount++
      if (typeof e.latency_ms === 'number' && Number.isFinite(e.latency_ms) && e.latency_ms > 0) {
        r.latencySum += e.latency_ms
        r.latencyCount++
      }
      const tier = e.routed_tier || 'unknown'
      r.tierCounts[tier] = (r.tierCounts[tier] || 0) + 1
    }

    const results: RuleStats[] = []
    for (const [rule, r] of ruleMap) {
      if (r.count < MIN_PER_RULE) continue
      const fr = r.fallbackCount / r.count
      const er = r.errorCount / r.count
      const eff = Math.max(0, 1 - fr - er)
      const dominantTier = Object.entries(r.tierCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown'
      results.push({
        rule: rule === '__no_rule__' ? 'No Rule (ML/Direct)' : rule,
        count: r.count,
        fallbackCount: r.fallbackCount,
        errorCount: r.errorCount,
        fallbackRate: fr,
        errorRate: er,
        avgLatency: r.latencyCount > 0 ? r.latencySum / r.latencyCount : null,
        latencySamples: r.latencyCount,
        dominantTier,
        tierBreakdown: r.tierCounts,
        effectivenessScore: eff,
        health: healthState(fr, er),
      })
    }

    results.sort((a, b) => b.effectivenessScore - a.effectivenessScore)
    return results
  }, [entries])

  const fmtLatency = (ms: number | null): string => {
    if (ms === null) return '—'
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.round(ms)}ms`
  }

  if (!stats || stats.length === 0) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '980ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT ROUTING RULE DATA
        </div>
      </div>
    )
  }

  const healthy = stats.filter(s => s.health === 'HEALTHY').length
  const watch = stats.filter(s => s.health === 'WATCH').length
  const unhealthy = stats.filter(s => s.health === 'UNHEALTHY').length

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '980ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Routing Rule Leaderboard
        </span>
        <div style={{ display: 'flex', gap: '0.15rem' }}>
          {[
            { label: healthy, color: HEALTH_META.HEALTHY.color },
            { label: watch, color: HEALTH_META.WATCH.color },
            { label: unhealthy, color: HEALTH_META.UNHEALTHY.color },
          ].map(({ label, color: c }, i) => (
            <span key={i} style={{
              fontSize: '5px', fontFamily: 'var(--font-mono)',
              color: c, background: `${c}15`,
              border: `1px solid ${c}30`,
              borderRadius: 2, padding: '2px 5px',
            }}>
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Column header */}
      <div style={{ display: 'flex', gap: '0.08rem', padding: '0.04rem 0.08rem', borderBottom: '1px solid hsl(225 45% 12%)' }}>
        {['RULE', 'N', 'FALLBK', 'ERR%', 'LAT', 'TIER', 'SCORE'].map((h, i) => (
          <span key={h} style={{
            fontSize: '3.5px', fontFamily: 'var(--font-mono)',
            color: 'hsl(145 65% 40%)', letterSpacing: '0.04em',
            flex: i === 0 ? 2 : 1,
            textAlign: i === 3 || i === 4 ? 'right' : 'left',
          }}>{h}</span>
        ))}
      </div>

      {/* Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.04rem' }}>
        {stats.slice(0, 10).map((s, idx) => {
          const hm = HEALTH_META[s.health]
          const tierColor = s.dominantTier === 'tier1'
            ? 'hsl(280 65% 65%)'
            : s.dominantTier === 'tier2'
            ? 'hsl(185 80% 55%)'
            : s.dominantTier === 'tier3'
            ? 'hsl(145 65% 55%)'
            : 'hsl(225 45% 40%)'
          return (
            <div key={s.rule} style={{
              display: 'flex', gap: '0.08rem', padding: '0.05rem 0.08rem',
              borderRadius: 2, alignItems: 'center',
              background: s.health === 'UNHEALTHY' ? hm.bg
                : s.health === 'WATCH' ? hm.bg
                : 'transparent',
            }}>
              {/* Rank */}
              <span style={{
                width: 10, fontSize: '4px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 30%)', textAlign: 'center', flexShrink: 0,
              }}>
                {idx + 1}
              </span>
              {/* Rule name */}
              <span style={{
                flex: 2, fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: hm.color, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {s.rule}
              </span>
              {/* Count */}
              <span style={{
                flex: 1, fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: 'var(--foreground)', textAlign: 'center', fontWeight: 700,
              }}>
                {s.count}
              </span>
              {/* Fallback rate */}
              <span style={{
                flex: 1, fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: s.fallbackRate > 0.05 ? 'hsl(0 72% 60%)' : 'hsl(145 65% 55%)',
                textAlign: 'right', fontWeight: s.fallbackRate > 0.05 ? 700 : 400,
              }}>
                {s.fallbackRate > 0 ? `${(s.fallbackRate * 100).toFixed(1)}%` : '—'}
              </span>
              {/* Error rate */}
              <span style={{
                flex: 1, fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: s.errorRate > 0.03 ? 'hsl(0 72% 60%)' : 'hsl(145 65% 55%)',
                textAlign: 'right', fontWeight: s.errorRate > 0.03 ? 700 : 400,
              }}>
                {(s.errorRate * 100).toFixed(1)}%
              </span>
              {/* Latency */}
              <span style={{
                flex: 1, fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 50%)', textAlign: 'right',
              }}>
                {fmtLatency(s.avgLatency)}
              </span>
              {/* Dominant tier */}
              <span style={{
                flex: 1, fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: tierColor, textAlign: 'center', fontWeight: 700,
              }}>
                {s.dominantTier.replace('tier', 'T')}
              </span>
              {/* Effectiveness score bar */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                <div style={{
                  height: 3, borderRadius: 1, flex: 1,
                  background: 'hsl(225 45% 12%)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${s.effectivenessScore * 100}%`,
                    background: hm.color,
                    boxShadow: `0 0 3px ${hm.color}60`,
                    borderRadius: 1,
                  }} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '5px',
        color: 'var(--muted-foreground)', textAlign: 'right', opacity: 0.7,
      }}>
        {stats.length} rules · 15-min window · min {MIN_PER_RULE} samples · sorted by effectiveness
      </div>
    </div>
  )
}
