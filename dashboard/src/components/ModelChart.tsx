import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { useI18n } from '@/i18n'
import type { Stats } from '@/hooks/useApi'

interface Props {
  stats: Stats | null
  selectedModel?: string | null
  onSliceClick?: (modelName: string) => void
}

const COLORS = [
  'hsl(25 95% 55%)',
  'hsl(200 75% 48%)',
  'hsl(142 65% 42%)',
  'hsl(280 60% 58%)',
  'hsl(340 70% 52%)',
  'hsl(45 85% 50%)',
]

export function ModelChart({ stats, selectedModel, onSliceClick }: Props) {
  const { t } = useI18n()

  if (!stats || !stats.models || Object.keys(stats.models).length === 0) {
    return (
      <div className="gs-empty-state" style={{ margin: '0.5rem' }}>
        {t('chart.noData')}
      </div>
    )
  }

  const total = Object.values(stats.models).reduce((sum, m) => sum + m.count, 0)

  const data = Object.entries(stats.models)
    .map(([name, info]) => ({
      name,
      value: info.count,
      avgLatency: info.avg_latency_ms,
    }))
    .sort((a, b) => b.value - a.value)

  const renderLabel = ({ cx, cy }: { cx: number; cy: number }) => (
    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
      <tspan
        x={cx}
        dy="-0.4em"
        fontSize="11"
        fontFamily="var(--font-mono)"
        fontWeight="700"
        fill="var(--foreground)"
      >
        {data.length}
      </tspan>
      <tspan
        x={cx}
        dy="1.2em"
        fontSize="9"
        fontFamily="var(--font-mono)"
        fill="var(--muted-foreground)"
      >
        models
      </tspan>
    </text>
  )

  return (
    <div className="distribution-donut" style={{ padding: '0.25rem 0' }}>
      <div className="distribution-chart">
        <ResponsiveContainer width={160} height={160}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={52}
              outerRadius={76}
              paddingAngle={2}
              dataKey="value"
              label={renderLabel}
              labelLine={false}
              onClick={(_d, index) => {
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
                  opacity={
                    selectedModel && selectedModel !== entry.name ? 0.25 : 1
                  }
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--popover)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--popover-foreground)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any, name: any) => [`${value} reqs`, name]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="distribution-legend">
        {data.map((entry, index) => {
          const pct = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0'
          return (
            <div
              key={entry.name}
              className="legend-item"
              onClick={() => onSliceClick?.(entry.name)}
            >
              <div
                className="legend-dot"
                style={{ background: COLORS[index % COLORS.length] }}
              />
              <span className="legend-label" title={entry.name}>
                {entry.name}
              </span>
              <span className="legend-value">{entry.value}</span>
              <span className="legend-pct">{pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
