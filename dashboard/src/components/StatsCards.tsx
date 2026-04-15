import { Activity, AlertTriangle, ArrowRightLeft, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Stats, ModelStats } from '@/hooks/useApi'

interface Props {
  stats: Stats | null
  modelStats?: ModelStats | null
}

export function StatsCards({ stats, modelStats }: Props) {
  const isModelView = !!modelStats

  const total = isModelView ? (modelStats?.count ?? 0) : (stats?.total ?? 0)
  const avgLatency = isModelView
    ? (modelStats?.avg_latency_ms != null ? `${modelStats.avg_latency_ms}ms` : '—')
    : (stats?.avg_latency_ms != null ? `${stats.avg_latency_ms}ms` : '—')
  const avgTtft = isModelView
    ? (modelStats?.avg_ttft_ms != null ? `${modelStats.avg_ttft_ms}ms` : '—')
    : (stats?.avg_ttft_ms != null ? `${stats.avg_ttft_ms}ms` : '—')
  const errorRate = isModelView
    ? (modelStats && modelStats.count > 0 ? `${Math.round(modelStats.errors / modelStats.count * 1000) / 10}%` : '—')
    : (stats ? `${stats.error_rate}%` : '—')
  const errorCount = isModelView ? (modelStats?.errors ?? 0) : (stats?.errors ?? 0)

  const cards = [
    {
      title: 'Total Requests',
      value: total,
      icon: Activity,
      description: '24h period',
    },
    {
      title: 'Avg Latency',
      value: avgLatency,
      icon: Clock,
      description: `TTFT: ${avgTtft}`,
    },
    {
      title: 'Fallback Rate',
      value: isModelView ? '—' : (stats ? `${stats.fallback_rate}%` : '—'),
      icon: ArrowRightLeft,
      description: isModelView ? 'per-model not available' : (stats ? `${stats.fallbacks} fallbacks` : ''),
    },
    {
      title: 'Error Rate',
      value: errorRate,
      icon: AlertTriangle,
      description: `${errorCount} errors`,
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
            <card.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
            <p className="text-xs text-muted-foreground">{card.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
