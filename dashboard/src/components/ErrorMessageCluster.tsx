import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 15 * 60 * 1000
const MIN_SAMPLES = 10
const MAX_CLUSTERS = 10

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

// Normalize error string to cluster signature
function normalizeError(err: string): string {
  if (!err) return '__null__'
  return err
    .toLowerCase()
    // Collapse multiple spaces/hyphens
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim()
    // Strip standalone port numbers like :8080
    .replace(/:\d+\b/g, '')
    // Strip bare IP-like numbers (multi-octet sequences, but preserve model names with hyphens)
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '')
    // Strip standalone large numbers (request IDs, trace IDs)
    .replace(/\b\d{8,}\b/g, '')
    // Strip UUID-like strings
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    // Collapse remaining spaces
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/\s/g, ' ')
    .trim()
    .slice(0, 80)
}

type Severity = 'CRITICAL' | 'WARNING' | 'MINOR'

function severityFromStatus(status: number | undefined): Severity {
  if (!status) return 'MINOR'
  if (status >= 500) return 'CRITICAL'
  if (status === 429 || status >= 400) return 'WARNING'
  return 'MINOR'
}

function severityColor(s: Severity): string {
  if (s === 'CRITICAL') return 'hsl(0 72% 55%)'
  if (s === 'WARNING') return 'hsl(38 92% 55%)'
  return 'hsl(145 65% 55%)'
}

interface Cluster {
  signature: string
  raw: string
  count: number
  pct: number
  severity: Severity
  topModel: string
  modelCounts: Record<string, number>
  topTier: string
  tierCounts: Record<string, number>
}

export function ErrorMessageCluster({ entries }: { entries: LogEntry[] }) {
  const stats = useMemo((): {
    clusters: Cluster[]
    totalErrors: number
    windowSize: number
  } | null => {
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

    // Collect only entries with errors
    const errorEntries = logEntries.filter(e => !!e.error || e.status >= 400)
    if (errorEntries.length < 3) return null

    // Cluster map
    const clusterMap = new Map<string, {
      raw: string
      count: number
      modelCounts: Record<string, number>
      tierCounts: Record<string, number>
      severityCount: Record<Severity, number>
    }>()

    for (const e of errorEntries) {
      const raw = e.error || `HTTP ${e.status}`
      const sig = normalizeError(raw)
      if (!clusterMap.has(sig)) {
        clusterMap.set(sig, {
          raw,
          count: 0,
          modelCounts: {},
          tierCounts: {},
          severityCount: { CRITICAL: 0, WARNING: 0, MINOR: 0 },
        })
      }
      const cl = clusterMap.get(sig)!
      cl.count++
      const model = e.routed_model || 'unknown'
      cl.modelCounts[model] = (cl.modelCounts[model] || 0) + 1
      const tier = e.routed_tier || 'unknown'
      cl.tierCounts[tier] = (cl.tierCounts[tier] || 0) + 1
      const sev = severityFromStatus(e.status)
      cl.severityCount[sev]++
    }

    const totalErrors = errorEntries.length

    const clusters: Cluster[] = [...clusterMap.entries()]
      .map(([sig, cl]) => {
        const topModel = Object.entries(cl.modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown'
        const topTier = Object.entries(cl.tierCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown'
        // Dominant severity: highest count
        const dominantSeverity = (Object.entries(cl.severityCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'MINOR') as Severity
        return {
          signature: sig,
          raw: cl.raw,
          count: cl.count,
          pct: cl.count / totalErrors,
          severity: dominantSeverity,
          topModel,
          modelCounts: cl.modelCounts,
          topTier,
          tierCounts: cl.tierCounts,
        }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_CLUSTERS)

    return { clusters, totalErrors, windowSize: window.length }
  }, [entries])

  if (!stats) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '981ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT ERROR DATA
        </div>
      </div>
    )
  }

  const { clusters, totalErrors, windowSize } = stats

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '981ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Error Clusters
        </span>
        <div style={{ display: 'flex', gap: '0.15rem' }}>
          {([
            { label: totalErrors, color: 'hsl(0 72% 55%)' },
          ] as const).map(({ label, color }) => (
            <span key="total" style={{
              fontSize: '5px', fontFamily: 'var(--font-mono)',
              color, background: `${color}15`,
              border: `1px solid ${color}30`,
              borderRadius: 2, padding: '2px 5px',
            }}>
              {label} errors
            </span>
          ))}
        </div>
      </div>

      {/* Column headers */}
      <div style={{ display: 'flex', gap: '0.06rem', padding: '0.04rem 0.08rem', borderBottom: '1px solid hsl(225 45% 12%)' }}>
        {['SIG', 'N', '%', 'SEV', 'TOP MODEL', 'TIER'].map((h, i) => (
          <span key={h} style={{
            fontSize: '3.5px', fontFamily: 'var(--font-mono)',
            color: 'hsl(145 65% 40%)', letterSpacing: '0.04em',
            flex: i === 0 ? 3 : 1,
            textAlign: i === 2 ? 'right' : 'left',
          }}>{h}</span>
        ))}
      </div>

      {/* Cluster rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.04rem' }}>
        {clusters.map((cl, idx) => {
          const sc = severityColor(cl.severity)
          return (
            <div key={cl.signature} style={{
              display: 'flex', gap: '0.06rem', padding: '0.05rem 0.08rem',
              borderRadius: 2, alignItems: 'center',
              background: cl.severity === 'CRITICAL' ? 'hsl(0 72% 55% / 0.08)'
                : cl.severity === 'WARNING' ? 'hsl(38 92% 55% / 0.06)'
                : 'transparent',
            }}>
              {/* Rank */}
              <span style={{
                width: 8, fontSize: '4px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 25%)', textAlign: 'center', flexShrink: 0,
              }}>
                {idx + 1}
              </span>
              {/* Signature */}
              <span style={{
                flex: 3, fontSize: '4.5px', fontFamily: 'var(--font-mono)',
                color: sc, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
                title={cl.raw}
              >
                {cl.signature || '(empty)'}
              </span>
              {/* Count */}
              <span style={{
                flex: 1, fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: 'var(--foreground)', textAlign: 'center', fontWeight: 700,
              }}>
                {cl.count}
              </span>
              {/* Pct */}
              <span style={{
                flex: 1, fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 50%)', textAlign: 'right',
              }}>
                {(cl.pct * 100).toFixed(0)}%
              </span>
              {/* Severity */}
              <span style={{
                flex: 1, fontSize: '4px', fontFamily: 'var(--font-mono)',
                color: sc, fontWeight: 700, textAlign: 'center',
              }}>
                {cl.severity}
              </span>
              {/* Top model */}
              <span style={{
                flex: 1, fontSize: '4px', fontFamily: 'var(--font-mono)',
                color: 'hsl(185 80% 55%)', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {cl.topModel.replace('together-ai/', '').replace('openrouter/', '').slice(0, 8)}
              </span>
              {/* Top tier */}
              <span style={{
                flex: 1, fontSize: '4px', fontFamily: 'var(--font-mono)',
                color: cl.topTier === 'tier1' ? 'hsl(280 65% 65%)'
                  : cl.topTier === 'tier2' ? 'hsl(200 75% 55%)'
                  : 'hsl(145 65% 55%)',
                textAlign: 'center', fontWeight: 700,
              }}>
                {cl.topTier.replace('tier', 'T')}
              </span>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '5px',
        color: 'var(--muted-foreground)', textAlign: 'right', opacity: 0.7,
      }}>
        {windowSize} entries · top {clusters.length} clusters · stripped: IPs, ports, UUIDs, IDs
      </div>
    </div>
  )
}
