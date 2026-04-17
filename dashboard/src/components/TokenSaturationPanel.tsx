import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

function getTotalTokens(tokensUsed: LogEntry['tokens_used']): number {
  if (tokensUsed == null) return 0
  if (typeof tokensUsed === 'number') {
    return Number.isFinite(tokensUsed) ? tokensUsed : 0
  }
  if (tokensUsed && typeof tokensUsed === 'object') {
    const input = typeof tokensUsed.input === 'number' && Number.isFinite(tokensUsed.input) ? tokensUsed.input : 0
    const output = typeof tokensUsed.output === 'number' && Number.isFinite(tokensUsed.output) ? tokensUsed.output : 0
    return input + output
  }
  return 0
}

type SaturationBucket = 'SPARSE' | 'NORMAL' | 'DENSE' | 'SATURATED'

function saturationColor(pct: number): string {
  if (pct <= 50) return 'hsl(145 65% 55%)' // green — <=50 aligns with SPARSE+NORMAL
  if (pct <= 80) return 'hsl(38 92% 55%)'  // yellow — DENSE bucket is 50<pct<=80
  return 'hsl(0 72% 55%)'                   // red — SATURATED is >80
}

function saturationLabel(pct: number): SaturationBucket {
  if (pct < 25) return 'SPARSE'
  if (pct < 50) return 'NORMAL'
  if (pct <= 80) return 'DENSE'
  return 'SATURATED'
}

const BUCKET_META: Record<SaturationBucket, { color: string; range: string }> = {
  SPARSE:    { color: 'hsl(145 65% 55%)', range: '<25%' },
  NORMAL:    { color: 'hsl(165 60% 50%)', range: '25–50%' },
  DENSE:     { color: 'hsl(38 92% 55%)',  range: '50–80%' },  // note: 80 is inclusive (≤80 = DENSE)
  SATURATED: { color: 'hsl(0 72% 55%)',   range: '>80%' },
}

function estimateContextWindow(modelName: string): number {
  const lower = (modelName ?? '').toLowerCase()
  if (lower.includes('gpt-4-32k')) return 32000
  if (lower.includes('gpt-4-128k') || lower.includes('gpt-4-turbo')) return 128000
  if (lower.includes('gpt-4')) return 32000
  if (lower.includes('gpt-3.5-turbo') && lower.includes('16k')) return 16000
  if (lower.includes('gpt-3.5')) return 4000
  if (lower.includes('claude-3-5') && (lower.includes('sonnet') || lower.includes('haiku'))) return 200000
  if (lower.includes('claude-3-5')) return 200000
  if (lower.includes('claude-3-opus') || lower.includes('claude-3-sonnet')) return 200000
  if (lower.includes('claude-3')) return 100000
  if (lower.includes('gemini-2') && (lower.includes('flash') || lower.includes('pro'))) return 128000
  if (lower.includes('gemini-1.5')) return 128000
  if (lower.includes('gemini')) return 32000
  if (lower.includes('o1') || lower.includes('o3')) return 128000
  return 128000 // default fallback
}

interface ModelSaturation {
  model: string
  maxTokens: number
  contextWindow: number
  saturationPct: number
  label: SaturationBucket
}

export function TokenSaturationPanel({ entries }: Props) {
  const { modelSaturations, bucketCounts, maxSaturation, avgSaturation, closestToLimit, hasData } = useMemo(() => {
    // Group entries by routed_model
    const byModel = new Map<string, number>()

    for (const entry of entries) {
      const tokens = getTotalTokens(entry.tokens_used)
      if (tokens <= 0) continue
      const model = entry.routed_model || entry.requested_model || 'unknown'
      const existing = byModel.get(model) || 0
      if (tokens > existing) byModel.set(model, tokens)
    }

    if (byModel.size === 0) {
      return {
        modelSaturations: [],
        bucketCounts: { SPARSE: 0, NORMAL: 0, DENSE: 0, SATURATED: 0 },
        maxSaturation: 0,
        avgSaturation: 0,
        closestToLimit: null as string | null,
        hasData: false,
      }
    }

    const modelSaturations: ModelSaturation[] = []
    for (const [model, maxTokens] of byModel) {
      const contextWindow = estimateContextWindow(model)
      const saturationPct = Math.min((maxTokens / contextWindow) * 100, 100)
      const label = saturationLabel(saturationPct)
      modelSaturations.push({ model, maxTokens, contextWindow, saturationPct, label })
    }

    // Sort by saturation % descending
    modelSaturations.sort((a, b) => b.saturationPct - a.saturationPct)

    // Bucket counts across all models
    const bucketCounts: Record<SaturationBucket, number> = {
      SPARSE: 0, NORMAL: 0, DENSE: 0, SATURATED: 0,
    }
    for (const ms of modelSaturations) bucketCounts[ms.label]++

    const maxSat = modelSaturations[0]?.saturationPct ?? 0
    const avgSat = modelSaturations.reduce((s, m) => s + m.saturationPct, 0) / modelSaturations.length
    const closest = modelSaturations.find(m => m.label === 'SATURATED')?.model
      ?? modelSaturations.find(m => m.label === 'DENSE')?.model
      ?? modelSaturations[0]?.model ?? null

    return {
      modelSaturations,
      bucketCounts,
      maxSaturation: maxSat,
      avgSaturation: avgSat,
      closestToLimit: closest,
      hasData: true,
    }
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
          animationDelay: '965ms',
        }}
      >
        <span style={{
          fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)',
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          NO TOKEN DATA
        </span>
      </div>
    )
  }

  // Top 8 models
  const topModels = modelSaturations.slice(0, 8)

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.4rem 0.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.2rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '965ms',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingBottom: '0.1rem',
      }}>
        <span style={{
          fontSize: '9px', fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)', textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Token Saturation
        </span>
        <span style={{
          fontSize: '5.5px', fontFamily: 'var(--font-mono)',
          color: 'hsl(225 45% 20%)',
        }}>
          {modelSaturations.length} models
        </span>
      </div>

      {/* Stats row */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '0.6rem',
        padding: '0.1rem 0.4rem 0.2rem',
        borderBottom: '1px solid hsl(225 45% 12%)',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.2rem' }}>
          <span style={{
            fontSize: '14px', fontFamily: 'var(--font-mono)',
            color: saturationColor(maxSaturation), fontWeight: 700,
            letterSpacing: '-0.02em',
            textShadow: `0 0 8px ${saturationColor(maxSaturation)}60`,
          }}>
            {maxSaturation.toFixed(1)}%
          </span>
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: 'var(--muted-foreground)', textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            max
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.15rem' }}>
          <span style={{
            fontSize: '9px', fontFamily: 'var(--font-mono)',
            color: saturationColor(avgSaturation), fontWeight: 600,
          }}>
            {avgSaturation.toFixed(1)}%
          </span>
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: 'hsl(225 45% 20%)', textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            avg
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.15rem', flex: 1, overflow: 'hidden' }}>
          <span style={{
            fontSize: '7px', fontFamily: 'var(--font-mono)',
            color: 'hsl(185 80% 50%)', fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {closestToLimit ?? '—'}
          </span>
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: 'hsl(225 45% 20%)', textTransform: 'uppercase',
            letterSpacing: '0.06em', flexShrink: 0,
          }}>
            at risk
          </span>
        </div>
      </div>

      {/* Per-model saturation bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.12rem' }}>
        {topModels.map(({ model, maxTokens, contextWindow, saturationPct, label }) => {
          const color = saturationColor(saturationPct)
          return (
            <div key={model} style={{
              display: 'flex', flexDirection: 'column', gap: '0.08rem',
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
                  flex: 1, height: 6, background: 'hsl(225 45% 10%)',
                  borderRadius: 3, overflow: 'hidden',
                  position: 'relative',
                }}>
                  <div style={{
                    width: `${saturationPct}%`,
                    height: '100%',
                    background: `linear-gradient(90deg, ${color}40, ${color}90)`,
                    borderRadius: 3,
                    boxShadow: `0 0 6px ${color}50, inset 0 1px 0 ${color}80`,
                    transition: 'width 600ms cubic-bezier(0.34, 1.2, 0.64, 1)',
                  }} />
                </div>
                <span style={{
                  fontSize: '5.5px', fontFamily: 'var(--font-mono)',
                  color,
                  width: 32, flexShrink: 0, textAlign: 'right',
                  fontWeight: 700,
                }}>
                  {saturationPct.toFixed(1)}%
                </span>
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.2rem', paddingLeft: 52,
              }}>
                <span style={{
                  fontSize: '4.5px', fontFamily: 'var(--font-mono)',
                  color: 'hsl(225 45% 18%)',
                }}>
                  {(maxTokens / 1000).toFixed(1)}K / {(contextWindow / 1000).toFixed(0)}K
                </span>
                <span style={{
                  fontSize: '4px', fontFamily: 'var(--font-mono)',
                  color: BUCKET_META[label].color,
                  letterSpacing: '0.04em',
                }}>
                  {label}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Bucket legend */}
      <div style={{
        display: 'flex', gap: '0.5rem', paddingTop: '0.1rem',
        borderTop: '1px solid hsl(225 45% 12%)', flexWrap: 'wrap',
      }}>
        {(Object.entries(BUCKET_META) as [SaturationBucket, typeof BUCKET_META[SaturationBucket]][]).map(([bucket, meta]) => (
          <div key={bucket} style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.08rem' }}>
              <div style={{
                width: 5, height: 5, borderRadius: '50%',
                background: meta.color,
                boxShadow: `0 0 4px ${meta.color}50`,
              }} />
              <span style={{
                fontSize: '4.5px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 30%)', letterSpacing: '0.04em',
              }}>
                {bucket}
              </span>
            </div>
            <span style={{
              fontSize: '4.5px', fontFamily: 'var(--font-mono)',
              color: meta.color, fontWeight: 700,
            }}>
              {bucketCounts[bucket]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
