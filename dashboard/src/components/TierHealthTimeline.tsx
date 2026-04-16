import { useMemo } from 'react'
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

interface ModelWindow {
  model: string
  tier: string
  points: { time: number; health: number; latency: number; errorRate: number }[]
}

const TIER_COLORS: Record<string, string> = {
  tier1: 'hsl(280 65% 60%)',
  tier2: 'hsl(200 75% 55%)',
  tier3: 'hsl(145 65% 48%)',
}

function computeHealth(latency: number, errorRate: number): number {
  // health 0-100: lower latency is better, lower error rate is better
  // latency score: 100 at 0ms, 50 at 5000ms, 0 at 10000ms+
  const latencyScore = Math.max(0, 100 - (latency / 100))
  // error score: 100 at 0%, 50 at 10%+, 0 at 50%+
  const errorScore = Math.max(0, 100 - errorRate * 2)
  return Math.round(latencyScore * 0.6 + errorScore * 0.4)
}

export function TierHealthTimeline({ entries }: Props) {
  const { windows } = useMemo(() => {
    const now = Date.now()
    const windowMs = 30 * 60 * 1000 // 30 minutes
    const bucketMs = 2 * 60 * 1000  // 2-minute buckets

    // Group entries by model
    const byModel: Record<string, LogEntry[]> = {}
    for (const entry of entries) {
      const m = entry.routed_model || 'unknown'
      if (!byModel[m]) byModel[m] = []
      byModel[m].push(entry)
    }

    // For each model, compute sliding window health per bucket
    const modelWindows: ModelWindow[] = []
    const MAX_MODELS = 8

    Object.entries(byModel)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, MAX_MODELS)
      .forEach(([model, modelEntries]) => {
        const tier = modelEntries[0]?.routed_tier || 'tier2'
        const points: ModelWindow['points'] = []

        for (let t = now - windowMs; t <= now; t += bucketMs) {
          const bucketEntries = modelEntries.filter(e => {
            const et = new Date(e.timestamp).getTime()
            return et >= t - bucketMs && et < t
          })
          if (bucketEntries.length === 0) continue

          const avgLatency = bucketEntries.reduce((s, e) => s + (e.latency_ms || 0), 0) / bucketEntries.length
          const errorRate = bucketEntries.filter(e => e.status >= 400 || e.error).length / bucketEntries.length
          const health = computeHealth(avgLatency, errorRate)

          points.push({
            time: t,
            health,
            latency: Math.round(avgLatency),
            errorRate: Math.round(errorRate * 100),
          })
        }

        if (points.length > 0) {
          modelWindows.push({ model, tier, points })
        }
      })

    return { windows: modelWindows }
  }, [entries])

  if (windows.length === 0) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center' }}>
        <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          NO HEALTH DATA
        </span>
      </div>
    )
  }

  return (
    <div style={{ padding: '0.375rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Model Health · 30m
        </span>
        <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          {windows.length} models
        </span>
      </div>

      {/* Sparkline rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {windows.map((w, idx) => {
          const latestHealth = w.points[w.points.length - 1]?.health ?? 0
          const latestLatency = w.points[w.points.length - 1]?.latency ?? 0
          const color = TIER_COLORS[w.tier]

          return (
            <div key={w.model} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              {/* Model label */}
              <div style={{ width: 64, flexShrink: 0 }}>
                <div style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {w.model.split(/[-_]/).pop()}
                </div>
                <div style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
                  {latestLatency}ms
                </div>
              </div>

              {/* Sparkline */}
              <div style={{ flex: 1, height: 28 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={w.points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                    <defs>
                      <linearGradient id={`grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.[0]) return null
                        const raw = payload[0].payload
                        if (!raw || typeof raw !== 'object') return null
                        const d = raw as { time?: unknown; health?: unknown; latency?: unknown; errorRate?: unknown }
                        const time = Number(d.time)
                        const health = Number(d.health)
                        const latency = Number(d.latency)
                        const errorRate = Number(d.errorRate)
                        if (isNaN(time) || isNaN(health)) return null
                        return (
                          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 4, padding: '0.25rem 0.375rem', fontSize: '7px', fontFamily: 'var(--font-mono)' }}>
                            <div style={{ color: 'var(--muted-foreground)' }}>{new Date(time).toLocaleTimeString()}</div>
                            <div style={{ color, fontWeight: 700 }}>health {health}</div>
                            <div style={{ color: 'var(--muted-foreground)' }}>{latency}ms · {errorRate}%err</div>
                          </div>
                        )
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="health"
                      stroke={color}
                      strokeWidth={1.5}
                      fill={`url(#grad-${idx})`}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Health badge */}
              <div style={{
                width: 26,
                flexShrink: 0,
                textAlign: 'center',
                fontSize: '8px',
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                color: latestHealth > 70 ? 'hsl(145 65% 60%)' : latestHealth > 40 ? 'hsl(38 92% 65%)' : 'hsl(0 72% 60%)',
                background: latestHealth > 70 ? 'hsl(145 65% 45% / 0.15)' : latestHealth > 40 ? 'hsl(38 92% 50% / 0.15)' : 'hsl(0 72% 50% / 0.15)',
                border: `1px solid ${latestHealth > 70 ? 'hsl(145 65% 45% / 0.3)' : latestHealth > 40 ? 'hsl(38 92% 50% / 0.3)' : 'hsl(0 72% 50% / 0.3)'}`,
                borderRadius: 3,
                padding: '0.1rem 0.2rem',
              }}>
                {latestHealth}
              </div>
            </div>
          )
        })}
      </div>

      {/* Mini legend */}
      <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'center', marginTop: '0.125rem' }}>
        {(['tier1', 'tier2', 'tier3'] as const).map((tier) => (
          <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
            <div style={{ width: 8, height: 2, background: TIER_COLORS[tier], borderRadius: 1 }} />
            <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
              {tier.replace('tier', 'T')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
