import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 15 * 60 * 1000
const MIN_SAMPLES = 10

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

type RecursionBucket = 'none_low' | 'medium' | 'high_veryhigh'

const BUCKET_LABELS: Record<RecursionBucket, string> = {
  none_low: 'None/Low',
  medium: 'Medium',
  high_veryhigh: 'High/VHigh',
}

const BUCKET_COLORS: Record<RecursionBucket, string> = {
  none_low: 'hsl(145 65% 55%)',
  medium: 'hsl(38 92% 55%)',
  high_veryhigh: 'hsl(0 72% 55%)',
}

function bucketForDepth(depth: string | null | undefined): RecursionBucket {
  if (!depth) return 'none_low'
  const d = depth.toLowerCase()
  if (d === 'none' || d === 'low') return 'none_low'
  if (d === 'medium') return 'medium'
  return 'high_veryhigh'
}

interface BucketStats {
  bucket: RecursionBucket
  count: number
  errorCount: number
  errorRate: number
  medianLatency: number | null
  latencies: number[]
  byTier: Record<string, number>
}

interface TopRequest {
  requestId: string
  recursionDepth: string
  multiTurnDepth: string
  tier: string
  status: number
  error: string | null
  latency: number | null
  tsMs: number
}

interface RecursionStats {
  buckets: BucketStats[]
  total: number
  windowSize: number
  highRecTierBreakdown: Array<{ tier: string; count: number; errorRate: number }>
  topRequests: TopRequest[]
  overallErrorRate: number
}

export function RecursiveDepthMonitor({ entries }: { entries: LogEntry[] }) {
  const stats = useMemo((): RecursionStats | null => {
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

    const bucketMap: Record<RecursionBucket, BucketStats> = {
      none_low: { bucket: 'none_low', count: 0, errorCount: 0, errorRate: 0, medianLatency: null, latencies: [], byTier: {} },
      medium: { bucket: 'medium', count: 0, errorCount: 0, errorRate: 0, medianLatency: null, latencies: [], byTier: {} },
      high_veryhigh: { bucket: 'high_veryhigh', count: 0, errorCount: 0, errorRate: 0, medianLatency: null, latencies: [], byTier: {} },
    }

    const highRecTierMap: Record<string, { count: number; errors: number }> = {}
    const topRequests: TopRequest[] = []
    let totalErrors = 0

    for (const { entry, tsMs } of window) {
      const depth = entry.semantic_features?.recursive_depth ?? 'none'
      const bucket = bucketForDepth(depth)
      const bs = bucketMap[bucket]
      bs.count++
      if (entry.status >= 400 || !!entry.error) {
        bs.errorCount++
        totalErrors++
      }
      if (typeof entry.latency_ms === 'number' && Number.isFinite(entry.latency_ms) && entry.latency_ms > 0) {
        bs.latencies.push(entry.latency_ms)
      }
      const tier = entry.routed_tier || 'unknown'
      bs.byTier[tier] = (bs.byTier[tier] || 0) + 1

      // Track high recursion entries for top requests
      if (bucket === 'high_veryhigh' && topRequests.length < 5) {
        topRequests.push({
          requestId: entry.request_id.slice(-6),
          recursionDepth: depth,
          multiTurnDepth: entry.semantic_features?.multi_turn_depth ?? 'none',
          tier,
          status: entry.status,
          error: typeof entry.error === 'string' ? entry.error.slice(0, 40) : null,
          latency: typeof entry.latency_ms === 'number' ? entry.latency_ms : null,
          tsMs,
        })
      }

      // High recursion tier breakdown
      if (bucket === 'high_veryhigh') {
        if (!highRecTierMap[tier]) highRecTierMap[tier] = { count: 0, errors: 0 }
        highRecTierMap[tier].count++
        if (entry.status >= 400 || !!entry.error) highRecTierMap[tier].errors++
      }
    }

    // Finalize bucket stats
    const buckets: BucketStats[] = []
    for (const b of Object.values(bucketMap)) {
      b.errorRate = b.count > 0 ? b.errorCount / b.count : 0
      const sorted = b.latencies.sort((a, c) => a - c)
      const mid = Math.floor(sorted.length / 2)
      b.medianLatency = sorted.length > 0
        ? (sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
        : null
      buckets.push(b)
    }

    // Sort buckets: high_veryhigh first, then medium, then none_low
    const bucketOrder: RecursionBucket[] = ['high_veryhigh', 'medium', 'none_low']
    buckets.sort((a, b) => bucketOrder.indexOf(a.bucket) - bucketOrder.indexOf(b.bucket))

    // High recursion tier breakdown
    const highRecTierBreakdown = Object.entries(highRecTierMap)
      .map(([tier, v]) => ({ tier, count: v.count, errorRate: v.count > 0 ? v.errors / v.count : 0 }))
      .sort((a, b) => b.count - a.count)

    return {
      buckets,
      total,
      windowSize: window.length,
      highRecTierBreakdown,
      topRequests,
      overallErrorRate: total > 0 ? totalErrors / total : 0,
    }
  }, [entries])

  if (!stats) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '991ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT RECURSION DATA
        </div>
      </div>
    )
  }

  const { buckets, total, windowSize, highRecTierBreakdown, topRequests, overallErrorRate } = stats

  const errorRateColor = (rate: number): string => {
    if (rate < 0.02) return 'hsl(145 65% 55%)'
    if (rate < 0.05) return 'hsl(38 92% 55%)'
    if (rate < 0.1) return 'hsl(25 85% 55%)'
    return 'hsl(0 72% 55%)'
  }

  const maxCount = Math.max(...buckets.map(b => b.count), 1)

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '991ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Recursive Depth
        </span>
        <div style={{ display: 'flex', gap: '0.15rem', alignItems: 'center' }}>
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: 'hsl(225 45% 60%)',
            background: 'hsl(225 45% 8%)',
            border: '1px solid hsl(225 45% 15%)',
            borderRadius: 2, padding: '2px 5px',
          }}>
            {total} total
          </span>
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: errorRateColor(overallErrorRate),
            background: `${errorRateColor(overallErrorRate)}15`,
            border: `1px solid ${errorRateColor(overallErrorRate)}30`,
            borderRadius: 2, padding: '2px 5px',
          }}>
            {(overallErrorRate * 100).toFixed(1)}% err
          </span>
        </div>
      </div>

      {/* Bucket rows — high recursion first */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
        {buckets.map(b => {
          const bc = BUCKET_COLORS[b.bucket]
          const barWidth = (b.count / maxCount) * 100
          return (
            <div key={b.bucket} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
                <span style={{
                  width: 36, fontSize: '4px', fontFamily: 'var(--font-mono)',
                  color: bc, flexShrink: 0, fontWeight: 700,
                }}>
                  {BUCKET_LABELS[b.bucket]}
                </span>
                <div style={{ flex: 1, height: 5, background: 'hsl(225 45% 10%)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${barWidth.toFixed(1)}%`,
                    background: bc,
                    borderRadius: 2,
                    boxShadow: `0 0 4px ${bc}50`,
                  }} />
                </div>
                <span style={{ width: 14, fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 45%)', textAlign: 'right' }}>
                  {b.count}
                </span>
                <span style={{
                  width: 22, fontSize: '4px', fontFamily: 'var(--font-mono)',
                  color: errorRateColor(b.errorRate), textAlign: 'right', fontWeight: 700,
                }}>
                  {(b.errorRate * 100).toFixed(0)}%
                </span>
              </div>
              {/* Median latency sub */}
              {b.medianLatency !== null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem', paddingLeft: 36 }}>
                  <span style={{ fontSize: '3px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 30%)' }}>
                    ·
                  </span>
                  <span style={{ fontSize: '3px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 40%)' }}>
                    med {b.medianLatency >= 1000 ? `${(b.medianLatency / 1000).toFixed(1)}s` : `${Math.round(b.medianLatency)}ms`}
                  </span>
                  {/* Tier breakdown mini-bar */}
                  {Object.keys(b.byTier).length > 0 && (
                    <div style={{ display: 'flex', gap: '2px', marginLeft: '2px' }}>
                      {Object.entries(b.byTier).slice(0, 3).map(([tier, cnt]) => {
                        const tierColor = tier === 'tier1' ? 'hsl(280 65% 65%)' : tier === 'tier2' ? 'hsl(185 80% 55%)' : 'hsl(145 65% 55%)'
                        return (
                          <span key={tier} style={{
                            fontSize: '2.5px', fontFamily: 'var(--font-mono)',
                            color: tierColor, fontWeight: 700,
                          }}>
                            {tier.replace('tier', 'T')}{cnt}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* High recursion tier breakdown */}
      {highRecTierBreakdown.length > 0 && (
        <div style={{ display: 'flex', gap: '0.1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '3.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 35%)', alignSelf: 'center' }}>
            High→Tier:
          </span>
          {highRecTierBreakdown.map(({ tier, count, errorRate }) => {
            return (
              <span key={tier} style={{
                fontSize: '3.5px', fontFamily: 'var(--font-mono)',
                color: errorRateColor(errorRate),
                background: `${errorRateColor(errorRate)}15`,
                border: `1px solid ${errorRateColor(errorRate)}30`,
                borderRadius: 2, padding: '1px 4px',
              }}>
                {tier.replace('tier', 'T')}{count} {(errorRate * 100).toFixed(0)}%err
              </span>
            )
          })}
        </div>
      )}

      {/* Top high-recursion requests */}
      {topRequests.length > 0 && (
        <div style={{ display: 'flex', gap: '0.1rem', overflow: 'hidden' }}>
          <span style={{ fontSize: '3px', fontFamily: 'var(--font-mono)', color: 'hsl(0 72% 60%)', flexShrink: 0, alignSelf: 'center' }}>
            HIGH↑:
          </span>
          <div style={{ flex: 1, overflow: 'hidden', maskImage: 'linear-gradient(90deg, transparent, hsl(0 0% 0% / 0.3) 5%, transparent)' }}>
            <div style={{ display: 'flex', gap: '0.15rem' }}>
              {topRequests.map((r, i) => (
                <span key={i} style={{
                  fontSize: '3.5px', fontFamily: 'var(--font-mono)',
                  color: r.status >= 400 ? 'hsl(0 72% 60%)' : 'hsl(225 45% 50%)',
                  background: (r.status >= 400 ? 'hsl(0 72% 55% / 0.08)' : 'hsl(225 45% 8%)'),
                  border: `1px solid ${r.status >= 400 ? 'hsl(0 72% 55% / 0.2)' : 'hsl(225 45% 15%)'}`,
                  borderRadius: 2, padding: '1px 4px', flexShrink: 0,
                }}>
                  {r.requestId} {r.tier.replace('tier', 'T')}
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
        {windowSize} entries · semantic_features.recursive_depth × routed_tier
      </div>
    </div>
  )
}
