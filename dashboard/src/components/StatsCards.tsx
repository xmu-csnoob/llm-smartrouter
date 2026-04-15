import { Activity, AlertTriangle, ArrowRightLeft, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Stats } from '@/hooks/useApi'

interface Props {
  stats: Stats | null
}

export function StatsCards({ stats }: Props) {
  const cards = [
    {
      title: 'Total Requests',
      value: stats?.total ?? 0,
      icon: Activity,
      description: '24h period',
    },
    {
      title: 'Avg Latency',
      value: stats?.avg_latency_ms != null ? `${stats.avg_latency_ms}ms` : '—',
      icon: Clock,
      description: stats?.avg_ttft_ms != null ? `TTFT: ${stats.avg_ttft_ms}ms` : 'TTFT: —',
    },
    {
      title: 'Fallback Rate',
      value: stats ? `${stats.fallback_rate}%` : '—',
      icon: ArrowRightLeft,
      description: stats ? `${stats.fallbacks} fallbacks` : '',
    },
    {
      title: 'Error Rate',
      value: stats ? `${stats.error_rate}%` : '—',
      icon: AlertTriangle,
      description: stats ? `${stats.errors} errors` : '',
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
