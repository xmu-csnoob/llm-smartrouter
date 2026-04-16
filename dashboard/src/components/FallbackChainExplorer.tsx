import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 15 * 60 * 1000
const MIN_SAMPLES = 10

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

interface FallbackStats {
  total: number
  windowSize: number
  fallbackCount: number
  fallbackRate: number
  degradationPaths: Record<string, number>  // "tier1→tier2" → count
  errorCounts: Record<string, number>
  modelFallbackCounts: Record<string, number>
  avgLatency: number | null
  avgFallbackLatency: number | null
  chainDepths: Record<number, number>  // chain length → count
  recentFallbacks: Array<{
    tsMs: number
    requestId: string
    fromTier: string
    toTier: string
    chainLength: number
    error: string | null
    latency: number | null
  }>
}

export function FallbackChainExplorer({ entries }: { entries: LogEntry[] }) {
  const stats = useMemo((): FallbackStats | null => {
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

    let fallbackCount = 0
    const degradationPaths: Record<string, number> = {}
    const errorCounts: Record<string, number> = {}
    const modelFallbackCounts: Record<string, number> = {}
    let latencySum = 0
    let latencyFallbackSum = 0
    let latencyFallbackCount = 0
    const chainDepths: Record<number, number> = {}

    const recentFallbacks: FallbackStats['recentFallbacks'] = []

    for (const { entry, tsMs } of window) {
      const isFallback = entry.is_fallback || !!entry.degraded_to_tier || (entry.fallback_chain && entry.fallback_chain.length > 0)

      if (typeof entry.latency_ms === 'number' && Number.isFinite(entry.latency_ms) && entry.latency_ms > 0) {
        latencySum += entry.latency_ms
      }

      if (isFallback) {
        fallbackCount++
        const chain = entry.fallback_chain ?? []
        const chainLen = chain.length

        chainDepths[chainLen] = (chainDepths[chainLen] || 0) + 1

        const fromTier = entry.selected_tier || 'unknown'
        const toTier = entry.degraded_to_tier || (chain[0]?.tier) || fromTier

        // Only count as degradation if moving to a numerically higher tier (tier1→tier3 = degradation)
        const TIER_RANK: Record<string, number> = { tier1: 1, tier2: 2, tier3: 3 }
        const fromRank = TIER_RANK[fromTier] ?? 0
        const toRank = TIER_RANK[toTier] ?? 0
        if (toRank > fromRank) {
          degradationPaths[`${fromTier}→${toTier}`] = (degradationPaths[`${fromTier}→${toTier}`] || 0) + 1
        }

        const primaryError = chain[0]?.error || entry.error
        if (primaryError && typeof primaryError === 'string') {
          // Normalize error: truncate to 60 chars
          const normalized = primaryError.length > 60 ? primaryError.slice(0, 60) + '…' : primaryError
          errorCounts[normalized] = (errorCounts[normalized] || 0) + 1
        }

        // Track the model that triggered the fallback (first in chain), not the final routed model
        const failedModel = chain[0]?.model || entry.routed_model
        if (failedModel) {
          modelFallbackCounts[failedModel] = (modelFallbackCounts[failedModel] || 0) + 1
        }

        if (typeof entry.latency_ms === 'number' && Number.isFinite(entry.latency_ms)) {
          latencyFallbackSum += entry.latency_ms
          latencyFallbackCount++
        }

        if (recentFallbacks.length < 6) {
          recentFallbacks.push({
            tsMs,
            requestId: entry.request_id.slice(-6),
            fromTier,
            toTier,
            chainLength: chainLen,
            error: typeof entry.error === 'string' ? entry.error.slice(0, 40) : null,
            latency: typeof entry.latency_ms === 'number' ? entry.latency_ms : null,
          })
        }
      }
    }

    const avgLatency = total > 0 ? latencySum / total : null
    const avgFallbackLatency = latencyFallbackCount > 0 ? latencyFallbackSum / latencyFallbackCount : null

    return {
      total,
      windowSize: window.length,
      fallbackCount,
      fallbackRate: total > 0 ? fallbackCount / total : 0,
      degradationPaths,
      errorCounts,
      modelFallbackCounts,
      avgLatency,
      avgFallbackLatency,
      chainDepths,
      recentFallbacks,
    }
  }, [entries])

  if (!stats) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '987ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT FALLBACK DATA
        </div>
      </div>
    )
  }

  const { total, fallbackCount, fallbackRate, degradationPaths, errorCounts, modelFallbackCounts, avgLatency, avgFallbackLatency, chainDepths, recentFallbacks } = stats

  const tierColor = (tier: string) =>
    tier === 'tier1' ? 'hsl(280 65% 65%)'
    : tier === 'tier2' ? 'hsl(185 80% 55%)'
    : tier === 'tier3' ? 'hsl(145 65% 55%)'
    : 'hsl(225 45% 40%)'

  const pathColor = (path: string): string => {
    const parts = path.split('→')
    return parts[0] === parts[1] ? 'hsl(0 72% 55%)' : 'hsl(38 92% 55%)'
  }

  const topPaths = Object.entries(degradationPaths).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const topErrors = Object.entries(errorCounts).sort((a, b) => b[1] - a[1]).slice(0, 4)
  const topModels = Object.entries(modelFallbackCounts).sort((a, b) => b[1] - a[1]).slice(0, 4)
  const maxDepth = Math.max(...Object.keys(chainDepths).map(Number), 1)

  const fallbackRateColor = fallbackRate > 0.1 ? 'hsl(0 72% 55%)'
    : fallbackRate > 0.03 ? 'hsl(38 92% 55%)'
    : 'hsl(145 65% 55%)'

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '987ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Fallback Chain Explorer
        </span>
        <div style={{ display: 'flex', gap: '0.15rem', alignItems: 'center' }}>
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: fallbackRateColor,
            background: `${fallbackRateColor}15`,
            border: `1px solid ${fallbackRateColor}30`,
            borderRadius: 2, padding: '2px 5px',
            fontWeight: 700,
          }}>
            {fallbackRate > 0 ? `${(fallbackRate * 100).toFixed(1)}%` : '0%'} fallback
          </span>
        </div>
      </div>

      {/* Top metrics */}
      <div style={{ display: 'flex', gap: '0.2rem' }}>
        {([
          { label: 'Total', value: String(total), color: 'hsl(225 45% 60%)' },
          { label: 'Fallbacks', value: String(fallbackCount), color: fallbackCount > 0 ? 'hsl(0 72% 55%)' : 'hsl(145 65% 55%)' },
          {
            label: 'Avg Lat',
            value: avgLatency !== null ? (avgLatency >= 1000 ? `${(avgLatency / 1000).toFixed(1)}s` : `${Math.round(avgLatency)}ms`) : '—',
            color: 'hsl(225 45% 60%)'
          },
          {
            label: 'Fb Lat',
            value: avgFallbackLatency !== null ? (avgFallbackLatency >= 1000 ? `${(avgFallbackLatency / 1000).toFixed(1)}s` : `${Math.round(avgFallbackLatency)}ms`) : '—',
            color: 'hsl(38 92% 55%)'
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

      {/* Two-column layout */}
      <div style={{ display: 'flex', gap: '0.2rem' }}>
        {/* Left: degradation paths */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.08rem' }}>
          <span style={{ fontSize: '3.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 35%)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Degradation Paths
          </span>
          {topPaths.length > 0 ? topPaths.map(([path, count]) => {
            const pct = fallbackCount > 0 ? count / fallbackCount : 0
            const [from, to] = path.split('→')
            return (
              <div key={path} style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
                <span style={{ width: 14, fontSize: '3.5px', fontFamily: 'var(--font-mono)', color: tierColor(from), flexShrink: 0 }}>
                  {from.replace('tier', 'T')}
                </span>
                <span style={{ fontSize: '3.5px', color: 'hsl(225 45% 30%)' }}>→</span>
                <span style={{ width: 14, fontSize: '3.5px', fontFamily: 'var(--font-mono)', color: tierColor(to), flexShrink: 0 }}>
                  {to.replace('tier', 'T')}
                </span>
                <div style={{ flex: 1, height: 4, background: 'hsl(225 45% 10%)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${(pct * 100).toFixed(1)}%`,
                    background: pathColor(path),
                    borderRadius: 2,
                    boxShadow: `0 0 3px ${pathColor(path)}40`,
                  }} />
                </div>
                <span style={{ width: 14, fontSize: '3px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 40%)', textAlign: 'right' }}>
                  {count}
                </span>
              </div>
            )
          }) : (
            <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>no degradation events</span>
          )}
        </div>

        {/* Right: chain depth distribution */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.08rem' }}>
          <span style={{ fontSize: '3.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 35%)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Chain Depth
          </span>
          {Object.keys(chainDepths).length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '28px' }}>
              {Array.from({ length: maxDepth }, (_, i) => {
                const depth = i + 1
                const count = chainDepths[depth] || 0
                const pct = Math.max(...Object.values(chainDepths)) > 0 ? count / Math.max(...Object.values(chainDepths)) : 0
                const depthColor = depth === 1 ? 'hsl(145 65% 55%)' : depth === 2 ? 'hsl(38 92% 55%)' : 'hsl(0 72% 55%)'
                return (
                  <div key={depth} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px', height: '100%', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: '2.5px', fontFamily: 'var(--font-mono)', color: depthColor }}>
                      {count}
                    </span>
                    <div style={{
                      width: '100%',
                      height: `${Math.max(pct * 20, 3)}px`,
                      background: depthColor,
                      borderRadius: '1px 1px 0 0',
                      opacity: 0.7,
                      boxShadow: count > 0 ? `0 0 3px ${depthColor}40` : 'none',
                    }} />
                    <span style={{ fontSize: '2.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 30%)' }}>
                      {depth}d
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>no chain data</span>
          )}
        </div>
      </div>

      {/* Model fallback counts */}
      {topModels.length > 0 && (
        <div style={{ display: 'flex', gap: '0.1rem', flexWrap: 'wrap' }}>
          {topModels.map(([model, count]) => (
            <span key={model} style={{
              fontSize: '3.5px', fontFamily: 'var(--font-mono)',
              color: 'hsl(200 75% 55%)',
              background: 'hsl(200 75% 55% / 0.08)',
              border: '1px solid hsl(200 75% 55% / 0.2)',
              borderRadius: 2, padding: '1px 4px',
            }}>
              {model} {count}
            </span>
          ))}
        </div>
      )}

      {/* Error reasons */}
      {topErrors.length > 0 && (
        <div style={{ display: 'flex', gap: '0.1rem', flexWrap: 'wrap' }}>
          {topErrors.map(([error, count]) => (
            <span key={error} style={{
              fontSize: '3.5px', fontFamily: 'var(--font-mono)',
              color: 'hsl(0 72% 60%)',
              background: 'hsl(0 72% 55% / 0.08)',
              border: '1px solid hsl(0 72% 55% / 0.2)',
              borderRadius: 2, padding: '1px 4px',
            }}>
              {error} {count}
            </span>
          ))}
        </div>
      )}

      {/* Recent fallback events */}
      {recentFallbacks.length > 0 && (
        <div style={{ display: 'flex', gap: '0.1rem', overflow: 'hidden' }}>
          <span style={{ fontSize: '3px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 30%)', flexShrink: 0, alignSelf: 'center' }}>
            RECENT:
          </span>
          <div style={{ flex: 1, overflow: 'hidden', maskImage: 'linear-gradient(90deg, transparent, hsl(0 0% 0% / 0.3) 5%, transparent)' }}>
            <div style={{ display: 'flex', gap: '0.15rem' }}>
              {recentFallbacks.map((fb, i) => (
                <span key={i} style={{
                  fontSize: '3.5px', fontFamily: 'var(--font-mono)',
                  color: 'hsl(0 72% 60%)',
                  background: 'hsl(0 72% 55% / 0.08)',
                  border: '1px solid hsl(0 72% 55% / 0.2)',
                  borderRadius: 2, padding: '1px 4px', flexShrink: 0,
                }}>
                  {fb.fromTier.replace('tier', 'T')}→{fb.toTier.replace('tier', 'T')} {fb.chainLength > 0 ? `[${fb.chainLength}d]` : ''}
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
        {stats.windowSize} entries · 15-min window · is_fallback + degraded_to_tier + fallback_chain
      </div>
    </div>
  )
}
