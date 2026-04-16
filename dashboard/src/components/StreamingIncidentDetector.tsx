import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const FIVE_MIN_MS = 5 * 60 * 1000
const MIN_SAMPLES = 10
const MAX_ENTRIES = 25
const SPARKLINE_LIMIT = 20

type SignalStatus = 'OK' | 'WARNING' | 'CRITICAL'
type IncidentState = 'NOMINAL' | 'WATCH' | 'DEGRADED' | 'TRIPLE COLLAPSE'

interface TimedLogEntry {
  entry: LogEntry
  timestampMs: number
}

interface DeltaValue {
  value: number
  hasBaseline: boolean
}

function getTotalTokens(tokensUsed: LogEntry['tokens_used']): number {
  if (tokensUsed == null) return 0
  if (typeof tokensUsed === 'number') return Number.isFinite(tokensUsed) ? tokensUsed : 0
  if (tokensUsed && typeof tokensUsed === 'object') {
    const input = typeof tokensUsed.input === 'number' && Number.isFinite(tokensUsed.input) ? tokensUsed.input : 0
    const output = typeof tokensUsed.output === 'number' && Number.isFinite(tokensUsed.output) ? tokensUsed.output : 0
    return input + output
  }
  return 0
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  const valid = arr.filter(Number.isFinite)
  if (valid.length === 0) return 0
  return valid.reduce((a, b) => a + b, 0) / valid.length
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function parseTimestamp(timestamp: string | null | undefined): number | null {
  if (typeof timestamp !== 'string' || timestamp.length === 0) return null
  const parsed = new Date(timestamp).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function getPositiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

const STATUS_COLOR: Record<SignalStatus, string> = {
  OK: 'hsl(145 65% 55%)',
  WARNING: 'hsl(45 85% 55%)',
  CRITICAL: 'hsl(0 72% 55%)',
}

function Sparkline({ values, color, width = 100, height = 24 }: { values: number[]; color: string; width?: number; height?: number }) {
  const finiteValues = values.filter(Number.isFinite)
  if (finiteValues.length < 2) return <svg width={width} height={height} />
  const min = Math.min(...finiteValues)
  const max = Math.max(...finiteValues)
  const range = max - min || 1
  const xScale = Math.max(width - 1, 1)
  const yScale = Math.max(height - 2, 1)
  const pts = finiteValues.map((v, i) => {
    const x = finiteValues.length === 1 ? 0 : (i / (finiteValues.length - 1)) * xScale
    const y = 1 + (yScale - ((v - min) / range) * yScale)
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function StreamingIncidentDetector({ entries }: { entries: LogEntry[] }) {
  const { window, priorEntries, streamingCount } = useMemo(() => {
    const now = Date.now()
    const timedEntries: TimedLogEntry[] = entries
      .map((entry) => {
        const timestampMs = parseTimestamp(entry.timestamp)
        return timestampMs == null ? null : { entry, timestampMs }
      })
      .filter((item): item is TimedLogEntry => item != null)
      .sort((a, b) => b.timestampMs - a.timestampMs)

    const recentEntries = timedEntries.filter(({ timestampMs }) => {
      const ageMs = now - timestampMs
      return ageMs >= 0 && ageMs <= FIVE_MIN_MS
    })
    const hasFreshData = recentEntries.length > 0
    const sourceEntries = hasFreshData ? recentEntries : timedEntries.slice(0, Math.min(MIN_SAMPLES, timedEntries.length))
    const currentWindow = sourceEntries.slice(0, MAX_ENTRIES).map(({ entry }) => entry)
    const previousWindow = sourceEntries.slice(MAX_ENTRIES, MAX_ENTRIES * 2).map(({ entry }) => entry)
    const streamCount = currentWindow.filter((entry) => entry.is_stream).length

    return { window: currentWindow, priorEntries: previousWindow, streamingCount: streamCount }
  }, [entries])

  const { ttftStatus, avgTTFT, ttftSparkValues, ttftDelta,
    tputStatus, avgThroughput, tputSparkValues, tputDelta,
    errorStatus, errorRate, errorDelta, errorSparkValues,
    severity, state, rec, windowSize } = useMemo(() => {
    // TTFT
    const streamEntries = window.filter((entry) => entry.is_stream)
    const ttfts = streamEntries
      .map((entry) => getPositiveNumber(entry.ttft_ms))
      .filter((value): value is number => value != null)
    const avgT = mean(ttfts)
    const ttftS: SignalStatus = avgT > 3000 ? 'CRITICAL' : avgT > 1000 ? 'WARNING' : 'OK'
    const ttftSc = clamp((avgT / 5000) * 100, 0, 100)

    // Throughput
    const throughputs = streamEntries
      .map((entry) => {
        const tokens = getTotalTokens(entry.tokens_used)
        const latencyMs = getPositiveNumber(entry.latency_ms)
        if (!Number.isFinite(tokens) || tokens <= 0 || latencyMs == null) return null
        const throughput = tokens / (latencyMs / 1000)
        return Number.isFinite(throughput) ? throughput : null
      })
      .filter((value): value is number => value != null)
    const avgTp = mean(throughputs)
    const tputS: SignalStatus = avgTp < 5 ? 'CRITICAL' : avgTp < 15 ? 'WARNING' : 'OK'
    const tputSc = clamp(((15 - avgTp) / 15) * 100, 0, 100)

    // Error rate
    const errorEntries = window.filter((entry) => entry.status >= 400)
    const errRate = window.length > 0 ? errorEntries.length / window.length : 0
    const errS: SignalStatus = errRate > 0.15 ? 'CRITICAL' : errRate > 0.05 ? 'WARNING' : 'OK'
    const errSc = clamp((errRate / 0.25) * 100, 0, 100)
    const errorSpark = window
      .slice(-SPARKLINE_LIMIT)
      .map((entry) => (entry.status >= 400 ? 1 : 0))
      .reverse()

    // Composite severity
    let rawSev = (ttftSc * 0.35) + (tputSc * 0.35) + (errSc * 0.30)
    rawSev = Number.isFinite(rawSev) ? rawSev : 0
    const sev = clamp(errS === 'CRITICAL' ? Math.max(rawSev, 80) : rawSev, 0, 100)

    // Incident state
    const critCount = [ttftS, tputS, errS].filter(s => s === 'CRITICAL').length
    let st: IncidentState
    if (critCount === 3) st = 'TRIPLE COLLAPSE'
    else if (critCount === 2) st = 'DEGRADED'
    else if (critCount === 1) st = 'WATCH'
    else st = 'NOMINAL'

    // Prior calcs
    const priorTTFTs = priorEntries
      .filter((entry) => entry.is_stream)
      .map((entry) => getPositiveNumber(entry.ttft_ms))
      .filter((value): value is number => value != null)
    const priorTputs = priorEntries
      .filter((entry) => entry.is_stream)
      .map((entry) => {
        const tokens = getTotalTokens(entry.tokens_used)
        const latencyMs = getPositiveNumber(entry.latency_ms)
        if (!Number.isFinite(tokens) || tokens <= 0 || latencyMs == null) return null
        const throughput = tokens / (latencyMs / 1000)
        return Number.isFinite(throughput) ? throughput : null
      })
      .filter((value): value is number => value != null)
    const priorErrors = priorEntries.filter((entry) => entry.status >= 400)
    const priorAvgTTFT = mean(priorTTFTs)
    const priorAvgTput = mean(priorTputs)
    const priorErrRate = priorEntries.length > 0 ? priorErrors.length / priorEntries.length : 0
    const tDelta: DeltaValue = {
      value: avgT - priorAvgTTFT,
      hasBaseline: priorTTFTs.length > 0,
    }
    const tpDelta: DeltaValue = {
      value: avgTp - priorAvgTput,
      hasBaseline: priorTputs.length > 0,
    }
    const errDelta: DeltaValue = {
      value: errRate - priorErrRate,
      hasBaseline: priorEntries.length > 0,
    }

    // Recommendation
    let recommendation: string
    if (st === 'TRIPLE COLLAPSE') recommendation = 'Triple collapse — severe provider outage, consider failover'
    else if (st === 'DEGRADED') {
      if (ttftS === 'CRITICAL' && tputS === 'CRITICAL') recommendation = 'Slow generation + low throughput — possible provider or model bottleneck'
      else if (tputS === 'CRITICAL' && errS === 'CRITICAL') recommendation = 'Throughput drop + errors — possible model overload or network issue'
      else if (ttftS === 'CRITICAL' && errS === 'CRITICAL') recommendation = 'High latency + errors — requests stalling, possible provider saturation'
      else recommendation = 'Multiple streaming signals degraded — monitor closely'
    }
    else if (st === 'WATCH') {
      if (ttftS === 'CRITICAL' || ttftS === 'WARNING') recommendation = 'TTFT elevated — watch for throughput impact'
      else if (tputS === 'CRITICAL' || tputS === 'WARNING') recommendation = 'Low throughput detected — may be long responses or model load'
      else recommendation = 'Error rate slightly elevated — monitor for escalation'
    }
    else recommendation = 'All streaming signals within normal range'

    return {
      ttftStatus: ttftS, avgTTFT: avgT,
      ttftSparkValues: ttfts.slice(-SPARKLINE_LIMIT).reverse(),
      tputStatus: tputS, avgThroughput: avgTp,
      tputSparkValues: throughputs.slice(-SPARKLINE_LIMIT).reverse(),
      errorStatus: errS, errorRate: errRate,
      errorSparkValues: errorSpark,
      severity: sev, state: st, rec: recommendation,
      ttftDelta: tDelta, tputDelta: tpDelta, errorDelta: errDelta,
      windowSize: window.length,
    }
  }, [window, priorEntries])

  const severityColor = severity < 40 ? STATUS_COLOR.OK : severity < 70 ? STATUS_COLOR.WARNING : STATUS_COLOR.CRITICAL
  const severityPct = `${clamp(severity, 0, 100)}%`

  const stateBadgeColor = state === 'NOMINAL' ? STATUS_COLOR.OK
    : state === 'WATCH' ? STATUS_COLOR.WARNING
    : state === 'DEGRADED' ? 'hsl(45 85% 55%)'
    : STATUS_COLOR.CRITICAL

  const formatTTFT = (v: number) => `${Math.round(v).toLocaleString()}ms`
  const formatTput = (v: number) => `${v.toFixed(1)} tok/s`
  const formatErr = (v: number) => `${(v * 100).toFixed(1)}%`

  const deltaStr = ({ value, hasBaseline }: DeltaValue, fmt: 'ttft' | 'tput' | 'err') => {
    if (!hasBaseline || value === 0 || !Number.isFinite(value)) return ''
    const sign = value > 0 ? '+' : ''
    if (fmt === 'ttft') return `${sign}${Math.round(value).toLocaleString()}ms`
    if (fmt === 'tput') return `${sign}${value.toFixed(1)} tok/s`
    return `${sign}${(value * 100).toFixed(1)}%`
  }

  const deltaColor = ({ value, hasBaseline }: DeltaValue, worsePositive: boolean) => {
    if (!hasBaseline || value === 0 || !Number.isFinite(value)) return 'var(--muted-foreground)'
    const worse = worsePositive ? value > 0 : value < 0
    return worse ? 'hsl(0 72% 55%)' : 'hsl(145 65% 55%)'
  }

  if (streamingCount === 0) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '960ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {window.length === 0 ? 'NO STREAMING DATA' : 'NO STREAMING ENTRIES'}
        </div>
      </div>
    )
  }

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.2rem', animation: 'fade-in-up 400ms ease both', animationDelay: '960ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          STREAMING INCIDENT
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '6px',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          padding: '2px 6px',
          borderRadius: '2px',
          background: state === 'TRIPLE COLLAPSE' ? 'hsl(0 72% 20%)' : 'transparent',
          color: stateBadgeColor,
          boxShadow: state === 'TRIPLE COLLAPSE' ? '0 0 8px hsl(0 72% 55%)' : 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}>
          {state === 'TRIPLE COLLAPSE' && (
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
            SEVERITY
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '7px', fontWeight: 600, color: severityColor, textShadow: `0 0 8px ${severityColor}40` }}>
            {Math.round(severity)}
          </span>
        </div>
        <div style={{ background: 'hsl(225 45% 10%)', height: '4px', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{
            width: severityPct,
            height: '100%',
            background: severityColor,
            transition: 'width 0.5s ease, background 0.3s ease',
          }} />
        </div>
      </div>

      {/* TTFT row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-mono)', fontSize: '6px' }}>
        <span style={{ width: '52px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)' }}>TTFT</span>
        <span style={{ padding: '1px 4px', borderRadius: '2px', background: `${STATUS_COLOR[ttftStatus]}20`, color: STATUS_COLOR[ttftStatus], fontSize: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {ttftStatus}
        </span>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <Sparkline values={ttftSparkValues} color={STATUS_COLOR[ttftStatus]} />
        </div>
        <div style={{ textAlign: 'right', minWidth: '52px' }}>
          <div style={{ color: 'var(--foreground)', fontSize: '7px' }}>{formatTTFT(avgTTFT)}</div>
          {ttftDelta.hasBaseline && ttftDelta.value !== 0 && (
            <div style={{ color: deltaColor(ttftDelta, true), fontSize: '5px' }}>
              {deltaStr(ttftDelta, 'ttft')}
            </div>
          )}
        </div>
      </div>

      {/* Throughput row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-mono)', fontSize: '6px' }}>
        <span style={{ width: '52px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)' }}>THROUGHPUT</span>
        <span style={{ padding: '1px 4px', borderRadius: '2px', background: `${STATUS_COLOR[tputStatus]}20`, color: STATUS_COLOR[tputStatus], fontSize: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {tputStatus}
        </span>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <Sparkline values={tputSparkValues} color={STATUS_COLOR[tputStatus]} />
        </div>
        <div style={{ textAlign: 'right', minWidth: '52px' }}>
          <div style={{ color: 'var(--foreground)', fontSize: '7px' }}>{formatTput(avgThroughput)}</div>
          {tputDelta.hasBaseline && tputDelta.value !== 0 && (
            <div style={{ color: deltaColor(tputDelta, false), fontSize: '5px' }}>
              {deltaStr(tputDelta, 'tput')}
            </div>
          )}
        </div>
      </div>

      {/* Error rate row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-mono)', fontSize: '6px' }}>
        <span style={{ width: '52px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)' }}>ERROR RATE</span>
        <span style={{ padding: '1px 4px', borderRadius: '2px', background: `${STATUS_COLOR[errorStatus]}20`, color: STATUS_COLOR[errorStatus], fontSize: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {errorStatus}
        </span>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <Sparkline values={errorSparkValues} color={STATUS_COLOR[errorStatus]} />
        </div>
        <div style={{ textAlign: 'right', minWidth: '52px' }}>
          <div style={{ color: 'var(--foreground)', fontSize: '7px' }}>{formatErr(errorRate)}</div>
          {errorDelta.hasBaseline && errorDelta.value !== 0 && (
            <div style={{ color: deltaColor(errorDelta, true), fontSize: '5px' }}>
              {deltaStr(errorDelta, 'err')}
            </div>
          )}
        </div>
      </div>

      {/* Recommendation */}
      {state !== 'NOMINAL' && (
        <div style={{
          width: '100%',
          padding: '0.25rem 0.35rem',
          marginTop: '0.1rem',
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
        window: {windowSize} entries / {streamingCount} streaming
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
