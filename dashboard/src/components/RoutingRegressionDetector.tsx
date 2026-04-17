import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 5 * 60 * 1000
const MIN_SAMPLES = 15
const MAX_ENTRIES = 40
const SPARKLINE_LIMIT = 16

type SignalStatus = 'OK' | 'WATCH' | 'REGRESSION' | 'CRITICAL'

const STATUS_COLOR: Record<SignalStatus, string> = {
  OK: 'hsl(145 65% 55%)',
  WATCH: 'hsl(38 92% 55%)',
  REGRESSION: 'hsl(25 95% 60%)',
  CRITICAL: 'hsl(0 72% 55%)',
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

interface TimedEntry {
  entry: LogEntry
  tsMs: number
}

interface TierDist {
  tier1: number
  tier2: number
  tier3: number
  unknown: number
}

interface MethodDist {
  ml: number
  rule: number
  unknown: number
}

interface DeltaValue {
  value: number
  hasBaseline: boolean
}

// routing_method may not exist on older LogEntry shapes
function getRoutingMethod(e: LogEntry): 'ml' | 'rule' | 'unknown' {
  const m = (e as { routing_method?: string }).routing_method
  if (m === 'ml') return 'ml'
  if (m === 'rule') return 'rule'
  return 'unknown'
}

function emptyTierDist(): TierDist {
  return { tier1: 0, tier2: 0, tier3: 0, unknown: 0 }
}

function emptyMethodDist(): MethodDist {
  return { ml: 0, rule: 0, unknown: 0 }
}

function calcTierPct(dist: TierDist, total: number): TierDist {
  if (total === 0) return emptyTierDist()
  const t = total
  return {
    tier1: dist.tier1 / t,
    tier2: dist.tier2 / t,
    tier3: dist.tier3 / t,
    unknown: dist.unknown / t,
  }
}

function calcMethodPct(dist: MethodDist, total: number): MethodDist {
  if (total === 0) return emptyMethodDist()
  const t = total
  return {
    ml: dist.ml / t,
    rule: dist.rule / t,
    unknown: dist.unknown / t,
  }
}

function Sparkline({ values, color, width = 80, height = 20 }: { values: number[]; color: string; width?: number; height?: number }) {
  const finite = values.filter(Number.isFinite)
  if (finite.length < 2) return <svg width={width} height={height} />
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
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

type IncidentState = 'NOMINAL' | 'WATCH' | 'REGRESSION' | 'CRITICAL REGRESSION'

export function RoutingRegressionDetector({ entries }: { entries: LogEntry[] }) {
  const { currentWindow, priorWindow } = useMemo(() => {
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
    const hasFresh = recent.length > 0
    const source = hasFresh
      ? recent
      : timed.slice(0, Math.min(MIN_SAMPLES, timed.length))

    const current = source.slice(0, MAX_ENTRIES).map(({ entry }) => entry)
    const prior = source.slice(MAX_ENTRIES, MAX_ENTRIES * 2).map(({ entry }) => entry)

    return { currentWindow: current, priorWindow: prior }
  }, [entries])

  const {
    currentTierPct,
    tier1Delta, tier2Delta, tier3Delta,
    mlDelta, ruleDelta,
    tier1Spark, tier2Spark, tier3Spark,
    mlSpark, ruleSpark,
    severity, state, rec,
    windowSize, priorSize, mlShare, ruleShare,
  } = useMemo(() => {
    const td: TierDist = emptyTierDist()
    const md: MethodDist = emptyMethodDist()

    for (const e of currentWindow) {
      const tier = e.routed_tier
      if (tier === 'tier1') td.tier1++
      else if (tier === 'tier2') td.tier2++
      else if (tier === 'tier3') td.tier3++
      else td.unknown++

      const method = getRoutingMethod(e)
      if (method === 'ml') md.ml++
      else if (method === 'rule') md.rule++
      else md.unknown++
    }

    const total = currentWindow.length
    const curTierPct = calcTierPct(td, total)
    const curMethodPct = calcMethodPct(md, total)

    // Prior window tier distribution
    const priorTd: TierDist = emptyTierDist()
    const priorMd: MethodDist = emptyMethodDist()
    for (const e of priorWindow) {
      const tier = e.routed_tier
      if (tier === 'tier1') priorTd.tier1++
      else if (tier === 'tier2') priorTd.tier2++
      else if (tier === 'tier3') priorTd.tier3++
      else priorTd.unknown++

      const method = getRoutingMethod(e)
      if (method === 'ml') priorMd.ml++
      else if (method === 'rule') priorMd.rule++
      else priorMd.unknown++
    }
    const priorTotal = priorWindow.length
    const prTierPct = calcTierPct(priorTd, priorTotal)
    const prMethodPct = calcMethodPct(priorMd, priorTotal)

    // Deltas (current - prior)
    const dTier1: DeltaValue = { value: (curTierPct.tier1 - prTierPct.tier1) * 100, hasBaseline: priorTotal > 0 }
    const dTier2: DeltaValue = { value: (curTierPct.tier2 - prTierPct.tier2) * 100, hasBaseline: priorTotal > 0 }
    const dTier3: DeltaValue = { value: (curTierPct.tier3 - prTierPct.tier3) * 100, hasBaseline: priorTotal > 0 }
    const dMl: DeltaValue = { value: (curMethodPct.ml - prMethodPct.ml) * 100, hasBaseline: priorTotal > 0 }
    const dRule: DeltaValue = { value: (curMethodPct.rule - prMethodPct.rule) * 100, hasBaseline: priorTotal > 0 }

    // Build sparkline history from prior + current tier pcts (simplified: use window tier % series)
    // For simplicity, build from current window entries bucketed into recent slices
    const sliceSize = Math.max(1, Math.floor(currentWindow.length / SPARKLINE_LIMIT))
    const tier1S: number[] = []
    const tier2S: number[] = []
    const tier3S: number[] = []
    for (let i = 0; i < currentWindow.length; i += sliceSize) {
      const slice = currentWindow.slice(i, i + sliceSize)
      const sTd = emptyTierDist()
      for (const e of slice) {
        const tier = e.routed_tier
        if (tier === 'tier1') sTd.tier1++
        else if (tier === 'tier2') sTd.tier2++
        else if (tier === 'tier3') sTd.tier3++
      }
      const sTotal = slice.length
      tier1S.push(sTotal > 0 ? sTd.tier1 / sTotal : 0)
      tier2S.push(sTotal > 0 ? sTd.tier2 / sTotal : 0)
      tier3S.push(sTotal > 0 ? sTd.tier3 / sTotal : 0)
    }

    // ML share sparkline
    const mlSliceSize = Math.max(1, Math.floor(currentWindow.length / SPARKLINE_LIMIT))
    const mlS: number[] = []
    const ruleS: number[] = []
    for (let i = 0; i < currentWindow.length; i += mlSliceSize) {
      const slice = currentWindow.slice(i, i + mlSliceSize)
      const sMd = emptyMethodDist()
      for (const e of slice) {
        const method = getRoutingMethod(e)
        if (method === 'ml') sMd.ml++
        else if (method === 'rule') sMd.rule++
        else sMd.unknown++
      }
      const sTotal = slice.length
      mlS.push(sTotal > 0 ? sMd.ml / sTotal : 0)
      ruleS.push(sTotal > 0 ? sMd.rule / sTotal : 0)
    }

    // Severity: tier1 regression is most critical (cost), tier3 regression also bad (quality)
    const t1Shift = Math.abs(dTier1.value)
    const t3Shift = Math.abs(dTier3.value)
    const mlShift = Math.abs(dMl.value)
    const rawSev = clamp((t1Shift * 2 + t3Shift * 1.5 + mlShift * 1) * 2.5, 0, 100)
    const sev = clamp(rawSev, 0, 100)

    // State machine — only tier1 INCREASES and ML DECLINES are regressions
    const critCount = [
      dTier1.value > 15,
      dTier1.value > 10 && t1Shift > 5,
      dMl.value < -20,
    ].filter(Boolean).length

    let st: IncidentState
    if (critCount >= 2) st = 'CRITICAL REGRESSION'
    else if (dTier1.value > 12 || (dTier1.value > 8 && t1Shift > 5)) st = 'REGRESSION'
    else if (dTier1.value > 6 || dMl.value < -12) st = 'WATCH'
    else st = 'NOMINAL'

    // Recommendation
    let recommendation: string
    if (st === 'CRITICAL REGRESSION') {
      if (dTier1.value > 0 && dMl.value > 0) recommendation = 'ML routing regressing to tier1 — possible feature drift, check scoring engine'
      else if (dTier1.value > 0) recommendation = 'Tier1 traffic surge — check for scoring weight changes or upstream model quality drop'
      else recommendation = 'Multiple routing signals deteriorating — possible systemic issue, consider circuit breaker'
    } else if (st === 'REGRESSION') {
      if (dTier1.value > 0) recommendation = 'Tier1 routing elevated — monitor cost trajectory closely'
      else if (dTier3.value < 0) recommendation = 'Tier3 traffic down — higher-complexity tasks hitting tier2, watch latency'
      else recommendation = 'Routing distribution shifting — verify ML model is performing within expected bounds'
    } else if (st === 'WATCH') {
      if (dMl.value < 0) recommendation = 'ML routing share declining — rule-based routing increasing, verify ML confidence thresholds'
      else recommendation = 'Minor routing drift detected — track over next window before escalating'
    } else recommendation = 'Routing distribution stable'

    return {
      currentTierPct: curTierPct,
      tier1Delta: dTier1, tier2Delta: dTier2, tier3Delta: dTier3,
      mlDelta: dMl, ruleDelta: dRule,
      tier1Spark: tier1S, tier2Spark: tier2S, tier3Spark: tier3S,
      mlSpark: mlS, ruleSpark: ruleS,
      severity: sev, state: st, rec: recommendation,
      windowSize: currentWindow.length, priorSize: priorWindow.length,
      mlShare: curMethodPct.ml * 100, ruleShare: curMethodPct.rule * 100,
    }
  }, [currentWindow, priorWindow])

  const severityColor = severity < 30 ? STATUS_COLOR.OK
    : severity < 60 ? STATUS_COLOR.WATCH
    : severity < 80 ? STATUS_COLOR.REGRESSION
    : STATUS_COLOR.CRITICAL

  const stateBadgeColor = state === 'NOMINAL' ? STATUS_COLOR.OK
    : state === 'WATCH' ? STATUS_COLOR.WATCH
    : state === 'REGRESSION' ? STATUS_COLOR.REGRESSION
    : STATUS_COLOR.CRITICAL

  const fmtDelta = ({ value, hasBaseline }: DeltaValue) => {
    if (!hasBaseline) return ''
    const sign = value > 0 ? '+' : ''
    return `${sign}${value.toFixed(1)}pp`
  }
  const deltaColor = ({ value, hasBaseline }: DeltaValue, worsePositive: boolean) => {
    if (!hasBaseline || value === 0 || !Number.isFinite(value)) return 'var(--muted-foreground)'
    const worse = worsePositive ? value > 0 : value < 0
    return worse ? STATUS_COLOR.CRITICAL : STATUS_COLOR.OK
  }

  if (windowSize < 5) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '955ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {windowSize === 0 ? 'NO ROUTING DATA' : 'INSUFFICIENT SAMPLES'}
        </div>
      </div>
    )
  }

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '955ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Routing Regression
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '6px',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          padding: '2px 6px',
          borderRadius: '2px',
          background: state === 'CRITICAL REGRESSION' ? 'hsl(0 72% 20%)' : 'transparent',
          color: stateBadgeColor,
          boxShadow: state === 'CRITICAL REGRESSION' ? '0 0 8px hsl(0 72% 55%)' : 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}>
          {state === 'CRITICAL REGRESSION' && (
            <span style={{
              width: '5px', height: '5px', borderRadius: '50%',
              background: stateBadgeColor,
              animation: 'pulse 1s ease-in-out infinite',
              display: 'inline-block',
            }} />
          )}
          {state}
        </span>
      </div>

      {/* Severity bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '3px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '5px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
            Severity
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '7px', fontWeight: 600, color: severityColor, textShadow: `0 0 8px ${severityColor}40` }}>
            {Math.round(severity)}
          </span>
        </div>
        <div style={{ background: 'hsl(225 45% 10%)', height: '4px', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{
            width: `${clamp(severity, 0, 100)}%`,
            height: '100%',
            background: severityColor,
            transition: 'width 0.5s ease, background 0.3s ease',
          }} />
        </div>
      </div>

      {/* Tier distribution row */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.12rem' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '4.5px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'hsl(225 45% 20%)' }}>
          Tier Distribution
        </span>
        {(['tier1', 'tier2', 'tier3'] as const).map((tier) => {
          const pct = tier === 'tier1' ? currentTierPct.tier1 * 100
            : tier === 'tier2' ? currentTierPct.tier2 * 100
            : currentTierPct.tier3 * 100
          const delta = tier === 'tier1' ? tier1Delta : tier === 'tier2' ? tier2Delta : tier3Delta
          const spark = tier === 'tier1' ? tier1Spark : tier === 'tier2' ? tier2Spark : tier3Spark
          const color = tier === 'tier1' ? 'hsl(280 65% 65%)'
            : tier === 'tier2' ? 'hsl(200 75% 55%)'
            : 'hsl(145 65% 55%)'
          const deltaWorse = tier === 'tier1' ? true : tier === 'tier3' ? false : false
          const sparkColor = tier === 'tier1' ? 'hsl(280 65% 65%)'
            : tier === 'tier2' ? 'hsl(200 75% 55%)'
            : 'hsl(145 65% 55%)'
          return (
            <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontFamily: 'var(--font-mono)', fontSize: '6px' }}>
              <span style={{ width: 28, textTransform: 'uppercase', letterSpacing: '0.04em', color, fontSize: '5.5px', flexShrink: 0 }}>
                {tier}
              </span>
              <div style={{ flex: 1, height: 4, background: 'hsl(225 45% 10%)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  width: `${clamp(pct * 100, 0, 100)}%`,
                  height: '100%',
                  background: `linear-gradient(90deg, ${color}40, ${color}90)`,
                  borderRadius: 2,
                  boxShadow: `0 0 3px ${color}40`,
                  transition: 'width 400ms ease',
                }} />
              </div>
              <span style={{ fontSize: '6px', color, minWidth: 32, textAlign: 'right' }}>
                {pct.toFixed(1)}%
              </span>
              <span style={{ fontSize: '5px', color: deltaColor(delta, deltaWorse), minWidth: 40, textAlign: 'right' }}>
                {fmtDelta(delta)}
              </span>
              <Sparkline values={spark} color={sparkColor} width={40} height={14} />
            </div>
          )
        })}
      </div>

      {/* ML vs Rule routing row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.12rem 0.2rem', background: 'hsl(225 45% 8%)', borderRadius: 3 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '4.5px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'hsl(225 45% 20%)' }}>
          ML/Rule
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', flex: 1 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '6px', color: 'hsl(185 80% 60%)' }}>ML</span>
          <div style={{ flex: 1, height: 3, background: 'hsl(225 45% 10%)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              width: `${clamp(mlShare, 0, 100)}%`,
              height: '100%',
              background: 'hsl(185 80% 55%)',
              boxShadow: '0 0 4px hsl(185 80% 50%)',
              transition: 'width 400ms ease',
            }} />
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '6px', color: 'hsl(185 80% 60%)' }}>
            {mlShare.toFixed(1)}%
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '5px', color: deltaColor(mlDelta, false), minWidth: 40 }}>
            {fmtDelta(mlDelta)}
          </span>
          <Sparkline values={mlSpark} color="hsl(185 80% 60%)" width={40} height={12} />
        </div>
        <div style={{ width: 1, background: 'hsl(225 45% 15%)', alignSelf: 'stretch' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', flex: 1 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '6px', color: 'hsl(38 92% 60%)' }}>RULE</span>
          <div style={{ flex: 1, height: 3, background: 'hsl(225 45% 10%)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              width: `${clamp(ruleShare, 0, 100)}%`,
              height: '100%',
              background: 'hsl(38 92% 55%)',
              boxShadow: '0 0 4px hsl(38 92% 50%)',
              transition: 'width 400ms ease',
            }} />
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '6px', color: 'hsl(38 92% 60%)' }}>
            {ruleShare.toFixed(1)}%
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '5px', color: deltaColor(ruleDelta, false), minWidth: 40 }}>
            {fmtDelta(ruleDelta)}
          </span>
          <Sparkline values={ruleSpark} color="hsl(38 92% 60%)" width={40} height={12} />
        </div>
      </div>

      {/* Recommendation */}
      {state !== 'NOMINAL' && (
        <div style={{
          width: '100%',
          padding: '0.2rem 0.3rem',
          background: 'hsl(225 45% 8%)',
          borderRadius: '3px',
          fontFamily: 'var(--font-mono)',
          fontSize: '5.5px',
          color: 'var(--muted-foreground)',
          letterSpacing: '0.03em',
        }}>
          Hypothesis: {rec}
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
        {windowSize} entries {priorSize > 0 ? `/ prior: ${priorSize}` : ''}
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
