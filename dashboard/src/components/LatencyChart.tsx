import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useI18n } from '@/i18n'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

export function LatencyChart({ entries }: Props) {
  const { t } = useI18n()

  if (entries.length === 0) {
    return (
      <div className="gs-empty-state">
        {t('chart.noData')}
      </div>
    )
  }

  const data = [...entries].reverse().map((entry, i) => ({
    index: i + 1,
    latency: entry.latency_ms,
    ttft: entry.ttft_ms,
    model: entry.routed_model,
  }))

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="currentColor"
          strokeOpacity={0.1}
          vertical={false}
        />
        <XAxis
          dataKey="index"
          tick={{ fill: 'currentColor', fillOpacity: 0.5, fontSize: 11, fontFamily: 'var(--font-mono)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: 'currentColor', fillOpacity: 0.5, fontSize: 11, fontFamily: 'var(--font-mono)' }}
          axisLine={false}
          tickLine={false}
        />
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
          formatter={(value: any, name: any) => [`${value}ms`, name]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelFormatter={(label: any, payload: any) => {
            const model = payload?.[0]?.payload?.model
            return model ? t('chart.requestLabel', { label, model }) : t('chart.requestLabelShort', { label })
          }}
        />
        <Line
          type="monotone"
          dataKey="latency"
          stroke="hsl(221 83% 53%)"
          strokeWidth={2}
          dot={false}
          name={t('table.latency')}
        />
        <Line
          type="monotone"
          dataKey="ttft"
          stroke="hsl(38 92% 50%)"
          strokeWidth={2}
          dot={false}
          name={t('table.ttft')}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
