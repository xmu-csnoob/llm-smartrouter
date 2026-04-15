import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, type PieLabelRenderProps } from 'recharts'
import { useI18n } from '@/i18n'
import type { Stats } from '@/hooks/useApi'

interface Props {
  stats: Stats | null
  selectedModel?: string | null
  onSliceClick?: (modelName: string) => void
}

const COLORS = [
  'hsl(221 83% 53%)',
  'hsl(142 71% 45%)',
  'hsl(38 92% 50%)',
  'hsl(340 75% 55%)',
  'hsl(262 83% 58%)',
]

export function ModelChart({ stats, selectedModel, onSliceClick }: Props) {
  const { t } = useI18n()

  if (!stats || !stats.models || Object.keys(stats.models).length === 0) {
    return (
      <div className="gs-empty-state">
        {t('chart.noData')}
      </div>
    )
  }

  const data = Object.entries(stats.models).map(([name, info]) => ({
    name,
    value: info.count,
    avgLatency: info.avg_latency_ms,
  }))

  const renderLabel = (props: PieLabelRenderProps) => {
    const { percent, x, y } = props
    if (percent && percent > 0.05) {
      return (
        <text
          x={x}
          y={y}
          fill="currentColor"
          fillOpacity={0.7}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="11"
          fontFamily="var(--font-mono)"
        >
          {`${(percent * 100).toFixed(0)}%`}
        </text>
      )
    }
    return null
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={2}
          dataKey="value"
          label={renderLabel}
          labelLine={false}
          onClick={(_data, index) => {
            if (onSliceClick && data[index]) onSliceClick(data[index].name)
          }}
          cursor={onSliceClick ? 'pointer' : 'default'}
        >
          {data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={COLORS[index % COLORS.length]}
              stroke="var(--background)"
              strokeWidth={2}
              opacity={selectedModel && selectedModel !== entry.name ? 0.3 : 1}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            fontSize: '12px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--popover-foreground)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06)',
          }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any, name: any) => [`${value} requests`, name]}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
