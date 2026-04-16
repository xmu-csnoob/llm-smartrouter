import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 15 * 60 * 1000
const MIN_SAMPLES = 10

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

interface FloorBreach {
  requestId: string
  requestedTier: string
  minAllowedTier: string
  selectedTier: string
  matchedBy: string
  status: number
  error: string | null
  latency: number | null
  tsMs: number
}

interface FloorStats {
  total: number
  windowSize: number
  floorCount: number
  floorRate: number
  breachCount: number
  breachRate: number
  tierFloorMap: Record<string, {
    total: number
    constrained: number
    errorCount: number
    errorRate: number
    medianLatency: number | null
    latencies: number[]
  }>
  minTierBreakdown: Record<string, {
    count: number
    errorCount: number
    errorRate: number
  }>
  recentBreaches: FloorBreach[]
  constrainedErrorRate: number
  freeErrorRate: number
}

const TIER_RANK: Record<string, number> = { tier1: 1, tier2: 2, tier3: 3 }

export function TierFloorBreachPanel({ entries }: { entries: LogEntry[] }) {
  const stats = useMemo((): FloorStats | null => {
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
    const total = logEntries.length

    let floorCount = 0
    let breachCount = 0
    const tierFloorMap: FloorStats['tierFloorMap'] = {}
    const minTierBreakdown: FloorStats['minTierBreakdown'] = {}
    const recentBreaches: FloorBreach[] = []
    let constrainedErrors = 0
    let freeErrors = 0

    for (const { entry, tsMs } of window) {
      const minTier = entry.min_allowed_tier
      const selectedTier = entry.selected_tier || entry.routed_tier || 'unknown'
      const requestedTier = entry.requested_model ? 'unknown' : selectedTier // fallback

      // Initialize tier floor map
      const key = selectedTier
      if (!tierFloorMap[key]) {
        tierFloorMap[key] = { total: 0, constrained: 0, errorCount: 0, errorRate: 0, medianLatency: null, latencies: [] }
      }
      const tfm = tierFloorMap[key]
      tfm.total++

      const hasError = entry.status >= 400 || !!entry.error

      // Track min_allowed_tier breakdown
      if (minTier) {
        if (!minTierBreakdown[minTier]) {
          minTierBreakdown[minTier] = { count: 0, errorCount: 0, errorRate: 0 }
        }
        minTierBreakdown[minTier].count++
        if (hasError) minTierBreakdown[minTier].errorCount++
      }

      // Check if routing was constrained from below
      if (minTier) {
        const minRank = TIER_RANK[minTier] ?? 0
        const selectedRank = TIER_RANK[selectedTier] ?? 0
        const isConstrained = selectedRank <= minRank

        if (isConstrained) {
          floorCount++
          tfm.constrained++
          if (hasError) constrainedErrors++

          // Breach = selected_tier equals min_allowed_tier (exactly at the floor)
          if (selectedRank === minRank && minRank > 0) {
            breachCount++
            if (recentBreaches.length < 6) {
              recentBreaches.push({
                requestId: entry.request_id.slice(-6),
                requestedTier: requestedTier,
                minAllowedTier: minTier,
                selectedTier,
                matchedBy: entry.matched_by || 'unknown',
                status: entry.status,
                error: typeof entry.error === 'string' ? entry.error.slice(0, 40) : null,
                latency: typeof entry.latency_ms === 'number' ? entry.latency_ms : null,
                tsMs,
              })
            }
          }
        } else {
          // Free routing (above floor)
          if (hasError) freeErrors++
        }
      } else {
        // No floor — free routing
        if (hasError) freeErrors++
      }

      // Latency tracking for tier floor map
      if (typeof entry.latency_ms === 'number' && Number.isFinite(entry.latency_ms) && entry.latency_ms > 0) {
        tfm.latencies.push(entry.latency_ms)
      }
    }

    // Finalize tier floor map
    for (const tfm of Object.values(tierFloorMap)) {
      tfm.errorRate = tfm.total > 0 ? tfm.errorCount / tfm.total : 0
      tfm.medianLatency = computeMedian(tfm.latencies)
    }

    // Finalize min tier breakdown
    for (const mt of Object.values(minTierBreakdown)) {
      mt.errorRate = mt.count > 0 ? mt.errorCount / mt.count : 0
    }

    const constrainedTotal = floorCount
    const freeTotal = total - constrainedTotal

    return {
      total,
      windowSize: window.length,
      floorCount,
      floorRate: total > 0 ? floorCount / total : 0,
      breachCount,
      breachRate: total > 0 ? breachCount / total : 0,
      tierFloorMap,
      minTierBreakdown,
      recentBreaches,
      constrainedErrorRate: constrainedTotal > 0 ? constrainedErrors / constrainedTotal : 0,
      freeErrorRate: freeTotal > 0 ? freeErrors / freeTotal : 0,
    }
  }, [entries])

  if (!stats) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '986ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT TIER FLOOR DATA
        </div>
      </div>
    )
  }

  const { total, windowSize, floorCount, floorRate, breachCount, breachRate, tierFloorMap, minTierBreakdown, recentBreaches, constrainedErrorRate, freeErrorRate } = stats

  const tierColor = (tier: string) =>
    tier === 'tier1' ? 'hsl(280 65% 65%)'
    : tier === 'tier2' ? 'hsl(185 80% 55%)'
    : tier === 'tier3' ? 'hsl(145 65% 55%)'
    : 'hsl(225 45% 40%)'

  const errorRateColor = (rate: number): string => {
    if (rate < 0.02) return 'hsl(145 65% 55%)'
    if (rate < 0.05) return 'hsl(38 92% 55%)'
    if (rate < 0.1) return 'hsl(25 85% 55%)'
    return 'hsl(0 72% 55%)'
  }

  const floorRateColor = floorRate > 0.05 ? 'hsl(0 72% 55%)'
    : floorRate > 0.01 ? 'hsl(38 92% 55%)'
    : 'hsl(145 65% 55%)'

  const sortedTiers = Object.entries(tierFloorMap).sort((a, b) => {
    const rankA = TIER_RANK[a[0]] ?? 0
    const rankB = TIER_RANK[b[0]] ?? 0
    return rankA - rankB
  })

  const maxTierTotal = Math.max(...Object.values(tierFloorMap).map(t => t.total), 1)

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '986ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Tier Floor Monitor
        </span>
        <div style={{ display: 'flex', gap: '0.15rem', alignItems: 'center' }}>
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: floorRateColor,
            background: `${floorRateColor}15`,
            border: `1px solid ${floorRateColor}30`,
            borderRadius: 2, padding: '2px 5px',
            fontWeight: 700,
          }}>
            {floorRate > 0 ? `${(floorRate * 100).toFixed(1)}%` : '0%'} constrained
          </span>
        </div>
      </div>

      {/* Top metrics */}
      <div style={{ display: 'flex', gap: '0.2rem' }}>
        {([
          { label: 'Total', value: String(total), color: 'hsl(225 45% 60%)' },
          {
            label: 'Constrained',
            value: String(floorCount),
            color: floorCount > 0 ? 'hsl(38 92% 55%)' : 'hsl(145 65% 55%)'
          },
          {
            label: 'At Floor',
            value: String(breachCount),
            color: breachCount > 0 ? 'hsl(0 72% 55%)' : 'hsl(145 65% 55%)'
          },
          {
            label: 'Constr.Err',
            value: constrainedErrorRate > 0 ? `${(constrainedErrorRate * 100).toFixed(0)}%` : '—',
            color: errorRateColor(constrainedErrorRate)
          },
          {
            label: 'Free.Err',
            value: freeErrorRate > 0 ? `${(freeErrorRate * 100).toFixed(0)}%` : '—',
            color: errorRateColor(freeErrorRate)
          },
        ] as const).map(({ label, value, color }) => (
          <div key={label} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            background: 'hsl(225 45% 8%)', borderRadius: 3, padding: '4px 3px',
          }}>
            <span style={{ fontSize: '3px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 35%)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {label}
            </span>
            <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color, fontWeight: 700, lineHeight: 1.1 }}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Tier floor breakdown */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.08rem' }}>
        <span style={{ fontSize: '3.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 35%)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Constrained by Tier
        </span>
        {sortedTiers.length > 0 ? sortedTiers.map(([tier, tfm]) => {
          const tc = tierColor(tier)
          const constWidth = tfm.total > 0 ? (tfm.constrained / maxTierTotal) * 100 : 0
          const totalWidth = tfm.total > 0 ? (tfm.total / maxTierTotal) * 100 : 0
          const errColor = errorRateColor(tfm.errorRate)
          return (
            <div key={tier} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
                <span style={{ width: 16, fontSize: '4px', fontFamily: 'var(--font-mono)', color: tc, flexShrink: 0, fontWeight: 700 }}>
                  {tier.replace('tier', 'T')}
                </span>
                {/* Stacked bar: total vs constrained */}
                <div style={{ flex: 1, height: 5, background: 'hsl(225 45% 10%)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
                  {/* Total tier volume */}
                  <div style={{
                    position: 'absolute',
                    height: '100%',
                    width: `${totalWidth.toFixed(1)}%`,
                    background: 'hsl(225 45% 15%)',
                    borderRadius: 2,
                  }} />
                  {/* Constrained portion */}
                  {tfm.constrained > 0 && (
                    <div style={{
                      position: 'absolute',
                      height: '100%',
                      width: `${constWidth.toFixed(1)}%`,
                      background: tc,
                      borderRadius: 2,
                      boxShadow: `0 0 4px ${tc}50`,
                      opacity: 0.8,
                    }} />
                  )}
                </div>
                <span style={{ width: 14, fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 45%)', textAlign: 'right' }}>
                  {tfm.total}
                </span>
                <span style={{ width: 16, fontSize: '4px', fontFamily: 'var(--font-mono)', color: errColor, textAlign: 'right', fontWeight: 700 }}>
                  {tfm.errorRate > 0 ? `${(tfm.errorRate * 100).toFixed(0)}%` : '—'}
                </span>
              </div>
              {/* Constrained vs total */}
              {tfm.constrained > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem', paddingLeft: 16 }}>
                  <span style={{ fontSize: '3px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>└</span>
                  <span style={{ fontSize: '3px', fontFamily: 'var(--font-mono)', color: tc }}>
                    {(tfm.constrained / tfm.total * 100).toFixed(0)}% constrained
                  </span>
                  {tfm.medianLatency !== null && (
                    <span style={{ fontSize: '3px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 30%)' }}>
                      · med {tfm.medianLatency >= 1000 ? `${(tfm.medianLatency / 1000).toFixed(1)}s` : `${Math.round(tfm.medianLatency)}ms`}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        }) : (
          <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>no tier floor data</span>
        )}
      </div>

      {/* Min-allowed tier breakdown */}
      {Object.keys(minTierBreakdown).length > 0 && (
        <div style={{ display: 'flex', gap: '0.1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '3.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 35%)', alignSelf: 'center' }}>
            MinTier:
          </span>
          {Object.entries(minTierBreakdown).sort((a, b) => (TIER_RANK[a[0]] ?? 0) - (TIER_RANK[b[0]] ?? 0)).map(([minTier, mt]) => {
            const tc = tierColor(minTier)
            return (
              <span key={minTier} style={{
                fontSize: '3.5px', fontFamily: 'var(--font-mono)',
                color: tc,
                background: `${tc}15`,
                border: `1px solid ${tc}30`,
                borderRadius: 2, padding: '1px 4px',
              }}>
                min:{minTier.replace('tier', 'T')}{mt.count} {(mt.errorRate * 100).toFixed(0)}%err
              </span>
            )
          })}
        </div>
      )}

      {/* Recent breach events */}
      {recentBreaches.length > 0 && (
        <div style={{ display: 'flex', gap: '0.1rem', overflow: 'hidden' }}>
          <span style={{ fontSize: '3px', fontFamily: 'var(--font-mono)', color: 'hsl(0 72% 60%)', flexShrink: 0, alignSelf: 'center' }}>
            BREACH:
          </span>
          <div style={{ flex: 1, overflow: 'hidden', maskImage: 'linear-gradient(90deg, transparent, hsl(0 0% 0% / 0.3) 5%, transparent)' }}>
            <div style={{ display: 'flex', gap: '0.15rem' }}>
              {recentBreaches.map((b, i) => (
                <span key={i} style={{
                  fontSize: '3.5px', fontFamily: 'var(--font-mono)',
                  color: b.status >= 400 ? 'hsl(0 72% 60%)' : 'hsl(38 92% 55%)',
                  background: (b.status >= 400 ? 'hsl(0 72% 55% / 0.08)' : 'hsl(38 92% 55% / 0.08)'),
                  border: `1px solid ${b.status >= 400 ? 'hsl(0 72% 55% / 0.2)' : 'hsl(38 92% 55% / 0.2)'}`,
                  borderRadius: 2, padding: '1px 4px', flexShrink: 0,
                }}>
                  {b.requestId} {b.selectedTier.replace('tier', 'T')}=min:{b.minAllowedTier.replace('tier', 'T')}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '5px',
        color: 'var(--muted-foreground)', textAlign: 'right', opacity: 0.7,
      }}>
        {windowSize} entries · 15-min window · min_allowed_tier constraint monitoring
      </div>
    </div>
  )
}
