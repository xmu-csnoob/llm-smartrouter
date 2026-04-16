import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

type RiskLevel = 'SAFE' | 'WATCH' | 'RISK' | 'CRITICAL'

const RISK_META: Record<RiskLevel, { color: string; bg: string; label: string }> = {
  SAFE:    { color: 'hsl(145 65% 55%)', bg: 'hsl(145 65% 55% / 0.15)',  label: '<50%' },
  WATCH:   { color: 'hsl(38 92% 55%)',  bg: 'hsl(38 92% 55% / 0.15)',   label: '50–80%' },
  RISK:    { color: 'hsl(25 95% 60%)',  bg: 'hsl(25 95% 60% / 0.15)',  label: '80–95%' },
  CRITICAL:{ color: 'hsl(0 72% 55%)',   bg: 'hsl(0 72% 55% / 0.15)',   label: '>95%' },
}

// Normalize model name aliases to a canonical key
function normalizeModel(model: string): string {
  const lower = model.trim().toLowerCase()
  if (!lower) return 'unknown'

  if (lower.includes('gpt-4-0314') || lower.includes('gpt-4-0613')) return 'gpt-4-base'
  if (lower.includes('gpt-4-32k')) return 'gpt-4-32k'
  if (lower.includes('gpt-4-turbo') || lower.includes('gpt-4-0125') || lower.includes('gpt-4-1106')) return 'gpt-4-turbo'
  if (lower.includes('gpt-4o-mini') || lower.includes('gpt-4o') || lower.includes('gpt-4.1')) return 'gpt-4o'
  if (lower.includes('gpt-3.5-turbo') && lower.includes('16k')) return 'gpt-3.5-turbo-16k'
  if (lower.includes('gpt-3.5')) return 'gpt-3.5-turbo'

  if (lower.includes('claude-3.7-sonnet')) return 'claude-3.5-sonnet'
  if (lower.includes('claude-3.5-sonnet')) return 'claude-3.5-sonnet'
  if (lower.includes('claude-3.5-haiku')) return 'claude-3-haiku'
  if (lower.includes('claude-3-opus')) return 'claude-3-opus'
  if (lower.includes('claude-3-sonnet')) return 'claude-3-sonnet'
  if (lower.includes('claude-3-haiku')) return 'claude-3-haiku'

  if (lower.includes('gemini-2.5')) return 'gemini-2-flash'
  if (lower.includes('gemini-2') && (lower.includes('flash') || lower.includes('pro'))) return 'gemini-2-flash'
  if (lower.includes('gemini-1.5-pro')) return 'gemini-1.5-pro'
  if (lower.includes('gemini-1.5-flash')) return 'gemini-1.5-pro'
  if (lower.includes('gemini')) return 'gemini-default'

  if (lower.includes('o1-preview') || lower.includes('o1-pro')) return 'o1-preview'
  if (lower.includes('o1-mini') || lower.includes('o3-mini')) return 'o1-mini'
  if (lower.includes('minimax') && lower.includes('abab')) return 'minimax-abab'
  if (lower.includes('glm-4') || lower.includes('glm-3')) return 'glm-4'
  return 'unknown'
}

const OUTPUT_LIMITS: Record<string, number> = {
  'gpt-4-base':       8192,
  'gpt-4-32k':        32768,
  'gpt-4-turbo':      8192,
  'gpt-4o':           16384,
  'gpt-3.5-turbo-16k': 4096,
  'gpt-3.5-turbo':    4096,
  'claude-3-opus':    4096,
  'claude-3-sonnet':  4096,
  'claude-3.5-sonnet': 8192,
  'claude-3-haiku':   4096,
  'gemini-2-flash':   8192,
  'gemini-1.5-pro':   8192,
  'gemini-default':   8192,
  'o1-preview':       32768,
  'o1-mini':          65536,
  'minimax-abab':    4096,
  'glm-4':            4096,
  'unknown':          4096,
}

function getOutputTokens(tokensUsed: LogEntry['tokens_used']): number | null {
  if (tokensUsed == null) return null
  if (typeof tokensUsed === 'number') {
    return Number.isFinite(tokensUsed) && tokensUsed >= 0 ? tokensUsed : null
  }
  if (typeof tokensUsed === 'object') {
    const out = tokensUsed.output
    return typeof out === 'number' && Number.isFinite(out) && out >= 0 ? out : null
  }
  return null
}

function p95(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.ceil(sorted.length * 0.95) - 1
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))] ?? 0
}

function riskLevel(pct: number): RiskLevel {
  if (pct < 50) return 'SAFE'
  if (pct < 80) return 'WATCH'
  if (pct < 95) return 'RISK'
  return 'CRITICAL'
}

interface ModelRisk {
  model: string
  canonicalKey: string
  outputLimit: number
  avgOutput: number
  p95Output: number
  maxOutput: number
  riskPct: number
  riskLevel: RiskLevel
  sampleCount: number
  totalRequests: number
}

export function OutputTruncationRiskAdvisor({ entries }: Props) {
  const { modelRisks, bucketCounts, atRiskCount, overallRisk, hasData } = useMemo(() => {
    const byModel = new Map<string, number[]>()
    const totalByModel = new Map<string, number>()

    for (const entry of entries) {
      const model = entry.routed_model || entry.requested_model || 'unknown'
      const output = getOutputTokens(entry.tokens_used)

      if (!byModel.has(model)) {
        byModel.set(model, [])
        totalByModel.set(model, 0)
      }
      totalByModel.set(model, (totalByModel.get(model) ?? 0) + 1)
      if (output != null) {
        byModel.get(model)!.push(output)
      }
    }

    if (byModel.size === 0) {
      return { modelRisks: [], bucketCounts: { SAFE: 0, WATCH: 0, RISK: 0, CRITICAL: 0 }, atRiskCount: 0, overallRisk: 0, hasData: false }
    }

    const modelRisks: ModelRisk[] = []
    let totalAtRisk = 0
    let totalPctSum = 0
    let modelWithOutputCount = 0

    for (const [model, outputs] of byModel) {
      const canonicalKey = normalizeModel(model)
      const limit = OUTPUT_LIMITS[canonicalKey] ?? 4096
      const sampleCount = outputs.length
      const totalRequests = totalByModel.get(model) ?? 0
      if (sampleCount === 0) continue

      const avgOutput = sampleCount > 0 ? outputs.reduce((a, b) => a + b, 0) / sampleCount : 0
      const maxOutput = sampleCount > 0 ? Math.max(...outputs) : 0
      const p95Output = p95(outputs)
      // Risk based on P95 output vs limit
      const rawRiskPct = limit > 0 ? (p95Output / limit) * 100 : 0
      const riskPct = Number.isFinite(rawRiskPct) ? Math.max(0, Math.min(rawRiskPct, 100)) : 0
      const rl = riskLevel(riskPct)

      modelRisks.push({ model, canonicalKey, outputLimit: limit, avgOutput, p95Output, maxOutput, riskPct, riskLevel: rl, sampleCount, totalRequests })

      if (rl === 'RISK' || rl === 'CRITICAL') totalAtRisk++
      totalPctSum += riskPct
      modelWithOutputCount++
    }

    if (modelWithOutputCount === 0) {
      return { modelRisks: [], bucketCounts: { SAFE: 0, WATCH: 0, RISK: 0, CRITICAL: 0 }, atRiskCount: 0, overallRisk: 0, hasData: false }
    }

    // Sort by riskPct descending
    modelRisks.sort((a, b) => b.riskPct - a.riskPct)

    const bucketCounts = { SAFE: 0, WATCH: 0, RISK: 0, CRITICAL: 0 }
    for (const mr of modelRisks) bucketCounts[mr.riskLevel]++

    const overallRisk = modelWithOutputCount > 0 ? totalPctSum / modelWithOutputCount : 0

    return { modelRisks, bucketCounts, atRiskCount: totalAtRisk, overallRisk, hasData: true }
  }, [entries])

  if (!hasData) {
    return (
      <div
        className="gs-panel"
        style={{
          padding: '0.4rem 0.5rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 80,
          animation: 'fade-in-up 400ms ease both',
          animationDelay: '967ms',
        }}
      >
        <span style={{
          fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)',
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          NO OUTPUT TOKEN DATA
        </span>
      </div>
    )
  }

  const topModels = modelRisks.slice(0, 7)
  const overallRiskLevel = riskLevel(overallRisk)
  const overallMeta = RISK_META[overallRiskLevel]

  const fmtNum = (v: number) => {
    if (!Number.isFinite(v)) return '0'
    return v >= 1000 ? `${(v / 1000).toFixed(1)}K` : Math.round(v).toString()
  }

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.4rem 0.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.2rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '967ms',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: '9px', fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)', textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Output Truncation Risk
        </span>
        <span style={{
          fontSize: '5.5px', fontFamily: 'var(--font-mono)',
          color: overallMeta.color,
          background: overallMeta.bg,
          border: `1px solid ${overallMeta.color}40`,
          borderRadius: 3,
          padding: '2px 6px',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          {overallRiskLevel} {overallMeta.label}
        </span>
      </div>

      {/* Overall stats */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        padding: '0.15rem 0.3rem',
        background: 'hsl(225 45% 8%)',
        borderRadius: 3,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center' }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Avg Risk</span>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: overallMeta.color, textShadow: `0 0 6px ${overallMeta.color}50` }}>
            {overallRisk.toFixed(1)}%
          </span>
        </div>
        <div style={{ width: 1, background: 'var(--border)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center' }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>At Risk</span>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: atRiskCount > 0 ? 'hsl(25 95% 60%)' : 'hsl(145 65% 60%)', textShadow: atRiskCount > 0 ? '0 0 6px hsl(25 95% 55% / 0.5)' : '0 0 6px hsl(145 65% 48% / 0.5)' }}>
            {atRiskCount}
          </span>
        </div>
        <div style={{ width: 1, background: 'var(--border)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center' }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Tracked</span>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--foreground)' }}>
            {modelRisks.length}
          </span>
        </div>
        {/* Bucket dots */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', flex: 1 }}>
          {(Object.entries(RISK_META) as [RiskLevel, typeof RISK_META[RiskLevel]][]).map(([level, meta]) => (
            <div key={level} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.05rem' }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: meta.color, boxShadow: `0 0 4px ${meta.color}50` }} />
              <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: meta.color, fontWeight: 700 }}>
                {bucketCounts[level]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Per-model rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.12rem' }}>
        {topModels.map(({ model, outputLimit, avgOutput, p95Output, maxOutput, riskPct, riskLevel: rl, sampleCount, totalRequests }) => {
          const meta = RISK_META[rl]
          const coverage = totalRequests > 0 ? sampleCount / totalRequests : 0
          const coverageLabel = totalRequests > 0 ? `${Math.round(coverage * 100)}% cov` : '0% cov'
          return (
            <div key={model} style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.06rem',
              padding: '0.15rem 0.2rem',
              borderRadius: 3,
              background: rl === 'CRITICAL' ? 'hsl(0 72% 55% / 0.06)' : rl === 'RISK' ? 'hsl(25 95% 55% / 0.05)' : 'transparent',
              border: `1px solid ${rl === 'CRITICAL' || rl === 'RISK' ? meta.color + '30' : 'transparent'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                <span style={{
                  fontSize: '5.5px', fontFamily: 'var(--font-mono)',
                  color: 'hsl(225 45% 40%)',
                  width: 52, flexShrink: 0, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {model}
                </span>
                <div style={{
                  flex: 1, height: 5, background: 'hsl(225 45% 10%)',
                  borderRadius: 3, overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${riskPct}%`,
                    height: '100%',
                    background: `linear-gradient(90deg, ${meta.color}40, ${meta.color}90)`,
                    borderRadius: 3,
                    boxShadow: `0 0 4px ${meta.color}40`,
                    transition: 'width 600ms cubic-bezier(0.34, 1.2, 0.64, 1)',
                  }} />
                </div>
                <span style={{
                  fontSize: '5.5px', fontFamily: 'var(--font-mono)',
                  color: meta.color, width: 28, flexShrink: 0, textAlign: 'right', fontWeight: 700,
                }}>
                  {riskPct.toFixed(1)}%
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', paddingLeft: 52 }}>
                <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 18%)' }}>
                  avg {fmtNum(avgOutput)} · P95 {fmtNum(p95Output)} · max {fmtNum(maxOutput)}
                </span>
                <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>
                  / {fmtNum(outputLimit)} cap
                </span>
                <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>
                  {coverageLabel} ({sampleCount}/{totalRequests})
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', paddingTop: '0.1rem', borderTop: '1px solid hsl(225 45% 12%)' }}>
        {(Object.entries(RISK_META) as [RiskLevel, typeof RISK_META[RiskLevel]][]).map(([level, meta]) => (
          <div key={level} style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: meta.color, boxShadow: `0 0 3px ${meta.color}40` }} />
            <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 30%)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              {level}
            </span>
            <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: meta.color, fontWeight: 700 }}>
              {meta.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
