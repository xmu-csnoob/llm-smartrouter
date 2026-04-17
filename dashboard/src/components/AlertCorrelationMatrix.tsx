import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 15 * 60 * 1000
const MIN_SAMPLES = 20

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0
  const valid = values.filter(Number.isFinite)
  if (valid.length === 0) return 0
  const m = valid.reduce((a, b) => a + b, 0) / valid.length
  const variance = valid.reduce((a, b) => a + (b - m) ** 2, 0) / valid.length
  return Math.sqrt(variance)
}

type BeaconLevel = 'NOMINAL' | 'WATCH' | 'CRITICAL'

interface BeaconSnapshot {
  error: BeaconLevel
  tier1: BeaconLevel
  jitter: BeaconLevel
  drift: BeaconLevel
  rateLimit: BeaconLevel
  ttft: BeaconLevel
}

type BeaconKey = keyof BeaconSnapshot

const BEACON_KEYS: BeaconKey[] = ['error', 'tier1', 'jitter', 'drift', 'rateLimit', 'ttft']

const BEACON_LABELS: Record<BeaconKey, string> = {
  error: 'Err%',
  tier1: 'T1Ld',
  jitter: 'Jitr',
  drift: 'Drft',
  rateLimit: '429s',
  ttft: 'TTFT',
}

const BEACON_COLORS: Record<BeaconKey, string> = {
  error: 'hsl(0 72% 55%)',
  tier1: 'hsl(280 65% 65%)',
  jitter: 'hsl(38 92% 55%)',
  drift: 'hsl(200 75% 55%)',
  rateLimit: 'hsl(25 95% 60%)',
  ttft: 'hsl(185 80% 55%)',
}

// Extract which beacon is active at each entry's timestamp
function extractSnapshots(entries: LogEntry[]): BeaconSnapshot[] {
  const now = Date.now()
  const timed = entries
    .map(e => {
      const tsMs = parseTimestamp(e.timestamp)
      return tsMs == null ? null : { entry: e, tsMs }
    })
    .filter((item): item is { entry: LogEntry; tsMs: number } => item != null)
    .sort((a, b) => b.tsMs - a.tsMs)

  const recent = timed.filter(({ tsMs }) => now - tsMs <= WINDOW_MS)
  const window = recent.length >= 8 ? recent : timed.slice(0, 60)
  if (window.length < 8) return []

  const logEntries = window.map(w => w.entry)

  // Error rate
  const errors = logEntries.filter(e => e.status >= 400 || !!e.error)
  const errorRate = errors.length / logEntries.length

  // Tier1 load
  let tier1Count = 0, tier2Count = 0, tier3Count = 0, unknownTier = 0
  for (const e of logEntries) {
    const t = e.routed_tier
    if (t === 'tier1') tier1Count++
    else if (t === 'tier2') tier2Count++
    else if (t === 'tier3') tier3Count++
    else unknownTier++
  }
  const totalTier = tier1Count + tier2Count + tier3Count + unknownTier || 1
  const tier1Pct = tier1Count / totalTier

  // Latency jitter CV
  const latencies = logEntries.map(e => e.latency_ms).filter((l): l is number => typeof l === 'number' && Number.isFinite(l) && l > 0)
  let cv = 0
  if (latencies.length >= 5) {
    const m = latencies.reduce((a, b) => a + b, 0) / latencies.length
    cv = m > 0 ? stddev(latencies) / m : 0
  }

  // Token drift
  const pairs: { est: number; actual: number }[] = []
  for (const e of logEntries) {
    const est = typeof e.estimated_tokens === 'number' && e.estimated_tokens > 0 ? e.estimated_tokens : null
    let actual: number | null = null
    if (typeof e.tokens_used === 'number') {
      actual = e.tokens_used
    } else if (typeof e.tokens_used === 'object' && e.tokens_used) {
      const tu = e.tokens_used as { input?: number; output?: number }
      const sum = (tu.input ?? 0) + (tu.output ?? 0)
      actual = sum > 0 ? sum : null
    }
    if (est != null && actual != null) pairs.push({ est, actual })
  }
  let driftPct = 0
  if (pairs.length >= 6) {
    const errPcts = pairs.map(p => ((p.actual - p.est) / p.est) * 100)
    const absErrs = errPcts.map(e => Math.abs(e))
    driftPct = absErrs.reduce((a, b) => a + b, 0) / absErrs.length
  }

  // Rate limits
  const rlEntries = logEntries.filter(e => e.status === 429 || (e.error && e.error.toLowerCase().includes('rate limit')))
  const rlRate = rlEntries.length / logEntries.length

  // TTFT
  const ttfts = logEntries.map(e => e.ttft_ms).filter((t): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0)
  let p95ttft = Infinity
  if (ttfts.length >= 4) {
    const sorted = [...ttfts].sort((a, b) => a - b)
    const p95idx = Math.floor(ttfts.length * 0.95)
    p95ttft = sorted[p95idx]
  }

  // Build beacon levels
  const errorLevel: BeaconLevel = errorRate > 0.10 ? 'CRITICAL' : errorRate > 0.03 ? 'WATCH' : 'NOMINAL'
  const tier1Level: BeaconLevel = tier1Pct > 0.50 ? 'CRITICAL' : tier1Pct > 0.35 ? 'WATCH' : 'NOMINAL'
  const jitterLevel: BeaconLevel = cv > 0.40 ? 'CRITICAL' : cv > 0.20 ? 'WATCH' : 'NOMINAL'
  const driftLevel: BeaconLevel = driftPct > 25 ? 'CRITICAL' : driftPct > 10 ? 'WATCH' : 'NOMINAL'
  const rateLimitLevel: BeaconLevel = rlRate > 0.05 ? 'CRITICAL' : rlEntries.length > 0 ? 'WATCH' : 'NOMINAL'
  const ttftLevel: BeaconLevel = p95ttft > 5000 ? 'CRITICAL' : p95ttft > 2000 ? 'WATCH' : 'NOMINAL'

  return [{
    error: errorLevel,
    tier1: tier1Level,
    jitter: jitterLevel,
    drift: driftLevel,
    rateLimit: rateLimitLevel,
    ttft: ttftLevel,
  }]
}

interface CoOccurrence {
  beacon1: BeaconKey
  beacon2: BeaconKey
  count: number
  totalPairs: number
  strength: number // 0-1
}

interface AlertCorrelationMatrixProps {
  entries: LogEntry[]
}

export function AlertCorrelationMatrix({ entries }: AlertCorrelationMatrixProps) {
  const correlation = useMemo((): CoOccurrence[] | null => {
    if (entries.length < MIN_SAMPLES) return null

    const snapshots = extractSnapshots(entries)
    if (snapshots.length === 0) return null

    // Build co-occurrence matrix for non-NOMINAL beacons
    const coMat = new Map<string, { together: number; total: number }>()

    for (const snap of snapshots) {
      const active = BEACON_KEYS.filter(k => snap[k] !== 'NOMINAL')
      for (let i = 0; i < active.length; i++) {
        for (let j = i; j < active.length; j++) {
          const k1 = active[i]
          const k2 = active[j]
          const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`
          if (!coMat.has(key)) coMat.set(key, { together: 0, total: 0 })
          const entry = coMat.get(key)!
          entry.together++
          entry.total += 2 - (k1 === k2 ? 0 : 1)
        }
      }
      // Count all non-nominal pairs
      for (const k of active) {
        for (const other of BEACON_KEYS) {
          if (other === k) continue
          const key = k < other ? `${k}|${other}` : `${other}|${k}`
          if (!coMat.has(key)) coMat.set(key, { together: 0, total: 0 })
          coMat.get(key)!.total++
        }
      }
    }

    // Actually compute co-occurrence: how often are beacon A and beacon B both non-NOMINAL?
    // Simpler: track how many snapshots each beacon is active, and how many snapshots both are active
    const activeCount = new Map<BeaconKey, number>()
    const togetherCount = new Map<string, number>()
    let totalSnapshots = snapshots.length

    for (const snap of snapshots) {
      const active = BEACON_KEYS.filter(k => snap[k] !== 'NOMINAL')
      for (const k of active) {
        activeCount.set(k, (activeCount.get(k) || 0) + 1)
      }
      for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
          const k1 = active[i]
          const k2 = active[j]
          const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`
          togetherCount.set(key, (togetherCount.get(key) || 0) + 1)
        }
      }
    }

    const results: CoOccurrence[] = []
    for (let i = 0; i < BEACON_KEYS.length; i++) {
      for (let j = i; j < BEACON_KEYS.length; j++) {
        const k1 = BEACON_KEYS[i]
        const k2 = BEACON_KEYS[j]
        const key = `${k1}|${k2}`
        if (i === j) {
          // Self-correlation: beacon active fraction
          const active = activeCount.get(k1) || 0
          results.push({
            beacon1: k1,
            beacon2: k2,
            count: active,
            totalPairs: totalSnapshots,
            strength: totalSnapshots > 0 ? active / totalSnapshots : 0,
          })
        } else {
          const together = togetherCount.get(key) || 0
          const minActive = Math.min(activeCount.get(k1) || 0, activeCount.get(k2) || 0)
          // Jaccard-like: together / min(both active)
          const strength = minActive > 0 ? together / minActive : 0
          results.push({
            beacon1: k1,
            beacon2: k2,
            count: together,
            totalPairs: totalSnapshots,
            strength,
          })
        }
      }
    }

    return results
  }, [entries])

  const snapshots = useMemo((): BeaconSnapshot[] => extractSnapshots(entries), [entries])

  if (!correlation || snapshots.length < 8) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '968ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT SIGNAL DATA
        </div>
      </div>
    )
  }

  const levelColor = (level: BeaconLevel): string => {
    if (level === 'CRITICAL') return 'hsl(0 72% 55%)'
    if (level === 'WATCH') return 'hsl(38 92% 55%)'
    return 'hsl(145 65% 55%)'
  }

  // Current snapshot for header badges
  const current = snapshots[0]

  // Build 2D matrix: matrix[i][j] = strength for BEACON_KEYS[i] x BEACON_KEYS[j]
  const N = BEACON_KEYS.length
  const matrix: number[][] = Array.from({ length: N }, () => Array(N).fill(0))
  for (const c of correlation) {
    const i = BEACON_KEYS.indexOf(c.beacon1)
    const j = BEACON_KEYS.indexOf(c.beacon2)
    matrix[i][j] = c.strength
    if (i !== j) matrix[j][i] = c.strength
  }

  const CELL = 28
  const GAP = 2
  const MATRIX_SIZE = N * CELL + (N - 1) * GAP
  const LABEL_W = 26
  const svgW = LABEL_W * 2 + MATRIX_SIZE + 4
  const svgH = LABEL_W + MATRIX_SIZE + 4

  const cellX = (i: number) => LABEL_W + 2 + i * (CELL + GAP)
  const cellY = (j: number) => LABEL_W + 2 + j * (CELL + GAP)

  const toColor = (v: number): string => {
    if (v === 0) return 'hsl(225 45% 8%)'
    if (v < 0.25) return 'hsl(145 65% 30%)'
    if (v < 0.5) return 'hsl(38 92% 45%)'
    if (v < 0.75) return 'hsl(25 95% 55%)'
    return 'hsl(0 72% 55%)'
  }

  const currentActive = BEACON_KEYS.filter(k => current[k] !== 'NOMINAL')
  const currentLevels = BEACON_KEYS.reduce((acc, k) => {
    acc[k] = current[k]
    return acc
  }, {} as BeaconSnapshot)

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '968ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Alert Correlation
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: 'var(--muted-foreground)',
            background: 'hsl(225 45% 8%)',
            border: '1px solid hsl(225 45% 15%)',
            borderRadius: 2, padding: '2px 5px',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {currentActive.length}/{N} active
          </span>
        </div>
      </div>

      {/* Current beacon status row */}
      <div style={{ display: 'flex', gap: '0.2rem', overflow: 'hidden' }}>
        {BEACON_KEYS.map(k => (
          <div key={k} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.04rem',
            flex: 1, minWidth: 0,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: levelColor(currentLevels[k]),
              boxShadow: currentLevels[k] !== 'NOMINAL' ? `0 0 4px ${levelColor(currentLevels[k])}` : 'none',
              animation: currentLevels[k] === 'CRITICAL' ? 'blink 0.8s ease-in-out infinite' : 'none',
              flexShrink: 0,
            }} />
            <span style={{
              fontSize: '4px', fontFamily: 'var(--font-mono)',
              color: levelColor(currentLevels[k]),
              textTransform: 'uppercase', letterSpacing: '0.03em',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {BEACON_LABELS[k]}
            </span>
          </div>
        ))}
      </div>

      {/* Matrix SVG */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <svg width={svgW} height={svgH} style={{ overflow: 'visible' }}>
          {/* Row labels */}
          {BEACON_KEYS.map((k, i) => (
            <text
              key={`rl-${k}`}
              x={LABEL_W - 2}
              y={cellY(i) + CELL / 2 + 1}
              fontSize="4.5"
              fill={BEACON_COLORS[k]}
              fontFamily="var(--font-mono)"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {BEACON_LABELS[k]}
            </text>
          ))}
          {/* Column labels */}
          {BEACON_KEYS.map((k, j) => (
            <text
              key={`cl-${k}`}
              x={cellX(j) + CELL / 2}
              y={LABEL_W - 1}
              fontSize="4.5"
              fill={BEACON_COLORS[k]}
              fontFamily="var(--font-mono)"
              textAnchor="middle"
              dominantBaseline="auto"
            >
              {BEACON_LABELS[k]}
            </text>
          ))}
          {/* Cells */}
          {BEACON_KEYS.map((k1, i) =>
            BEACON_KEYS.map((k2, j) => {
              const v = matrix[i][j]
              const isDiag = i === j
              return (
                <g key={`${k1}-${k2}`}>
                  <rect
                    x={cellX(j)}
                    y={cellY(i)}
                    width={CELL}
                    height={CELL}
                    rx={2}
                    fill={toColor(v)}
                    opacity={isDiag ? 0.9 : 0.85}
                  />
                  {v > 0 && !isDiag && (
                    <text
                      x={cellX(j) + CELL / 2}
                      y={cellY(i) + CELL / 2}
                      fontSize="4"
                      fill="hsl(225 45% 90%)"
                      fontFamily="var(--font-mono)"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      opacity={v > 0.5 ? 1 : 0.7}
                    >
                      {v >= 1 ? '1.0' : v.toFixed(1)}
                    </text>
                  )}
                  {isDiag && (
                    <text
                      x={cellX(j) + CELL / 2}
                      y={cellY(i) + CELL / 2}
                      fontSize="4"
                      fill="hsl(225 45% 90%)"
                      fontFamily="var(--font-mono)"
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      {v >= 1 ? '1.0' : v.toFixed(1)}
                    </text>
                  )}
                </g>
              )
            })
          )}
        </svg>
      </div>

      {/* Co-occurrence explanation */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.06rem' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '4px', color: 'hsl(225 45% 20%)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Co-occurrence strength (Jaccard: together / min active)
        </span>
        <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'center' }}>
          {([0, 0.25, 0.5, 0.75, 1] as const).map(v => (
            <div key={v} style={{ display: 'flex', alignItems: 'center', gap: '0.06rem' }}>
              <div style={{ width: 8, height: 8, borderRadius: 1, background: toColor(v) }} />
              <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>
                {v === 0 ? '0' : v === 1 ? '1' : `${v}`}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Top co-occurring pairs */}
      <div style={{ display: 'flex', gap: '0.2rem', overflow: 'hidden' }}>
        {BEACON_KEYS.map(k1 => {
          const pairs = correlation
            .filter(c => c.beacon1 === k1 && c.beacon2 !== k1 && c.strength > 0)
            .sort((a, b) => b.strength - a.strength)
            .slice(0, 2)
          if (pairs.length === 0) return null
          return (
            <div key={k1} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.04rem', minWidth: 0 }}>
              {pairs.map(p => (
                <div key={`${p.beacon1}-${p.beacon2}`} style={{
                  display: 'flex', alignItems: 'center', gap: '0.1rem',
                  padding: '0.04rem 0.1rem',
                  background: 'hsl(225 45% 8%)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}>
                  <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: BEACON_COLORS[p.beacon1], flexShrink: 0 }}>
                    {BEACON_LABELS[p.beacon1]}
                  </span>
                  <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>↔</span>
                  <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: BEACON_COLORS[p.beacon2], flexShrink: 0 }}>
                    {BEACON_LABELS[p.beacon2]}
                  </span>
                  <span style={{
                    fontSize: '4px', fontFamily: 'var(--font-mono)',
                    color: toColor(p.strength),
                    marginLeft: 'auto', fontWeight: 700,
                  }}>
                    {p.strength >= 1 ? '1.0' : p.strength.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '5px',
        color: 'var(--muted-foreground)', textAlign: 'right', opacity: 0.7,
      }}>
        {snapshots.length} snapshots · 15-min window · Jaccard co-occurrence
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.15; }
        }
      `}</style>
    </div>
  )
}
