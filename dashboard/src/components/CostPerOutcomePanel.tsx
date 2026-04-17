import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

type Pricing = { input: number; output: number }
type KnownTier = typeof TIERS[number]

// Per 1M tokens
const RAW_MODEL_PRICING: Record<string, Pricing> = {
  // MiniMax
  'mini-max': { input: 0.05, output: 0.10 },
  'minimax': { input: 0.05, output: 0.10 },
  'miniMax-M2.6-highspeed': { input: 0.05, output: 0.10 },
  'miniMax-M2.5-highspeed': { input: 0.05, output: 0.10 },
  'miniMax-M2.1-highspeed': { input: 0.05, output: 0.10 },
  'MiniMax-M2.6-highspeed': { input: 0.05, output: 0.10 },
  'MiniMax-M2.5-highspeed': { input: 0.05, output: 0.10 },
  'MiniMax-M2.1-highspeed': { input: 0.05, output: 0.10 },
  // GLM
  'glm-4': { input: 0.06, output: 0.12 },
  'glm-4.5': { input: 0.06, output: 0.12 },
  'glm-4.7': { input: 0.06, output: 0.12 },
  'glm-5': { input: 0.08, output: 0.16 },
  'glm-5.1': { input: 0.10, output: 0.20 },
  'zhipu': { input: 0.06, output: 0.12 },
  // OpenAI
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  // Anthropic
  'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku': { input: 0.80, output: 4.00 },
  'claude-3-opus': { input: 15.00, output: 75.00 },
  'claude-3-sonnet': { input: 3.00, output: 15.00 },
  // Google
  'gemini-2.0-flash': { input: 0.00, output: 0.00 },
  'gemini-1.5-flash': { input: 0.035, output: 0.14 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  // Others
  'o1-preview': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 3.00, output: 12.00 },
  'o3-mini': { input: 3.00, output: 12.00 },
}
const MODEL_PRICING = Object.freeze(
  Object.fromEntries(
    Object.entries(RAW_MODEL_PRICING).map(([key, value]) => [key.toLowerCase(), value]),
  ) as Record<string, Pricing>,
)
const DEFAULT_PRICING: Pricing = { input: 3.00, output: 15.00 }

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

function getModelPricing(modelName: string | null | undefined): Pricing {
  const normalized = modelName?.trim().toLowerCase()
  if (!normalized) return DEFAULT_PRICING
  return MODEL_PRICING[normalized] ?? DEFAULT_PRICING
}

function estimateCost(tokensUsed: LogEntry['tokens_used'], modelName: string | null | undefined): number {
  const pricing = getModelPricing(modelName)

  if (tokensUsed == null) return 0

  let cost = 0
  if (typeof tokensUsed === 'number') {
    const tokens = Number.isFinite(tokensUsed) ? tokensUsed : 0
    if (tokens <= 0) return 0
    cost = (tokens / 1_000_000) * (pricing.input + pricing.output)
  } else if (typeof tokensUsed === 'object') {
    const input = typeof tokensUsed.input === 'number' && Number.isFinite(tokensUsed.input) ? tokensUsed.input : 0
    const output = typeof tokensUsed.output === 'number' && Number.isFinite(tokensUsed.output) ? tokensUsed.output : 0
    if (input <= 0 && output <= 0) return 0
    cost = (input / 1_000_000) * pricing.input + (output / 1_000_000) * pricing.output
  }

  return Number.isFinite(cost) ? cost : 0
}

function isKnownTier(tier: string): tier is KnownTier {
  return TIERS.includes(tier as KnownTier)
}

function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0
  const ratio = numerator / denominator
  return Number.isFinite(ratio) ? ratio : 0
}

const TIER_COLORS = {
  tier1: 'hsl(280 65% 65%)',
  tier2: 'hsl(200 75% 60%)',
  tier3: 'hsl(145 65% 55%)',
}

const TIERS = ['tier1', 'tier2', 'tier3'] as const

export function CostPerOutcomePanel({ entries }: Props) {
  const metrics = useMemo(() => {
    let totalCost = 0
    const tierCosts: Record<KnownTier, number> = { tier1: 0, tier2: 0, tier3: 0 }
    const modelCostMap = new Map<string, { cost: number; count: number }>()
    const intentCosts: Record<string, number> = {}
    let savingsCost = 0
    let errorCost = 0
    let successCount = 0
    const trendPoints: Array<{ timestampMs: number; cost: number }> = []
    let earliestTime: number | null = null
    let latestTime: number | null = null

    for (const entry of entries) {
      const routedModel = typeof entry.routed_model === 'string' ? entry.routed_model.trim() : ''
      const cost = estimateCost(entry.tokens_used, routedModel)
      const tokens = getTotalTokens(entry.tokens_used)
      const status = Number.isFinite(entry.status) ? entry.status : 0
      const timestampMs = Number.isFinite(new Date(entry.timestamp).getTime())
        ? new Date(entry.timestamp).getTime()
        : null

      if (tokens > 0) {
        totalCost += cost

        // Tier cost
        const tier = typeof entry.routed_tier === 'string' ? entry.routed_tier.trim().toLowerCase() : ''
        if (isKnownTier(tier)) tierCosts[tier] += cost

        // Model cost
        if (routedModel) {
          const existing = modelCostMap.get(routedModel) ?? { cost: 0, count: 0 }
          modelCostMap.set(routedModel, { cost: existing.cost + cost, count: existing.count + 1 })
        }

        // Intent cost
        const intent = typeof entry.task_type === 'string' && entry.task_type.trim() ? entry.task_type.trim() : 'unknown'
        intentCosts[intent] = (intentCosts[intent] ?? 0) + cost

        // Error cost
        if (status >= 400) errorCost += cost

        // Savings vs requested
        const requestedModel = typeof entry.requested_model === 'string' ? entry.requested_model.trim() : ''
        if (requestedModel && requestedModel.toLowerCase() !== routedModel.toLowerCase()) {
          const requestedCost = estimateCost(entry.tokens_used, requestedModel)
          savingsCost += requestedCost - cost
        }

        // Success count
        if (status > 0 && status < 400) successCount++

        if (timestampMs !== null) {
          trendPoints.push({ timestampMs, cost })
        }
      }

      if (timestampMs !== null) {
        earliestTime = earliestTime === null ? timestampMs : Math.min(earliestTime, timestampMs)
        latestTime = latestTime === null ? timestampMs : Math.max(latestTime, timestampMs)
      }
    }

    // Top 6 models by cost
    const modelCosts = Array.from(modelCostMap.entries())
      .map(([model, data]) => ({ model, ...data }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 6)

    // Most expensive intent
    const mostExpensiveIntent = Object.entries(intentCosts)
      .sort(([, a], [, b]) => b - a)[0]?.[0] ?? null

    // Burn rate: totalCost / (time window in hours)
    let burnRate = 0
    if (earliestTime !== null && latestTime !== null && latestTime > earliestTime) {
      const dtHours = (latestTime - earliestTime) / (1000 * 60 * 60)
      burnRate = safeRatio(totalCost, dtHours)
    }

    // Cost trend: bucket costs into 10 equal time buckets across the observed time span.
    const costTrend: number[] = Array(10).fill(0)
    if (trendPoints.length > 0) {
      if (earliestTime !== null && latestTime !== null && latestTime > earliestTime) {
        const bucketWidth = (latestTime - earliestTime) / 10
        trendPoints.forEach(({ timestampMs, cost }) => {
          const bucket = Math.min(Math.floor((timestampMs - earliestTime) / bucketWidth), 9)
          costTrend[bucket] += cost
        })
      } else {
        costTrend[9] = trendPoints.reduce((sum, point) => sum + point.cost, 0)
      }
    }

    const costPerSuccess = safeRatio(totalCost, successCount)
    const hasData = totalCost > 0 || entries.some(e => getTotalTokens(e.tokens_used) > 0)
    const maxIntentCost = Math.max(...Object.values(intentCosts), 1)

    return {
      totalCost: Number.isFinite(totalCost) ? totalCost : 0,
      tierCosts,
      modelCosts,
      intentCosts,
      savingsCost: Number.isFinite(savingsCost) ? savingsCost : 0,
      errorCost: Number.isFinite(errorCost) ? errorCost : 0,
      burnRate: Number.isFinite(burnRate) ? burnRate : 0,
      costTrend,
      costPerSuccess,
      successCount,
      mostExpensiveIntent,
      maxIntentCost,
      hasData,
    }
  }, [entries])

  if (!metrics.hasData) {
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
          animationDelay: '966ms',
        }}
      >
        <span style={{
          fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)',
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          NO COST DATA
        </span>
      </div>
    )
  }

  const maxTierCost = Math.max(...TIERS.map(t => metrics.tierCosts[t]), 0.001)
  const maxTrend = Math.max(...metrics.costTrend, 0.001)
  const savingsSign = metrics.savingsCost >= 0 ? '+' : ''
  const panelVars = {
    '--cost-panel-bg': 'hsl(225 45% 8%)',
    '--cost-panel-border': 'hsl(225 45% 12%)',
    '--cost-panel-dim': 'hsl(225 45% 20%)',
    '--cost-panel-track': 'hsl(225 45% 10%)',
  } as const

  return (
    <div
      className="gs-panel"
      style={{
        ...panelVars,
        padding: '0.4rem 0.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.2rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '966ms',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: '9px', fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)', textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Cost Attribution
        </span>
        <span style={{
          fontSize: '5px', fontFamily: 'var(--font-mono)',
          color: 'hsl(225 45% 20%)',
        }}>
          $/1M tokens
        </span>
      </div>

      {/* Stats row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '0.25rem',
      }}>
        {/* Total Cost */}
        <div style={{
          padding: '0.2rem 0.3rem',
          borderRadius: 4,
          background: 'var(--cost-panel-bg)',
          border: '1px solid var(--cost-panel-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.05rem',
        }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Total Cost</span>
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'hsl(185 80% 50%)', textShadow: '0 0 8px hsl(185 80% 50% / 0.4)' }}>
            ${metrics.totalCost.toFixed(2)}
          </span>
        </div>

        {/* Burn Rate */}
        <div style={{
          padding: '0.2rem 0.3rem',
          borderRadius: 4,
          background: 'var(--cost-panel-bg)',
          border: '1px solid var(--cost-panel-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.05rem',
        }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Burn Rate</span>
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'hsl(38 92% 55%)', textShadow: '0 0 8px hsl(38 92% 55% / 0.3)' }}>
            ${metrics.burnRate.toFixed(2)}<span style={{ fontSize: '5px', color: 'var(--muted-foreground)' }}>/h</span>
          </span>
        </div>

        {/* Savings vs Requested */}
        <div style={{
          padding: '0.2rem 0.3rem',
          borderRadius: 4,
          background: 'var(--cost-panel-bg)',
          border: '1px solid var(--cost-panel-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.05rem',
        }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Savings vs Req.</span>
          <span style={{
            fontSize: '10px', fontFamily: 'var(--font-mono)', fontWeight: 700,
            color: metrics.savingsCost >= 0 ? 'hsl(145 65% 55%)' : 'hsl(0 72% 55%)',
            textShadow: `0 0 8px ${metrics.savingsCost >= 0 ? 'hsl(145 65% 55% / 0.4)' : 'hsl(0 72% 55% / 0.4)'}`,
          }}>
            {savingsSign}${metrics.savingsCost.toFixed(2)}
          </span>
        </div>

        {/* Cost/Success */}
        <div style={{
          padding: '0.2rem 0.3rem',
          borderRadius: 4,
          background: 'var(--cost-panel-bg)',
          border: '1px solid var(--cost-panel-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.05rem',
        }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>Cost/Success</span>
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--foreground)' }}>
            ${metrics.costPerSuccess.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Tier Cost Bar */}
      <div style={{
        display: 'flex',
        gap: '0.15rem',
        alignItems: 'flex-end',
        height: 32,
      }}>
        {TIERS.map(tier => {
          const cost = metrics.tierCosts[tier]
          const heightPct = (cost / maxTierCost) * 100
          const color = TIER_COLORS[tier]
          return (
            <div key={tier} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.1rem', height: '100%' }}>
              <span style={{ fontSize: '5.5px', fontFamily: 'var(--font-mono)', color: 'hsl(38 92% 55%)', fontWeight: 700 }}>
                ${cost.toFixed(2)}
              </span>
              <div style={{
                flex: 1,
                width: '100%',
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
              }}>
                <div style={{
                  width: '70%',
                  height: `${heightPct}%`,
                  background: `linear-gradient(180deg, ${color}80, ${color}40)`,
                  borderRadius: 2,
                  boxShadow: `0 0 6px ${color}40, inset 0 1px 0 ${color}60`,
                  transition: 'height 600ms cubic-bezier(0.34, 1.2, 0.64, 1)',
                  minHeight: 2,
                }} />
              </div>
              <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: color, fontWeight: 700 }}>
                {tier.replace('tier', 'T')}
              </span>
            </div>
          )
        })}
      </div>

      {/* Model Cost Leaderboard */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.08rem',
      }}>
        <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Model Costs
        </span>
        {metrics.modelCosts.length === 0 ? (
          <span style={{ fontSize: '5.5px', fontFamily: 'var(--font-mono)', color: 'var(--cost-panel-dim)' }}>—</span>
        ) : (
          metrics.modelCosts.map(({ model, cost, count }) => (
            <div key={model} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
              <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 40%)', width: 48, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {model}
              </span>
              <div style={{ flex: 1, height: 4, background: 'var(--cost-panel-track)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  width: `${safeRatio(cost, metrics.totalCost) * 100}%`,
                  height: '100%',
                  background: 'hsl(185 80% 50% / 0.6)',
                  borderRadius: 2,
                  boxShadow: '0 0 6px hsl(185 80% 50% / 0.25)',
                  transition: 'width 600ms ease',
                }} />
              </div>
              <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(185 80% 50%)', fontWeight: 700, width: 32, textAlign: 'right', flexShrink: 0 }}>
                ${cost.toFixed(2)}
              </span>
              <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)', width: 16, flexShrink: 0 }}>
                {count}x
              </span>
            </div>
          ))
        )}
      </div>

      {/* Intent Cost Breakdown */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.08rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Intent Costs
          </span>
          {metrics.mostExpensiveIntent && (
            <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(38 92% 55%)' }}>
              hottest: {metrics.mostExpensiveIntent}
            </span>
          )}
        </div>
        {Object.keys(metrics.intentCosts).length === 0 ? (
          <span style={{ fontSize: '5.5px', fontFamily: 'var(--font-mono)', color: 'var(--cost-panel-dim)' }}>—</span>
        ) : (
          Object.entries(metrics.intentCosts)
            .sort(([, a], [, b]) => b - a)
            .map(([intent, cost]) => {
              return (
                <div key={intent} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 40%)', width: 40, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {intent}
                  </span>
                  <div style={{ flex: 1, height: 4, background: 'var(--cost-panel-track)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                      width: `${safeRatio(cost, metrics.maxIntentCost) * 100}%`,
                      height: '100%',
                      background: 'hsl(280 65% 65% / 0.6)',
                      borderRadius: 2,
                      boxShadow: '0 0 6px hsl(280 65% 65% / 0.25)',
                      transition: 'width 600ms ease',
                    }} />
                  </div>
                  <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(280 65% 65%)', fontWeight: 700, width: 32, textAlign: 'right', flexShrink: 0 }}>
                    ${cost.toFixed(2)}
                  </span>
                </div>
              )
            })
        )}
      </div>

      {/* Cost Trend Sparkline */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.08rem' }}>
        <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Cost Trend
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem', height: 20 }}>
          {metrics.costTrend.map((cost, i) => {
            const heightPct = (cost / maxTrend) * 100
            const isLast = i === metrics.costTrend.length - 1
            return (
              <div key={i} style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', height: '100%' }}>
                <div style={{
                  width: '60%',
                  height: `${Math.max(heightPct, 4)}%`,
                  background: isLast ? 'hsl(185 80% 50%)' : 'hsl(225 45% 25%)',
                  borderRadius: 1,
                  boxShadow: isLast ? '0 0 4px hsl(185 80% 50% / 0.6)' : 'none',
                  transition: 'height 300ms ease',
                  minHeight: 2,
                }} />
              </div>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: '0.05rem',
        borderTop: '1px solid hsl(225 45% 12%)',
      }}>
        <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'var(--cost-panel-dim)' }}>
          source: per-model pricing table
        </span>
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          {metrics.errorCost > 0 && (
            <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(0 72% 55%)' }}>
              err: ${metrics.errorCost.toFixed(2)}
            </span>
          )}
          <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'var(--cost-panel-dim)' }}>
            {metrics.successCount} ok
          </span>
        </div>
      </div>
    </div>
  )
}
