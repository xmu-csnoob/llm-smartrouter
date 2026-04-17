import { useMemo } from 'react'
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const TIERS = ['tier1', 'tier2', 'tier3'] as const
const TIER_COLORS: Record<string, string> = {
  tier1: 'hsl(280 65% 60%)',
  tier2: 'hsl(200 75% 55%)',
  tier3: 'hsl(145 65% 48%)',
}

interface TierMetrics {
  tier: string
  accuracy: number    // % selected === routed
  latency: number     // normalized 0-100 (lower is better → invert)
  errorRate: number   // % errors (lower is better → invert)
  throughput: number  // requests in window (normalized)
}

function invertScore(value: number, max: number): number {
  if (max === 0) return 0
  return Math.max(0, 100 - (value / max) * 100)
}

export function TierRadar({ entries }: Props) {
  const { data, metrics } = useMemo(() => {
    const tierData: Record<string, LogEntry[]> = {}
    for (const tier of TIERS) tierData[tier] = []

    for (const entry of entries) {
      const tier = entry.routed_tier || 'tier2'
      if (!tierData[tier]) tierData[tier] = []
      tierData[tier].push(entry)
    }

    // Compute per-tier metrics
    const metrics: TierMetrics[] = TIERS.map((tier) => {
      const group = tierData[tier]
      const count = group.length

      // Accuracy: % this tier was selected and matched routed
      const accuracy = count > 0
        ? (group.filter(e => e.selected_tier === e.routed_tier).length / count) * 100
        : 0

      // Avg latency
      const latencies = group.map(e => e.latency_ms || 0).filter(l => l > 0)
      const avgLatency = latencies.length > 0
        ? latencies.reduce((s, l) => s + l, 0) / latencies.length
        : 0

      // Error rate
      const errors = group.filter(e => e.status >= 400 || e.error).length
      const errorRate = count > 0 ? (errors / count) * 100 : 0

      // Throughput = request count (normalized later across tiers)
      const throughput = count

      return { tier, accuracy, latency: avgLatency, errorRate, throughput }
    })

    // Normalize latency and errorRate to 0-100 (invert — lower is better)
    const maxLatency = Math.max(...metrics.map(m => m.latency), 1)
    const maxError = Math.max(...metrics.map(m => m.errorRate), 1)
    const maxThroughput = Math.max(...metrics.map(m => m.throughput), 1)

    const scored = metrics.map(m => ({
      tier: m.tier,
      accuracy: Math.round(m.accuracy),
      latency: Math.round(invertScore(m.latency, maxLatency)),
      errorRate: Math.round(invertScore(m.errorRate, maxError)),
      throughput: Math.round(maxThroughput > 0 ? (m.throughput / maxThroughput) * 100 : 0),
    }))

    // Radar requires subject array — pivot to axes
    const axes = ['accuracy', 'latency', 'errorRate', 'throughput'] as const
    const radarData = axes.map(axis => {
      const point: Record<string, string | number> = { axis: axisLabel(axis) }
      for (const tier of TIERS) {
        const td = scored.find(d => d.tier === tier)!
        point[tier] = td[axis]
      }
      return point
    })

    return { data: radarData, metrics: scored }
  }, [entries])

  if (entries.length === 0) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center' }}>
        <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          NO ROUTING DATA
        </span>
      </div>
    )
  }

  return (
    <div style={{ padding: '0.375rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Tier Metrics Radar
        </span>
        <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          {entries.length} samples
        </span>
      </div>

      {/* Radar chart */}
      <div style={{ height: 140 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="65%" data={data}>
            <PolarGrid stroke="var(--border)" />
            <PolarAngleAxis
              dataKey="axis"
              tick={{ fontSize: 6, fontFamily: 'var(--font-mono)', fill: 'var(--muted-foreground)' }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0]?.payload as Record<string, unknown>
                if (!d) return null
                return (
                  <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 4, padding: '0.25rem 0.375rem', fontSize: '7px', fontFamily: 'var(--font-mono)' }}>
                    <div style={{ color: 'var(--muted-foreground)', marginBottom: '0.125rem' }}>{String(d.axis)}</div>
                    {TIERS.map(tier => (
                      <div key={tier} style={{ color: TIER_COLORS[tier] }}>
                        {tier}: {Number(d[tier])}
                      </div>
                    ))}
                  </div>
                )
              }}
            />
            {TIERS.map((tier) => (
              <Radar
                key={tier}
                name={tier}
                dataKey={tier}
                stroke={TIER_COLORS[tier]}
                fill={TIER_COLORS[tier]}
                fillOpacity={0.08}
                strokeWidth={1.5}
                dot={{ r: 2, fill: TIER_COLORS[tier], strokeWidth: 0 }}
              />
            ))}
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Metric cards row */}
      <div style={{ display: 'flex', gap: '0.25rem' }}>
        {metrics.map((m) => (
          <div key={m.tier} style={{
            flex: 1,
            background: 'var(--muted)',
            border: `1px solid ${TIER_COLORS[m.tier]}40`,
            borderRadius: 4,
            padding: '0.2rem 0.3rem',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: TIER_COLORS[m.tier], fontWeight: 700, marginBottom: '0.1rem' }}>
              {m.tier.replace('tier', 'T')}
            </div>
            {[
              { label: 'acc', v: m.accuracy },
              { label: 'lat', v: m.latency },
              { label: 'err', v: m.errorRate },
              { label: 'thr', v: m.throughput },
            ].map(({ label, v }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>{label}</span>
                <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--foreground)' }}>{v}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Axis legend */}
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        {[
          { key: 'accuracy', label: '↑ accuracy' },
          { key: 'latency', label: '↓ latency' },
          { key: 'errorRate', label: '↓ error' },
          { key: 'throughput', label: '↑ throughput' },
        ].map(({ key, label }) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
            <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function axisLabel(axis: string): string {
  const labels: Record<string, string> = {
    accuracy: 'ACC',
    latency: 'LAT',
    errorRate: 'ERR',
    throughput: 'THR',
  }
  return labels[axis] || axis
}
