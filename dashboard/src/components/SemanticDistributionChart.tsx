import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { useI18n } from '@/i18n'
import type { Stats } from '@/hooks/useApi'

interface Props {
  stats: Stats | null
}

const INTENT_COLORS = [
  'hsl(25 95% 55%)',
  'hsl(200 75% 48%)',
  'hsl(142 65% 42%)',
  'hsl(280 60% 58%)',
  'hsl(340 70% 52%)',
  'hsl(45 85% 50%)',
  'hsl(190 80% 45%)',
  'hsl(330 70% 55%)',
]

const DIFFICULTY_COLORS = [
  'hsl(142 65% 42%)',
  'hsl(45 85% 50%)',
  'hsl(25 95% 55%)',
]

function Donut({
  data,
  colors,
  label,
  centerLabel,
}: {
  data: { name: string; value: number }[]
  colors: string[]
  label: string
  centerLabel: string
}) {
  if (data.length === 0) return null

  const total = data.reduce((s, d) => s + d.value, 0)

  const renderLabel = ({ cx, cy }: { cx: number; cy: number }) => (
    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
      <tspan x={cx} dy="-0.4em" fontSize="10" fontFamily="var(--font-mono)" fontWeight="700" fill="var(--foreground)">
        {data.length}
      </tspan>
      <tspan x={cx} dy="1.2em" fontSize="8" fontFamily="var(--font-mono)" fill="var(--muted-foreground)">
        {centerLabel}
      </tspan>
    </text>
  )

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: '10px', color: 'var(--muted-foreground)', textAlign: 'center', marginBottom: '0.25rem', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={36}
            outerRadius={56}
            paddingAngle={2}
            dataKey="value"
            label={renderLabel}
            labelLine={false}
          >
            {data.map((_entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={colors[index % colors.length]}
                stroke="var(--background)"
                strokeWidth={2}
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
            formatter={(value: any, name: any) => {
              const num = Number(value) || 0
              const pct = total > 0 ? ((num / total) * 100).toFixed(1) : '0'
              return [`${num} (${pct}%)`, name]
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', padding: '0 0.25rem' }}>
        {data.map((entry, index) => {
          const pct = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0'
          return (
            <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px' }}>
              <div style={{ width: 7, height: 7, borderRadius: 2, background: colors[index % colors.length], flexShrink: 0 }} />
              <span style={{ color: 'var(--foreground)', fontFamily: 'var(--font-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
              <span style={{ color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}>{entry.value}</span>
              <span style={{ color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}>({pct}%)</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function SemanticDistributionChart({ stats }: Props) {
  const { t } = useI18n()

  const empty = !stats || (Object.keys(stats.intent_distribution || {}).length === 0 && Object.keys(stats.difficulty_distribution || {}).length === 0)

  if (empty) {
    return (
      <div className="gs-empty-state" style={{ margin: '0.5rem' }}>
        {t('chart.noData')}
      </div>
    )
  }

  const intentData = Object.entries(stats.intent_distribution || {})
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)

  const difficultyData = Object.entries(stats.difficulty_distribution || {})
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)

  return (
    <div style={{ display: 'flex', gap: '1rem', padding: '0.25rem 0' }}>
      <Donut
        data={intentData}
        colors={INTENT_COLORS}
        label={t('chart.intentDistribution')}
        centerLabel="intents"
      />
      <Donut
        data={difficultyData}
        colors={DIFFICULTY_COLORS}
        label={t('chart.difficultyDistribution')}
        centerLabel="levels"
      />
    </div>
  )
}
