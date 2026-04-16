import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import { useI18n } from '@/i18n'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

export function LatencyChart({ entries }: Props) {
  const { t } = useI18n()

  if (entries.length === 0) {
    return (
      <div className="gs-empty-state" style={{ margin: '0.25rem 0.5rem' }}>
        {t('chart.noData')}
      </div>
    )
  }

  // Show last 40 entries, reversed to chronological order
  const recent = [...entries]
    .reverse()
    .slice(0, 40)
    .map((entry, i) => ({
      index: i + 1,
      latency: entry.latency_ms ?? 0,
      ttft: entry.ttft_ms ?? 0,
      model: entry.routed_model,
    }))

  const maxLatency = Math.max(...recent.map((d) => Math.max(d.latency, d.ttft)), 1)

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={recent} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid
          strokeDasharray="2 4"
          stroke="currentColor"
          strokeOpacity={0.08}
          vertical={false}
        />
        <XAxis
          dataKey="index"
          tick={{ fill: 'currentColor', fillOpacity: 0.4, fontSize: 10, fontFamily: 'var(--font-mono)' }}
          axisLine={false}
          tickLine={false}
          interval={Math.floor(recent.length / 5)}
        />
        <YAxis
          tick={{ fill: 'currentColor', fillOpacity: 0.4, fontSize: 10, fontFamily: 'var(--font-mono)' }}
          axisLine={false}
          tickLine={false}
          domain={[0, maxLatency * 1.1]}
          tickFormatter={(v) => `${v}ms`}
        />
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
          formatter={(value: any, name: any) => [`${value}ms`, name === 'latency' ? t('table.latency') : t('table.ttft')]}
          labelFormatter={(label, payload) => {
            const model = payload?.[0]?.payload?.model
            return model
              ? t('chart.requestLabel', { label, model })
              : t('chart.requestLabelShort', { label })
          }}
        />
        {/* 1s reference line */}
        <ReferenceLine
          y={1000}
          stroke="hsl(25 95% 55%)"
          strokeOpacity={0.3}
          strokeDasharray="3 3"
          label={{
            value: '1s',
            position: 'right',
            fontSize: 9,
            fontFamily: 'var(--font-mono)',
            fill: 'hsl(25 95% 55%)',
            fillOpacity: 0.6,
          }}
        />
        <Line
          type="monotone"
          dataKey="latency"
          stroke="hsl(25 95% 55%)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, fill: 'hsl(25 95% 55%)' }}
          name={t('table.latency')}
        />
        <Line
          type="monotone"
          dataKey="ttft"
          stroke="hsl(200 75% 48%)"
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3, fill: 'hsl(200 75% 48%)' }}
          strokeDasharray="4 2"
          name={t('table.ttft')}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
