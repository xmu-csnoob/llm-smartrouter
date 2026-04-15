import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { PieLabelRenderProps } from 'recharts'
import { useI18n } from '@/i18n'
import type { Stats } from '@/hooks/useApi'

interface Props {
  stats: Stats | null
  selectedModel?: string | null
}

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088fe']

export function ModelChart({ stats, selectedModel }: Props) {
  const { t } = useI18n()

  if (!stats || !stats.models || Object.keys(stats.models).length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('chart.modelDistribution')}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[250px] text-muted-foreground">
          {t('chart.noData')}
        </CardContent>
      </Card>
    )
  }

  const data = Object.entries(stats.models).map(([name, info]) => ({
    name,
    value: info.count,
    avgLatency: info.avg_latency_ms,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('chart.modelDistribution')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={80}
              label={(props: PieLabelRenderProps) => `${props.name ?? ''} (${(((props.percent as number) ?? 0) * 100).toFixed(0)}%)`}
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                  opacity={selectedModel && entry.name !== selectedModel ? 0.3 : 1}
                  stroke={selectedModel && entry.name === selectedModel ? '#333' : 'none'}
                  strokeWidth={selectedModel && entry.name === selectedModel ? 2 : 0}
                />
              ))}
            </Pie>
            <Tooltip
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, name: any, props: any) => {
                const payload = props?.payload
                return [t('chart.requests', { value, avgLatency: payload?.avgLatency ?? '—' }), name]
              }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
