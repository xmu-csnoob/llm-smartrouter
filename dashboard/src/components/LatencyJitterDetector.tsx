import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 5 * 60 * 1000
const MIN_SAMPLES = 8
const MAX_ENTRIES = 50
const CV_STABLE = 0.15
const CV_UNSTABLE = 0.35

type JitterClass = 'STABLE' | 'UNSTABLE' | 'JITTERY'

const JITTER_META: Record<JitterClass, { color: string; bg: string; label: string }> = {
  STABLE:  { color: 'hsl(145 65% 55%)', bg: 'hsl(145 65% 55% / 0.15)',  label: 'Stable' },
  UNSTABLE: { color: 'hsl(38 92% 55%)',  bg: 'hsl(38 92% 55% / 0.15)',   label: 'Unstable' },
  JITTERY: { color: 'hsl(0 72% 55%)',   bg: 'hsl(0 72% 55% / 0.15)',   label: 'Jittery' },
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function getPositiveNumber(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

function meanStddev(values: number[]): { mean: number; stddev: number } {
  const n = values.length
  if (n === 0) return { mean: 0, stddev: 0 }
  const valid = values.filter(Number.isFinite)
  if (valid.length === 0) return { mean: 0, stddev: 0 }
  const m = valid.reduce((a, b) => a + b, 0) / valid.length
  const variance = valid.reduce((a, b) => a + (b - m) ** 2, 0) / valid.length
  return { mean: m, stddev: Math.sqrt(variance) }
}

function cv(mean: number, stddev: number): number {
  if (!Number.isFinite(mean) || mean === 0) return 0
  return stddev / mean
}

function jitterClass(cvVal: number): JitterClass {
  if (cvVal < CV_STABLE) return 'STABLE'
  if (cvVal < CV_UNSTABLE) return 'UNSTABLE'
  return 'JITTERY'
}

interface TimedEntry {
  entry: LogEntry
  tsMs: number
}

interface ModelJitter {
  model: string
  mean: number
  stddev: number
  cv: number
  jitterClass: JitterClass
  sampleCount: number
  tier: string
}

interface TierJitter {
  tier: string
  mean: number
  stddev: number
  cv: number
  jitterClass: JitterClass
  sampleCount: number
}

function Sparkline({ values, color, width = 80, height = 18 }: { values: number[]; color: string; width?: number; height?: number }) {
  const finite = values.filter(Number.isFinite)
  if (finite.length < 2) return <svg width={width} height={height} aria-label="Insufficient data" />
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const range = max - min || 1
  const xScale = Math.max(width - 1, 1)
  const yScale = Math.max(height - 2, 1)
  const pts = finite.map((v, i) => {
    const x = finite.length === 1 ? 0 : (i / (finite.length - 1)) * xScale
    const y = 1 + (yScale - ((v - min) / range) * yScale)
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }} aria-label={`CV sparkline, ${finite.length} points`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

type IncidentState = 'NOMINAL' | 'DEGRADED' | 'CRITICAL'

export function LatencyJitterDetector({ entries }: { entries: LogEntry[] }) {
  const { modelJitters, tierJitters, overallState, jitteryCount, unstableCount, stableCount, totalTracked, windowSize } = useMemo(() => {
    const now = Date.now()
    const timed: TimedEntry[] = entries
      .map((e) => {
        const tsMs = parseTimestamp(e.timestamp)
        return tsMs == null ? null : { entry: e, tsMs }
      })
      .filter((item): item is TimedEntry => item != null)
      .sort((a, b) => b.tsMs - a.tsMs)

    const recent = timed.filter(({ tsMs }) => {
      const age = now - tsMs
      return age >= 0 && age <= WINDOW_MS
    })

    const windowEntries = (recent.length > 0 ? recent : timed.slice(0, Math.min(MIN_SAMPLES, timed.length)))
      .slice(0, MAX_ENTRIES).map(({ entry }) => entry)

    // Per-model latency collection
    const byModel = new Map<string, number[]>()
    const modelTier = new Map<string, string>()
    for (const e of windowEntries) {
      const lat = getPositiveNumber(e.latency_ms)
      if (lat == null) continue
      const model = e.routed_model || e.requested_model || 'unknown'
      if (!byModel.has(model)) {
        byModel.set(model, [])
        modelTier.set(model, e.routed_tier || 'unknown')
      }
      byModel.get(model)!.push(lat)
    }

    // Per-tier latency collection
    const byTier = new Map<string, number[]>()
    for (const e of windowEntries) {
      const lat = getPositiveNumber(e.latency_ms)
      if (lat == null) continue
      const tier = e.routed_tier || 'unknown'
      if (!byTier.has(tier)) byTier.set(tier, [])
      byTier.get(tier)!.push(lat)
    }

    // Model jitter
    const modelJitters: ModelJitter[] = []
    for (const [model, values] of byModel) {
      if (values.length < 3) continue
      const { mean, stddev } = meanStddev(values)
      const cvVal = cv(mean, stddev)
      const clamped = Number.isFinite(cvVal) ? clamp(cvVal, 0, 5) : 0
      modelJitters.push({
        model,
        mean,
        stddev,
        cv: clamped,
        jitterClass: jitterClass(clamped),
        sampleCount: values.length,
        tier: modelTier.get(model) || 'unknown',
      })
    }
    modelJitters.sort((a, b) => b.cv - a.cv)

    // Tier jitter
    const tierJitters: TierJitter[] = []
    for (const [tier, values] of byTier) {
      if (values.length < 3) continue
      const { mean, stddev } = meanStddev(values)
      const cvVal = cv(mean, stddev)
      const clamped = Number.isFinite(cvVal) ? clamp(cvVal, 0, 5) : 0
      tierJitters.push({
        tier,
        mean,
        stddev,
        cv: clamped,
        jitterClass: jitterClass(clamped),
        sampleCount: values.length,
      })
    }

    // State
    const totalModels = modelJitters.length
    const jitteryCount = modelJitters.filter(m => m.jitterClass === 'JITTERY').length
    const unstableCount = modelJitters.filter(m => m.jitterClass === 'UNSTABLE').length
    const stableCount = modelJitters.filter(m => m.jitterClass === 'STABLE').length

    const jitteryRatio = totalModels > 0 ? jitteryCount / totalModels : 0
    const unstableRatio = totalModels > 0 ? unstableCount / totalModels : 0

    let overallState: IncidentState
    if (jitteryRatio >= 0.4 || (jitteryRatio + unstableRatio) >= 0.7) {
      overallState = 'CRITICAL'
    } else if (jitteryRatio >= 0.15 || unstableRatio >= 0.4) {
      overallState = 'DEGRADED'
    } else {
      overallState = 'NOMINAL'
    }

    return {
      modelJitters,
      tierJitters,
      overallState,
      jitteryCount,
      unstableCount,
      stableCount,
      totalTracked: totalModels,
      windowSize: windowEntries.length,
    }
  }, [entries])

  const stateColor = overallState === 'NOMINAL' ? JITTER_META.STABLE.color
    : overallState === 'DEGRADED' ? JITTER_META.UNSTABLE.color
    : JITTER_META.JITTERY.color

  const fmtMs = (v: number) => Number.isFinite(v) ? `${Math.round(v)}ms` : '—'
  const fmtCv = (v: number) => v.toFixed(3)

  const topJittery = modelJitters.slice(0, 6)

  if (totalTracked === 0) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '958ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          NO LATENCY DATA
        </div>
      </div>
    )
  }

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '958ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Latency Jitter
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          {overallState === 'CRITICAL' && (
            <span style={{
              width: '5px', height: '5px', borderRadius: '50%',
              background: stateColor,
              animation: 'pulse 1s ease-in-out infinite',
              display: 'inline-block',
            }} />
          )}
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '6px',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            padding: '2px 6px',
            borderRadius: '2px',
            background: overallState === 'CRITICAL' ? 'hsl(0 72% 20%)' : overallState === 'DEGRADED' ? 'hsl(38 92% 20%)' : 'transparent',
            color: stateColor,
            boxShadow: overallState === 'CRITICAL' ? '0 0 8px hsl(0 72% 55%)' : 'none',
          }}>
            {overallState}
          </span>
        </div>
      </div>

      {/* Summary stats row */}
      <div style={{ display: 'flex', gap: '0.35rem', padding: '0.12rem 0.25rem', background: 'hsl(225 45% 8%)', borderRadius: 3 }}>
        {([
          { label: 'STABLE', count: stableCount, meta: JITTER_META.STABLE },
          { label: 'UNSTABLE', count: unstableCount, meta: JITTER_META.UNSTABLE },
          { label: 'JITTERY', count: jitteryCount, meta: JITTER_META.JITTERY },
        ] as const).map(({ label, count, meta }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center' }}>
            <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {label}
            </span>
            <span style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: meta.color, textShadow: `0 0 6px ${meta.color}50` }}>
              {count}
            </span>
          </div>
        ))}
        <div style={{ width: 1, background: 'hsl(225 45% 15%)', alignSelf: 'stretch' }} />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center' }}>
          <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Tracked
          </span>
          <span style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--foreground)', textShadow: '0 0 6px hsl(225 45% 50% / 0.3)' }}>
            {totalTracked}
          </span>
        </div>
      </div>

      {/* Per-model jitter table */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
        {/* Column labels */}
        <div style={{ display: 'flex', gap: '0.15rem', paddingLeft: '0.05rem', paddingRight: '0.05rem', borderBottom: '1px solid hsl(225 45% 12%)' }}>
          {['MODEL', 'TIER', 'MEAN', 'STDDEV', 'CV', ''].map((label, i) => (
            <span key={i} style={{
              fontSize: '4px', fontFamily: 'var(--font-mono)',
              color: 'hsl(145 65% 40%)', letterSpacing: '0.05em',
              flex: i === 0 ? 1.5 : 1,
              width: i === 1 ? 30 : i === 2 ? 36 : i === 3 ? 36 : i === 4 ? 42 : 14,
              textAlign: i === 2 || i === 3 || i === 4 ? 'right' : 'left',
            }}>
              {label}
            </span>
          ))}
        </div>

        {topJittery.map((mj) => {
          const meta = JITTER_META[mj.jitterClass]
          return (
            <div key={mj.model} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.15rem',
              padding: '0.08rem 0.05rem',
              borderRadius: 2,
              background: mj.jitterClass === 'JITTERY' ? 'hsl(0 72% 55% / 0.05)'
                : mj.jitterClass === 'UNSTABLE' ? 'hsl(38 92% 55% / 0.04)'
                : 'transparent',
              transition: 'background 200ms ease',
            }}>
              {/* Model */}
              <span style={{
                flex: 1.5, fontSize: '5.5px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 50%)', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {mj.model}
              </span>
              {/* Tier badge */}
              <span style={{
                width: 30, fontSize: '4.5px', fontFamily: 'var(--font-mono)',
                color: mj.tier === 'tier1' ? 'hsl(280 65% 65%)'
                  : mj.tier === 'tier2' ? 'hsl(200 75% 55%)'
                  : mj.tier === 'tier3' ? 'hsl(145 65% 55%)'
                  : 'hsl(225 45% 30%)',
                textAlign: 'center', flexShrink: 0,
              }}>
                {mj.tier}
              </span>
              {/* Mean */}
              <span style={{
                width: 36, fontSize: '5.5px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 50%)', textAlign: 'right', flexShrink: 0,
              }}>
                {fmtMs(mj.mean)}
              </span>
              {/* Stddev */}
              <span style={{
                width: 36, fontSize: '5.5px', fontFamily: 'var(--font-mono)',
                color: mj.jitterClass === 'JITTERY' ? 'hsl(0 72% 60%)'
                  : mj.jitterClass === 'UNSTABLE' ? 'hsl(38 92% 60%)'
                  : 'hsl(225 45% 45%)',
                textAlign: 'right', flexShrink: 0,
              }}>
                {fmtMs(mj.stddev)}
              </span>
              {/* CV with bar */}
              <div style={{
                width: 42, flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: '0.1rem',
              }}>
                <div style={{
                  flex: 1, height: 3, background: 'hsl(225 45% 10%)',
                  borderRadius: 2, overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${clamp((mj.cv / 1) * 100, 0, 100)}%`,
                    height: '100%',
                    background: meta.color,
                    boxShadow: `0 0 3px ${meta.color}50`,
                    transition: 'width 400ms ease',
                  }} />
                </div>
                <span style={{
                  fontSize: '5px', fontFamily: 'var(--font-mono)',
                  color: meta.color, fontWeight: 700, minWidth: 20, textAlign: 'right',
                }}>
                  {fmtCv(mj.cv)}
                </span>
              </div>
              {/* Class badge */}
              <span style={{
                width: 14, fontSize: '4px', fontFamily: 'var(--font-mono)',
                color: meta.color, textAlign: 'center', flexShrink: 0,
              }}>
                {mj.jitterClass === 'STABLE' ? '—' : mj.jitterClass === 'UNSTABLE' ? '!' : '!!'}
              </span>
            </div>
          )
        })}
      </div>

      {/* Per-tier jitter summary */}
      {tierJitters.length > 0 && (
        <div style={{ display: 'flex', gap: '0.25rem', paddingTop: '0.08rem', borderTop: '1px solid hsl(225 45% 10%)' }}>
          {tierJitters.map((tj) => {
            const meta = JITTER_META[tj.jitterClass]
            return (
              <div key={tj.tier} style={{
                flex: 1, padding: '0.1rem 0.15rem',
                background: 'hsl(225 45% 8%)', borderRadius: 3,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.05rem',
              }}>
                <span style={{
                  fontSize: '5px', fontFamily: 'var(--font-mono)',
                  color: tj.tier === 'tier1' ? 'hsl(280 65% 65%)'
                    : tj.tier === 'tier2' ? 'hsl(200 75% 55%)'
                    : tj.tier === 'tier3' ? 'hsl(145 65% 55%)'
                    : 'hsl(225 45% 30%)',
                  textTransform: 'uppercase',
                }}>
                  {tj.tier}
                </span>
                <span style={{
                  fontSize: '8px', fontFamily: 'var(--font-mono)', fontWeight: 700,
                  color: meta.color, textShadow: `0 0 4px ${meta.color}50`,
                }}>
                  CV {fmtCv(tj.cv)}
                </span>
                <span style={{
                  fontSize: '4.5px', fontFamily: 'var(--font-mono)',
                  color: 'var(--muted-foreground)',
                }}>
                  {tj.sampleCount}s · {fmtMs(tj.mean)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Footer */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '5px',
        color: 'var(--muted-foreground)',
        textAlign: 'right',
        opacity: 0.7,
      }}>
        {windowSize} entries · CV = stddev/mean · n≥3 {totalTracked} models
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
