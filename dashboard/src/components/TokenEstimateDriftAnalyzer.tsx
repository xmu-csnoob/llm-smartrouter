import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 10 * 60 * 1000
const MIN_SAMPLES = 12

type BiasClass = 'UNDER' | 'BALANCED' | 'OVER'

const BIAS_META: Record<BiasClass, { color: string; bg: string; label: string }> = {
  UNDER:    { color: 'hsl(200 75% 55%)', bg: 'hsl(200 75% 55% / 0.12)',  label: 'Under-est' },
  BALANCED: { color: 'hsl(145 65% 55%)', bg: 'hsl(145 65% 55% / 0.12)', label: 'Balanced' },
  OVER:     { color: 'hsl(25 95% 60%)',  bg: 'hsl(25 95% 60% / 0.12)',  label: 'Over-est' },
}

type AccuracyClass = 'GOOD' | 'MODERATE' | 'POOR'

const ACCURACY_META: Record<AccuracyClass, { color: string; label: string }> = {
  GOOD:    { color: 'hsl(145 65% 55%)', label: '<10%' },
  MODERATE:{ color: 'hsl(38 92% 55%)',  label: '10–25%' },
  POOR:    { color: 'hsl(25 95% 60%)',  label: '>25%' },
}

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function getActualTokens(tokensUsed: LogEntry['tokens_used']): number | null {
  if (tokensUsed == null) return null
  if (typeof tokensUsed === 'number') {
    return Number.isFinite(tokensUsed) && tokensUsed >= 0 ? tokensUsed : null
  }
  if (typeof tokensUsed === 'object') {
    const total = (tokensUsed.input ?? 0) + (tokensUsed.output ?? 0)
    return total > 0 ? total : null
  }
  return null
}

function getEstimatedTokens(est: unknown): number | null {
  if (typeof est !== 'number' || !Number.isFinite(est) || est <= 0) return null
  return est
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0
  const valid = values.filter(Number.isFinite)
  if (valid.length === 0) return 0
  const m = valid.reduce((a, b) => a + b, 0) / valid.length
  const variance = valid.reduce((a, b) => a + (b - m) ** 2, 0) / valid.length
  return Math.sqrt(variance)
}

function biasClass(medianErrorPct: number): BiasClass {
  if (medianErrorPct < -10) return 'UNDER'
  if (medianErrorPct > 10) return 'OVER'
  return 'BALANCED'
}

function accuracyClass(mape: number): AccuracyClass {
  if (mape < 10) return 'GOOD'
  if (mape < 25) return 'MODERATE'
  return 'POOR'
}

function scatterColor(est: number, actual: number): string {
  const ratio = actual / (est || 1)
  if (ratio < 0.85) return 'hsl(200 75% 55%)'
  if (ratio > 1.15) return 'hsl(25 95% 60%)'
  return 'hsl(145 65% 55%)'
}

interface TimedEntry {
  entry: LogEntry
  tsMs: number
}

interface ModelDrift {
  model: string
  estMean: number
  actualMean: number
  medianErrorPct: number
  mape: number        // mean absolute percentage error
  biasClass: BiasClass
  accuracyClass: AccuracyClass
  sampleCount: number
  outliers: number
}

interface IntentDrift {
  intent: string
  medianErrorPct: number
  mape: number
  biasClass: BiasClass
  sampleCount: number
}

interface OutlierEntry {
  requestId: string
  model: string
  intent: string
  estimated: number
  actual: number
  errorPct: number
}

interface WindowStats {
  overallMape: number
  overallMedianErrorPct: number
  overallBiasClass: BiasClass
  overallAccuracyClass: AccuracyClass
  modelDrifts: ModelDrift[]
  intentDrifts: IntentDrift[]
  outliers: OutlierEntry[]
  scatterPoints: { est: number; actual: number; model: string }[]
  windowSize: number
}

export function TokenEstimateDriftAnalyzer({ entries }: { entries: LogEntry[] }) {
  const stats = useMemo((): WindowStats | null => {
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
    const source = recent.length > 0
      ? recent
      : timed.slice(0, Math.min(MIN_SAMPLES, timed.length))

    if (source.length < 6) return null

    const windowEntries = source.map(({ entry }) => entry)

    // Build paired [estimated, actual] list
    interface Pair { est: number; actual: number; model: string; intent: string; requestId: string }
    const pairs: Pair[] = []
    for (const e of windowEntries) {
      const est = getEstimatedTokens(e.estimated_tokens)
      const actual = getActualTokens(e.tokens_used)
      if (est == null || actual == null) continue
      pairs.push({ est, actual, model: e.routed_model || e.requested_model || 'unknown', intent: e.task_type || 'general', requestId: e.request_id })
    }

    if (pairs.length < 6) return null

    // Overall stats
    const errorPcts = pairs.map(p => ((p.actual - p.est) / p.est) * 100)
    const absErrorPcts = errorPcts.map(e => Math.abs(e))
    const overallMape = absErrorPcts.reduce((a, b) => a + b, 0) / absErrorPcts.length
    const overallMedianErrorPct = median(errorPcts)
    const errStddev = stddev(errorPcts)

    // Outliers: |error_pct| > 2 stddev
    const outlierThreshold = 2 * errStddev
    const outliers: OutlierEntry[] = []
    for (let i = 0; i < pairs.length; i++) {
      if (Math.abs(errorPcts[i]) > outlierThreshold) {
        outliers.push({
          requestId: pairs[i].requestId,
          model: pairs[i].model,
          intent: pairs[i].intent,
          estimated: pairs[i].est,
          actual: pairs[i].actual,
          errorPct: errorPcts[i],
        })
      }
    }
    outliers.sort((a, b) => Math.abs(b.errorPct) - Math.abs(a.errorPct))

    // Per-model drift
    const byModel = new Map<string, Pair[]>()
    for (const p of pairs) {
      if (!byModel.has(p.model)) byModel.set(p.model, [])
      byModel.get(p.model)!.push(p)
    }

    const modelDrifts: ModelDrift[] = []
    for (const [model, modelPairs] of byModel) {
      if (modelPairs.length < 3) continue
      const estMeanM = modelPairs.reduce((a, p) => a + p.est, 0) / modelPairs.length
      const actualMeanM = modelPairs.reduce((a, p) => a + p.actual, 0) / modelPairs.length
      const errPctsM = modelPairs.map(p => ((p.actual - p.est) / p.est) * 100)
      const absErrM = errPctsM.map(e => Math.abs(e))
      const mapeM = absErrM.reduce((a, b) => a + b, 0) / absErrM.length
      const medErrM = median(errPctsM)
      const mErrStddev = stddev(errPctsM)
      const outlierCount = errPctsM.filter(e => Math.abs(e) > 2 * mErrStddev).length
      modelDrifts.push({
        model,
        estMean: estMeanM,
        actualMean: actualMeanM,
        medianErrorPct: medErrM,
        mape: mapeM,
        biasClass: biasClass(medErrM),
        accuracyClass: accuracyClass(mapeM),
        sampleCount: modelPairs.length,
        outliers: outlierCount,
      })
    }
    modelDrifts.sort((a, b) => b.mape - a.mape)

    // Per-intent drift
    const byIntent = new Map<string, Pair[]>()
    for (const p of pairs) {
      if (!byIntent.has(p.intent)) byIntent.set(p.intent, [])
      byIntent.get(p.intent)!.push(p)
    }

    const intentDrifts: IntentDrift[] = []
    for (const [intent, intentPairs] of byIntent) {
      if (intentPairs.length < 3) continue
      const errPctsI = intentPairs.map(p => ((p.actual - p.est) / p.est) * 100)
      const absErrI = errPctsI.map(e => Math.abs(e))
      const mapeI = absErrI.reduce((a, b) => a + b, 0) / absErrI.length
      const medErrI = median(errPctsI)
      intentDrifts.push({
        intent,
        medianErrorPct: medErrI,
        mape: mapeI,
        biasClass: biasClass(medErrI),
        sampleCount: intentPairs.length,
      })
    }
    intentDrifts.sort((a, b) => Math.abs(b.medianErrorPct) - Math.abs(a.medianErrorPct))

    // Scatter points (max 40 to avoid perf issues)
    const scatterPoints = pairs.slice(0, 40).map(p => ({
      est: p.est,
      actual: p.actual,
      model: p.model,
    }))

    return {
      overallMape,
      overallMedianErrorPct,
      overallBiasClass: biasClass(overallMedianErrorPct),
      overallAccuracyClass: accuracyClass(overallMape),
      modelDrifts,
      intentDrifts,
      outliers: outliers.slice(0, 8),
      scatterPoints,
      windowSize: windowEntries.length,
    }
  }, [entries])

  const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
  const fmtNum = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : Math.round(v).toString()

  if (!stats) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '972ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT TOKEN DATA
        </div>
      </div>
    )
  }

  const { overallMape, overallMedianErrorPct, overallBiasClass, overallAccuracyClass, modelDrifts, intentDrifts, outliers, scatterPoints, windowSize } = stats

  const accMeta = ACCURACY_META[overallAccuracyClass]
  const biasMeta = BIAS_META[overallBiasClass]

  // Compute scatter plot dimensions
  const allEsts = scatterPoints.map(p => p.est)
  const allActuals = scatterPoints.map(p => p.actual)
  const scatterMin = 0
  const scatterMax = Math.max(...allEsts, ...allActuals) * 1.05
  const scatterRange = scatterMax - scatterMin || 1
  const SVG_W = 120
  const SVG_H = 100
  const toX = (est: number) => ((est - scatterMin) / scatterRange) * (SVG_W - 8) + 4
  const toY = (actual: number) => SVG_H - 4 - ((actual - scatterMin) / scatterRange) * (SVG_H - 8)

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '972ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Token Estimate Drift
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: accMeta.color,
            background: `${accMeta.color}15`,
            border: `1px solid ${accMeta.color}30`,
            borderRadius: 2, padding: '2px 5px',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {accMeta.label} MAPE
          </span>
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: biasMeta.color,
            background: `${biasMeta.color}15`,
            border: `1px solid ${biasMeta.color}30`,
            borderRadius: 2, padding: '2px 5px',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {biasMeta.label}
          </span>
        </div>
      </div>

      {/* Overall summary row */}
      <div style={{ display: 'flex', gap: '0.3rem', padding: '0.12rem 0.25rem', background: 'hsl(225 45% 8%)', borderRadius: 3 }}>
        {([
          { label: 'MAPE', value: `${overallMape.toFixed(1)}%`, color: accMeta.color },
          { label: 'Bias', value: fmtPct(overallMedianErrorPct), color: biasMeta.color },
          { label: 'Models', value: String(modelDrifts.length), color: 'var(--foreground)' },
          { label: 'Outliers', value: String(outliers.length), color: outliers.length > 0 ? 'hsl(25 95% 60%)' : 'hsl(145 65% 55%)' },
        ] as const).map(({ label, value, color }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center' }}>
            <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {label}
            </span>
            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 700, color, textShadow: `0 0 6px ${color}50` }}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Scatter plot + model table side by side */}
      <div style={{ display: 'flex', gap: '0.25rem' }}>
        {/* Scatter plot */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.08rem', width: 128, flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '4px', color: 'hsl(225 45% 20%)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Est vs Actual
          </span>
          <svg width={SVG_W} height={SVG_H} style={{ background: 'hsl(225 45% 8%)', borderRadius: 3, overflow: 'visible' }}>
            {/* Identity line (45 deg) */}
            <line
              x1={toX(0)} y1={toY(0)}
              x2={toX(scatterMax)} y2={toY(scatterMax)}
              stroke="hsl(225 45% 20%)" strokeWidth="0.5" strokeDasharray="2,2"
            />
            {/* Scatter dots */}
            {scatterPoints.map((p, i) => (
              <circle
                key={i}
                cx={toX(p.est)} cy={toY(p.actual)}
                r={1.5}
                fill={scatterColor(p.est, p.actual)}
                opacity={0.7}
              />
            ))}
            {/* Axis labels */}
            <text x={SVG_W - 2} y={SVG_H - 2} fontSize="3.5" fill="hsl(225 45% 25%)" fontFamily="var(--font-mono)" textAnchor="end">est</text>
            <text x={3} y={5} fontSize="3.5" fill="hsl(225 45% 25%)" fontFamily="var(--font-mono)">act</text>
          </svg>
          <div style={{ display: 'flex', gap: '0.2rem', justifyContent: 'center' }}>
            {([
              { color: 'hsl(145 65% 55%)', label: '≈' },
              { color: 'hsl(200 75% 55%)', label: '↑' },
              { color: 'hsl(25 95% 60%)', label: '↓' },
            ] as const).map(({ color, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.08rem' }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: color }} />
                <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Per-model drift table */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.06rem' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '4px', color: 'hsl(225 45% 20%)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Per-Model Drift
          </span>
          {/* Column header */}
          <div style={{ display: 'flex', gap: '0.1rem', padding: '0.04rem 0.08rem', borderBottom: '1px solid hsl(225 45% 12%)' }}>
            {['MODEL', 'EST→ACT', 'BIAS', 'MAPE', 'N'].map((h, i) => (
              <span key={h} style={{
                fontSize: '3.5px', fontFamily: 'var(--font-mono)',
                color: 'hsl(145 65% 40%)', letterSpacing: '0.04em',
                flex: i === 0 ? 1.5 : 1,
                textAlign: i >= 1 ? 'right' : 'left',
              }}>{h}</span>
            ))}
          </div>
          {modelDrifts.slice(0, 5).map((md) => {
            const bm = BIAS_META[md.biasClass]
            const am = ACCURACY_META[md.accuracyClass]
            return (
              <div key={md.model} style={{ display: 'flex', gap: '0.1rem', padding: '0.06rem 0.08rem', borderRadius: 2, alignItems: 'center' }}>
                <span style={{
                  flex: 1.5, fontSize: '5px', fontFamily: 'var(--font-mono)',
                  color: 'hsl(225 45% 50%)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {md.model}
                </span>
                <span style={{ flex: 1, fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 40%)', textAlign: 'right' }}>
                  {fmtNum(md.estMean)}→{fmtNum(md.actualMean)}
                </span>
                <span style={{ flex: 1, fontSize: '5px', fontFamily: 'var(--font-mono)', color: bm.color, textAlign: 'right', fontWeight: 700 }}>
                  {fmtPct(md.medianErrorPct)}
                </span>
                <span style={{ flex: 1, fontSize: '5px', fontFamily: 'var(--font-mono)', color: am.color, textAlign: 'right', fontWeight: 700 }}>
                  {md.mape.toFixed(1)}%
                </span>
                <span style={{ flex: 1, fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 30%)', textAlign: 'right' }}>
                  {md.sampleCount}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Per-intent drift row */}
      {intentDrifts.length > 0 && (
        <div style={{ display: 'flex', gap: '0.2rem', padding: '0.08rem 0.15rem', background: 'hsl(225 45% 8%)', borderRadius: 3 }}>
          {intentDrifts.slice(0, 4).map((id) => {
            const bm = BIAS_META[id.biasClass]
            return (
              <div key={id.intent} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.04rem' }}>
                <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 35%)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {id.intent.slice(0, 7)}
                </span>
                <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: bm.color, textShadow: `0 0 4px ${bm.color}50` }}>
                  {fmtPct(id.medianErrorPct)}
                </span>
                <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>
                  {id.sampleCount}s · {id.mape.toFixed(1)}%
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Outlier feed */}
      {outliers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.06rem' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '4px', color: 'hsl(25 95% 55%)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Outliers (&gt;2σ)
          </span>
          {outliers.slice(0, 4).map((o) => (
            <div key={o.requestId} style={{
              display: 'flex', gap: '0.15rem', padding: '0.06rem 0.12rem',
              background: 'hsl(25 95% 55% / 0.05)', borderRadius: 2,
              alignItems: 'center',
            }}>
              <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 40%)', flexShrink: 0 }}>
                {o.model.slice(0, 10)}
              </span>
              <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 35%)', flexShrink: 0 }}>
                {fmtNum(o.estimated)}→{fmtNum(o.actual)}
              </span>
              <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(25 95% 60%)', fontWeight: 700, marginLeft: 'auto' }}>
                {fmtPct(o.errorPct)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '5px',
        color: 'var(--muted-foreground)', textAlign: 'right', opacity: 0.7,
      }}>
        {windowSize} entries · MAPE = mean |error%| · n≥3 per model
      </div>
    </div>
  )
}
