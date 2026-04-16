import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 15 * 60 * 1000
const MIN_SAMPLES = 20

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

const DIFFICULTY_LEVELS = ['simple', 'moderate', 'complex', 'unknown'] as const
type DifficultyLevel = typeof DIFFICULTY_LEVELS[number]

const INTENT_ORDER = [
  'debug', 'design', 'implementation', 'review',
  'explain', 'generation', 'reasoning', 'general',
] as const
type Intent = typeof INTENT_ORDER[number]

const DIFFICULTY_META: Record<DifficultyLevel, { color: string; label: string }> = {
  simple:   { color: 'hsl(145 65% 55%)', label: 'Simp' },
  moderate: { color: 'hsl(38 92% 55%)',  label: 'Mod' },
  complex:  { color: 'hsl(0 72% 55%)',   label: 'Cplx' },
  unknown:  { color: 'hsl(225 45% 35%)', label: 'Unkn' },
}

const INTENT_META: Record<string, { color: string; label: string }> = {
  debug:          { color: 'hsl(280 65% 65%)', label: 'Debug' },
  design:         { color: 'hsl(185 80% 55%)', label: 'Design' },
  implementation: { color: 'hsl(38 92% 55%)',  label: 'Impl' },
  review:         { color: 'hsl(200 75% 55%)', label: 'Review' },
  explain:        { color: 'hsl(25 95% 60%)',  label: 'Explain' },
  generation:     { color: 'hsl(145 65% 55%)', label: 'Gen' },
  reasoning:      { color: 'hsl(280 65% 60%)', label: 'Reason' },
  general:        { color: 'hsl(225 45% 50%)', label: 'General' },
}

function getIntent(e: LogEntry): string {
  if (e.semantic_features?.intent) return e.semantic_features.intent.toLowerCase()
  if (e.task_type) return e.task_type.toLowerCase()
  return 'general'
}

function getDifficulty(e: LogEntry): DifficultyLevel {
  const d = e.semantic_features?.difficulty?.toLowerCase()
  if (d === 'simple') return 'simple'
  if (d === 'moderate') return 'moderate'
  if (d === 'complex') return 'complex'
  return 'unknown'
}

interface Cell {
  intent: string
  difficulty: DifficultyLevel
  count: number
  tierBreakdown: Record<string, number>
}

interface JointStats {
  matrix: Cell[]
  rowTotals: Record<string, number>
  colTotals: Record<DifficultyLevel, number>
  grandTotal: number
  intents: string[]
  difficulties: DifficultyLevel[]
  windowSize: number
}

export function IntentDifficultyCorrelationMatrix({ entries }: { entries: LogEntry[] }) {
  const stats = useMemo((): JointStats | null => {
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

    // Build co-occurrence map
    const matrixMap = new Map<string, Cell>()
    const rowTotals: Record<string, number> = {}
    const colTotals: Record<DifficultyLevel, number> = { simple: 0, moderate: 0, complex: 0, unknown: 0 }
    let grandTotal = 0

    for (const e of logEntries) {
      const intent = getIntent(e)
      const difficulty = getDifficulty(e)
      const key = `${intent}|${difficulty}`

      if (!matrixMap.has(key)) {
        matrixMap.set(key, { intent, difficulty, count: 0, tierBreakdown: {} })
      }
      const cell = matrixMap.get(key)!
      cell.count++

      const tier = e.routed_tier || 'unknown'
      cell.tierBreakdown[tier] = (cell.tierBreakdown[tier] || 0) + 1

      rowTotals[intent] = (rowTotals[intent] || 0) + 1
      colTotals[difficulty]++
      grandTotal++
    }

    // Collect all intents present in data
    const intents = [...new Set([...Object.keys(rowTotals)])].sort(
      (a, b) => {
        const ai = INTENT_ORDER.indexOf(a as Intent)
        const bi = INTENT_ORDER.indexOf(b as Intent)
        const ar = ai === -1 ? 99 : ai
        const br = bi === -1 ? 99 : bi
        return ar - br
      }
    )

    const difficulties = DIFFICULTY_LEVELS.filter(d => colTotals[d] > 0)

    const matrix = intents.flatMap(intent =>
      difficulties.map(difficulty => {
        const key = `${intent}|${difficulty}`
        return matrixMap.get(key) || { intent, difficulty, count: 0, tierBreakdown: {} }
      })
    )

    return { matrix, rowTotals, colTotals, grandTotal, intents, difficulties, windowSize: window.length }
  }, [entries])

  if (!stats) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '975ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT INTENT/DIFFICULTY DATA
        </div>
      </div>
    )
  }

  const { matrix, rowTotals, colTotals, grandTotal, intents, difficulties, windowSize } = stats

  const CELL_W = 32
  const CELL_H = 20
  const GAP = 2
  const LABEL_W = 36
  const HEADER_H = 14
  const svgW = LABEL_W + difficulties.length * (CELL_W + GAP) + GAP + 4
  const svgH = HEADER_H + intents.length * (CELL_H + GAP) + GAP + 4

  const cellX = (ci: number) => LABEL_W + GAP + ci * (CELL_W + GAP)
  const cellY = (ri: number) => HEADER_H + GAP + ri * (CELL_H + GAP)

  const toColor = (count: number): string => {
    if (count === 0) return 'hsl(225 45% 8%)'
    const maxCount = Math.max(...matrix.map(c => c.count), 1)
    const intensity = count / maxCount
    if (intensity < 0.25) return 'hsl(145 65% 20%)'
    if (intensity < 0.5) return 'hsl(145 65% 32%)'
    if (intensity < 0.75) return 'hsl(38 92% 40%)'
    return 'hsl(38 92% 55%)'
  }

  const dominantTier = (breakdown: Record<string, number>): string => {
    const entries = Object.entries(breakdown)
    if (entries.length === 0) return '—'
    entries.sort((a, b) => b[1] - a[1])
    return entries[0][0].replace('tier', 'T')
  }

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '975ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Intent × Difficulty Matrix
        </span>
        <span style={{
          fontSize: '5px', fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)',
          background: 'hsl(225 45% 8%)',
          border: '1px solid hsl(225 45% 15%)',
          borderRadius: 2, padding: '2px 5px',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          n={grandTotal}
        </span>
      </div>

      {/* Legend row */}
      <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'center' }}>
        {difficulties.map(d => {
          const meta = DIFFICULTY_META[d]
          return (
            <div key={d} style={{ display: 'flex', alignItems: 'center', gap: '0.08rem' }}>
              <div style={{ width: 5, height: 5, borderRadius: 1, background: meta.color }} />
              <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: meta.color, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                {meta.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Matrix SVG */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <svg width={svgW} height={svgH} style={{ overflow: 'visible' }}>
          {/* Column headers */}
          {difficulties.map((d, ci) => {
            const meta = DIFFICULTY_META[d]
            return (
              <g key={`ch-${d}`}>
                <text
                  x={cellX(ci) + CELL_W / 2}
                  y={HEADER_H - 2}
                  fontSize="4.5"
                  fill={meta.color}
                  fontFamily="var(--font-mono)"
                  textAnchor="middle"
                  dominantBaseline="auto"
                >
                  {meta.label}
                </text>
                <text
                  x={cellX(ci) + CELL_W / 2}
                  y={HEADER_H + 5}
                  fontSize="3.5"
                  fill="hsl(225 45% 25%)"
                  fontFamily="var(--font-mono)"
                  textAnchor="middle"
                  dominantBaseline="auto"
                >
                  {colTotals[d]}
                </text>
              </g>
            )
          })}

          {/* Row headers + cells */}
          {intents.map((intent, ri) => {
            const im = INTENT_META[intent] || { color: 'hsl(225 45% 50%)', label: intent }
            return (
              <g key={`row-${intent}`}>
                {/* Row label */}
                <text
                  x={LABEL_W - 2}
                  y={cellY(ri) + CELL_H / 2 + 1}
                  fontSize="4.5"
                  fill={im.color}
                  fontFamily="var(--font-mono)"
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {im.label}
                </text>
                <text
                  x={LABEL_W - 2}
                  y={cellY(ri) + CELL_H / 2 + 6}
                  fontSize="3.5"
                  fill="hsl(225 45% 25%)"
                  fontFamily="var(--font-mono)"
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {rowTotals[intent]}
                </text>

                {/* Cells */}
                {difficulties.map((difficulty, ci) => {
                  const cell = matrix.find(c => c.intent === intent && c.difficulty === difficulty)
                  const count = cell?.count ?? 0
                  const breakdown = cell?.tierBreakdown ?? {}
                  return (
                    <g key={`${intent}-${difficulty}`}>
                      <rect
                        x={cellX(ci)}
                        y={cellY(ri)}
                        width={CELL_W}
                        height={CELL_H}
                        rx={2}
                        fill={toColor(count)}
                        opacity={count === 0 ? 0.3 : 0.9}
                      />
                      {count > 0 && (
                        <>
                          <text
                            x={cellX(ci) + CELL_W / 2}
                            y={cellY(ri) + CELL_H / 2 - 1}
                            fontSize="5"
                            fill="hsl(225 45% 90%)"
                            fontFamily="var(--font-mono)"
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontWeight={700}
                          >
                            {count}
                          </text>
                          <text
                            x={cellX(ci) + CELL_W / 2}
                            y={cellY(ri) + CELL_H / 2 + 5}
                            fontSize="3.5"
                            fill="hsl(225 45% 60%)"
                            fontFamily="var(--font-mono)"
                            textAnchor="middle"
                            dominantBaseline="middle"
                          >
                            {dominantTier(breakdown)}
                          </text>
                        </>
                      )}
                    </g>
                  )
                })}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.15rem', alignItems: 'center' }}>
          {([0, 0.25, 0.5, 0.75, 1] as const).map(v => (
            <div key={v} style={{ display: 'flex', alignItems: 'center', gap: '0.04rem' }}>
              <div style={{ width: 6, height: 6, borderRadius: 1, background: toColor(v === 0 ? 0 : Math.max(...matrix.map(c => c.count)) * v) }} />
            </div>
          ))}
          <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)', marginLeft: '0.05rem' }}>
            freq
          </span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '5px', color: 'var(--muted-foreground)', opacity: 0.7 }}>
          {windowSize} entries · 15-min window · dominant tier per cell
        </span>
      </div>
    </div>
  )
}
