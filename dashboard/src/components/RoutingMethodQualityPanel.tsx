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

const METHOD_COLORS: Record<string, string> = {
  rule: 'hsl(38 92% 55%)',
  ml: 'hsl(280 65% 65%)',
  default: 'hsl(225 45% 45%)',
}

function methodColor(method: string): string {
  return METHOD_COLORS[method.toLowerCase()] ?? 'hsl(185 80% 50%)'
}

const METHOD_LABELS: Record<string, string> = {
  rule: 'Rule-based',
  ml: 'ML Router',
  default: 'Default',
}

function methodLabel(method: string): string {
  return METHOD_LABELS[method.toLowerCase()] ?? method
}

interface MethodStats {
  method: string
  count: number
  errorCount: number
  errorRate: number
  medianLatency: number | null
  latencies: number[]
}

interface TopRule {
  rule: string
  count: number
  errorCount: number
  errorRate: number
  medianLatency: number | null
  latencies: number[]
}

interface QualityStats {
  methods: MethodStats[]
  topRules: TopRule[]
  total: number
  windowSize: number
  overallErrorRate: number
}

export function RoutingMethodQualityPanel({ entries }: { entries: LogEntry[] }) {
  const stats = useMemo((): QualityStats | null => {
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

    const methodMap: Record<string, MethodStats> = {}
    const ruleMap: Record<string, TopRule> = {}
    let totalErrors = 0

    for (const entry of logEntries) {
      const method = entry.matched_by || 'unknown'
      if (!methodMap[method]) {
        methodMap[method] = { method, count: 0, errorCount: 0, errorRate: 0, medianLatency: null, latencies: [] }
      }
      const ms = methodMap[method]
      ms.count++
      if (entry.status >= 400 || !!entry.error) {
        ms.errorCount++
        totalErrors++
      }
      if (typeof entry.latency_ms === 'number' && Number.isFinite(entry.latency_ms) && entry.latency_ms > 0) {
        ms.latencies.push(entry.latency_ms)
      }

      // Rule-level drill-down for rule-based routing
      if (method === 'rule' && entry.matched_rule) {
        const rule = entry.matched_rule
        if (!ruleMap[rule]) {
          ruleMap[rule] = { rule, count: 0, errorCount: 0, errorRate: 0, medianLatency: null, latencies: [] }
        }
        const rs = ruleMap[rule]
        rs.count++
        if (entry.status >= 400 || !!entry.error) rs.errorCount++
        if (typeof entry.latency_ms === 'number' && Number.isFinite(entry.latency_ms) && entry.latency_ms > 0) {
          rs.latencies.push(entry.latency_ms)
        }
      }
    }

    // Finalize method stats
    const allMethods: MethodStats[] = []
    for (const m of Object.values(methodMap)) {
      m.errorRate = m.count > 0 ? m.errorCount / m.count : 0
      m.medianLatency = computeMedian(m.latencies)
      allMethods.push(m)
    }

    // Finalize rule stats
    const topRules: TopRule[] = []
    for (const r of Object.values(ruleMap)) {
      r.errorRate = r.count > 0 ? r.errorCount / r.count : 0
      r.medianLatency = computeMedian(r.latencies)
      topRules.push(r)
    }

    // Sort methods by error rate ascending (best first)
    allMethods.sort((a, b) => a.errorRate - b.errorRate)
    topRules.sort((a, b) => b.count - a.count)

    return {
      methods: allMethods.slice(0, 6),
      topRules: topRules.slice(0, 8),
      total,
      windowSize: window.length,
      overallErrorRate: total > 0 ? totalErrors / total : 0,
    }
  }, [entries])

  if (!stats) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '990ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT ROUTING DATA
        </div>
      </div>
    )
  }

  const { methods, topRules, total, windowSize, overallErrorRate } = stats

  const errorRateColor = (rate: number): string => {
    if (rate < 0.02) return 'hsl(145 65% 55%)'
    if (rate < 0.05) return 'hsl(38 92% 55%)'
    if (rate < 0.1) return 'hsl(25 85% 55%)'
    return 'hsl(0 72% 55%)'
  }

  const maxCount = Math.max(...methods.map(m => m.count), 1)

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '990ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Method Quality
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

      {/* Method rows — ranked by error rate */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
        {methods.map(m => {
          const mc = methodColor(m.method)
          const barWidth = (m.count / maxCount) * 100
          return (
            <div key={m.method} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
                <span style={{
                  width: 28, fontSize: '4px', fontFamily: 'var(--font-mono)',
                  color: mc, flexShrink: 0, fontWeight: 700,
                }}>
                  {methodLabel(m.method).toUpperCase().slice(0, 4)}
                </span>
                <div style={{ flex: 1, height: 5, background: 'hsl(225 45% 10%)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${barWidth.toFixed(1)}%`,
                    background: mc,
                    borderRadius: 2,
                    boxShadow: `0 0 4px ${mc}50`,
                  }} />
                </div>
                <span style={{ width: 14, fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 45%)', textAlign: 'right' }}>
                  {m.count}
                </span>
                <span style={{
                  width: 22, fontSize: '4px', fontFamily: 'var(--font-mono)',
                  color: errorRateColor(m.errorRate), textAlign: 'right', fontWeight: 700,
                }}>
                  {(m.errorRate * 100).toFixed(0)}%
                </span>
              </div>
              {/* Median latency sub-bar */}
              {m.medianLatency !== null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem', paddingLeft: 28 }}>
                  <span style={{ fontSize: '3px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 30%)', width: 0 }}>
                    ·
                  </span>
                  <span style={{ fontSize: '3px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 40%)' }}>
                    med {m.medianLatency >= 1000 ? `${(m.medianLatency / 1000).toFixed(1)}s` : `${Math.round(m.medianLatency)}ms`}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Top rules table */}
      {topRules.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.06rem' }}>
          <span style={{ fontSize: '3.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 35%)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Top Rules
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            {topRules.map(r => (
              <div key={r.rule} style={{ display: 'flex', alignItems: 'center', gap: '0.08rem' }}>
                <span style={{
                  flex: 1, fontSize: '3.5px', fontFamily: 'var(--font-mono)',
                  color: 'hsl(38 92% 55%)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {r.rule}
                </span>
                <span style={{ fontSize: '3.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 40%)', width: 12, textAlign: 'right' }}>
                  {r.count}
                </span>
                <span style={{
                  fontSize: '3.5px', fontFamily: 'var(--font-mono)',
                  color: errorRateColor(r.errorRate), width: 18, textAlign: 'right', fontWeight: 700,
                }}>
                  {(r.errorRate * 100).toFixed(0)}%err
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '5px',
        color: 'var(--muted-foreground)', textAlign: 'right', opacity: 0.7,
      }}>
        {windowSize} entries · 15-min window · matched_by × status × latency_ms
      </div>
    </div>
  )
}
