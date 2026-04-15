import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

export function LatencyChart({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Latency Trend</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[250px] text-muted-foreground">
          No data yet
        </CardContent>
      </Card>
    )
  }

  const data = [...entries].reverse().map((entry, i) => ({
    index: i + 1,
    latency: entry.latency_ms,
    ttft: entry.ttft_ms,
    model: entry.routed_model,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Latency Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="index" label={{ value: 'Request #', position: 'insideBottom', offset: -5 }} />
            <YAxis label={{ value: 'ms', angle: -90, position: 'insideLeft' }} />
            <Tooltip
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, name: any) => [`${value}ms`, name]}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              labelFormatter={(label: any, payload: any) => {
                const model = payload?.[0]?.payload?.model
                return model ? `Request ${label} — ${model}` : `Request ${label}`
              }}
            />
            <Line type="monotone" dataKey="latency" stroke="#8884d8" strokeWidth={2} dot={false} name="Latency" />
            <Line type="monotone" dataKey="ttft" stroke="#82ca9d" strokeWidth={2} dot={false} name="TTFT" />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
