import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 15 * 60 * 1000
const MIN_SAMPLES = 10

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

const DIFFICULTIES = ['low', 'medium', 'high'] as const
type Difficulty = typeof DIFFICULTIES[number]

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  low: 'Low',
  medium: 'Med',
  high: 'High',
}

const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  low: 'hsl(145 65% 55%)',
  medium: 'hsl(38 92% 55%)',
  high: 'hsl(0 72% 55%)',
}

const TIER_LABELS: Record<string, string> = {
  tier1: 'Frontier',
  tier2: 'Workhorse',
  tier3: 'Routine',
}

const TIER_COLORS: Record<string, string> = {
  tier1: 'hsl(280 65% 65%)',
  tier2: 'hsl(185 80% 55%)',
  tier3: 'hsl(145 65% 55%)',
}

interface CellData {
  difficulty: Difficulty
  tier: string
  count: number
  errorCount: number
  errorRate: number
  avgLatency: number | null
  totalLatency: number
  latencyCount: number
}

interface HeatmapStats {
  grid: Record<string, CellData>
  total: number
  windowSize: number
  maxCount: number
  overallErrorRate: number
}

export function DifficultyHeatmapPanel({ entries }: { entries: LogEntry[] }) {
  const stats = useMemo((): HeatmapStats | null => {
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

    // Initialize 3x3 grid
    const grid: Record<string, CellData> = {}
    for (const diff of DIFFICULTIES) {
      for (const tier of ['tier1', 'tier2', 'tier3']) {
        grid[`${diff}|${tier}`] = {
          difficulty: diff,
          tier,
          count: 0,
          errorCount: 0,
          errorRate: 0,
          avgLatency: null,
          totalLatency: 0,
          latencyCount: 0,
        }
      }
    }

    let totalErrors = 0
    for (const entry of logEntries) {
      const diff = (entry.semantic_features?.difficulty ?? 'medium') as Difficulty
      const normalizedDiff = DIFFICULTIES.includes(diff) ? diff : 'medium'
      const tier = entry.routed_tier || 'unknown'

      const key = `${normalizedDiff}|${tier}`
      const cell = grid[key]
      if (!cell) continue

      cell.count++
      if (entry.status >= 400 || !!entry.error) {
        cell.errorCount++
        totalErrors++
      }
      if (typeof entry.latency_ms === 'number' && Number.isFinite(entry.latency_ms) && entry.latency_ms > 0) {
        cell.totalLatency += entry.latency_ms
        cell.latencyCount++
      }
    }

    // Compute error rates and avg latencies
    const maxCount = Math.max(...Object.values(grid).map(c => c.count), 1)
    for (const cell of Object.values(grid)) {
      cell.errorRate = cell.count > 0 ? cell.errorCount / cell.count : 0
      cell.avgLatency = cell.latencyCount > 0 ? cell.totalLatency / cell.latencyCount : null
    }

    return {
      grid,
      total,
      windowSize: window.length,
      maxCount,
      overallErrorRate: total > 0 ? totalErrors / total : 0,
    }
  }, [entries])

  if (!stats) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '988ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT DIFFICULTY DATA
        </div>
      </div>
    )
  }

  const { grid: gridMap, total, windowSize, maxCount, overallErrorRate } = stats

  // Build 3x3 grid — access grid map directly, no find() fallback needed
  const grid = DIFFICULTIES.map(diff =>
    ['tier1', 'tier2', 'tier3'].map(tier => gridMap[`${diff}|${tier}`])
  )

  const errorRateColor = (rate: number): string => {
    if (rate < 0.02) return 'hsl(145 65% 55%)'
    if (rate < 0.05) return 'hsl(38 92% 55%)'
    if (rate < 0.1) return 'hsl(25 85% 55%)'
    return 'hsl(0 72% 55%)'
  }

  const cellIntensity = (count: number): number => {
    return maxCount > 0 ? Math.max(count / maxCount, 0.05) : 0.05
  }

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '988ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Difficulty × Tier Heatmap
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

      {/* Column headers */}
      <div style={{ display: 'flex', gap: '0.1rem' }}>
        <div style={{ width: 28, flexShrink: 0 }} />
        {(['tier1', 'tier2', 'tier3'] as const).map(tier => (
          <div key={tier} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          }}>
            <span style={{ fontSize: '3.5px', fontFamily: 'var(--font-mono)', color: TIER_COLORS[tier], fontWeight: 700 }}>
              {TIER_LABELS[tier]}
            </span>
          </div>
        ))}
      </div>

      {/* Grid rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
        {grid.map((row, rowIdx) => {
          const diff = DIFFICULTIES[rowIdx]
          return (
            <div key={diff} style={{ display: 'flex', gap: '0.1rem', alignItems: 'center' }}>
              {/* Row label */}
              <div style={{
                width: 28, flexShrink: 0,
                fontSize: '3.5px', fontFamily: 'var(--font-mono)',
                color: DIFFICULTY_COLORS[diff], fontWeight: 700,
                textAlign: 'right', paddingRight: '3px',
              }}>
                {DIFFICULTY_LABELS[diff]}
              </div>

              {/* Cells */}
              {row.map((cell, colIdx) => {
                const intensity = cellIntensity(cell.count)
                const errColor = errorRateColor(cell.errorRate)
                const tierKey = ['tier1', 'tier2', 'tier3'][colIdx]
                const tierCol = TIER_COLORS[tierKey]

                return (
                  <div key={`${diff}|${tierKey}`} style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: `hsl(225 45% 6%)`,
                    border: `1px solid ${tierCol} / ${(intensity * 0.4).toFixed(2)}`,
                    borderRadius: 3,
                    padding: '3px 2px',
                    minHeight: 38,
                    position: 'relative',
                    overflow: 'hidden',
                  }}>
                    {/* Background glow proportional to count */}
                    {cell.count > 0 && (
                      <div style={{
                        position: 'absolute',
                        inset: 0,
                        background: `radial-gradient(ellipse at center, ${tierCol} / ${(intensity * 0.25).toFixed(2)} 0%, transparent 70%)`,
                        pointerEvents: 'none',
                      }} />
                    )}

                    {/* Count */}
                    <span style={{
                      fontSize: '9px', fontFamily: 'var(--font-mono)',
                      color: cell.count > 0 ? tierCol : 'hsl(225 45% 20%)',
                      fontWeight: 700, lineHeight: 1,
                      position: 'relative',
                    }}>
                      {cell.count > 0 ? cell.count : '—'}
                    </span>

                    {/* Error rate badge */}
                    {cell.count > 0 && (
                      <span style={{
                        fontSize: '3.5px', fontFamily: 'var(--font-mono)',
                        color: errColor,
                        position: 'relative',
                        marginTop: '1px',
                      }}>
                        {(cell.errorRate * 100).toFixed(0)}% err
                      </span>
                    )}

                    {/* Avg latency */}
                    {cell.count > 0 && cell.avgLatency !== null && (
                      <span style={{
                        fontSize: '3px', fontFamily: 'var(--font-mono)',
                        color: 'hsl(225 45% 40%)',
                        position: 'relative',
                        marginTop: '1px',
                      }}>
                        {cell.avgLatency >= 1000 ? `${(cell.avgLatency / 1000).toFixed(1)}s` : `${Math.round(cell.avgLatency)}ms`}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '3.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 30%)' }}>err:</span>
        {([
          { label: '<2%', color: 'hsl(145 65% 55%)' },
          { label: '2-5%', color: 'hsl(38 92% 55%)' },
          { label: '5-10%', color: 'hsl(25 85% 55%)' },
          { label: '>10%', color: 'hsl(0 72% 55%)' },
        ] as const).map(({ label, color }) => (
          <span key={label} style={{
            fontSize: '3.5px', fontFamily: 'var(--font-mono)', color,
            display: 'flex', alignItems: 'center', gap: '2px',
          }}>
            <span style={{ width: 5, height: 3, background: color, borderRadius: 1, display: 'inline-block' }} />
            {label}
          </span>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '5px',
        color: 'var(--muted-foreground)', textAlign: 'right', opacity: 0.7,
      }}>
        {windowSize} entries · 15-min window · semantic_features.difficulty × routed_tier
      </div>
    </div>
  )
}
