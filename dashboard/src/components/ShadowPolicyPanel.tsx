import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from 'recharts'
import { useI18n } from '@/i18n'
import type { Stats } from '@/hooks/useApi'

interface Props {
  stats: Stats | null
}

const MODE_COLORS: Record<string, string> = {
  off: 'hsl(0 0% 50%)',
  observe_only: 'hsl(200 75% 48%)',
  forced_lower_tier: 'hsl(25 95% 55%)',
}

const TIER_COLORS = [
  'hsl(25 95% 55%)',
  'hsl(200 75% 48%)',
  'hsl(142 65% 42%)',
]

function MiniDonut({
  data,
  colors,
  centerLabel,
}: {
  data: { name: string; value: number }[]
  colors: string[]
  centerLabel: string
}) {
  if (!data.length) return null
  const total = data.reduce((s, d) => s + d.value, 0)

  const renderLabel = ({ cx, cy }: { cx: number; cy: number }) => (
    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
      <tspan x={cx} dy="-0.3em" fontSize="10" fontFamily="var(--font-mono)" fontWeight="700" fill="var(--foreground)">
        {total}
      </tspan>
      <tspan x={cx} dy="1.1em" fontSize="7" fontFamily="var(--font-mono)" fill="var(--muted-foreground)">
        {centerLabel}
      </tspan>
    </text>
  )

  return (
    <ResponsiveContainer width={100} height={90}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={28}
          outerRadius={42}
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
          }}
          formatter={(value: any, name: any) => {
            const num = Number(value) || 0
            const pct = total > 0 ? ((num / total) * 100).toFixed(1) : '0'
            return [`${num} (${pct}%)`, name]
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

export function ShadowPolicyPanel({ stats }: Props) {
  const { t } = useI18n()

  if (!stats) {
    return <div className="gs-empty-state">{t('chart.noData')}</div>
  }

  const modeDist = stats.shadow_policy_mode_distribution || {}
  const candidateTierDist = stats.shadow_policy_candidate_tier_distribution || {}
  const exclusionReasons = stats.shadow_policy_exclusion_reasons || {}
  const hardExclusionCounts = stats.shadow_policy_hard_exclusion_counts || {}

  const modeData = Object.entries(modeDist)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)

  const tierData = Object.entries(candidateTierDist)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)

  const exclusionData = Object.entries(exclusionReasons)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)

  const hardExclusionData = Object.entries(hardExclusionCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)

  const hasModeData = modeData.length > 0
  const hasTierData = tierData.length > 0
  const hasExclusionData = exclusionData.length > 0 || hardExclusionData.length > 0
  const hasAnyData = hasModeData || hasTierData || hasExclusionData

  if (!hasAnyData) {
    return <div className="gs-empty-state">{t('chart.noData')}</div>
  }

  const enabledCount = (modeDist.observe_only || 0) + (modeDist.forced_lower_tier || 0)
  const forcedCount = modeDist.forced_lower_tier || 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0.25rem 0' }}>
      {/* Summary row */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div className="sp-stat">
          <span className="sp-stat-value">{enabledCount}</span>
          <span className="sp-stat-label">{t('chart.spActive')}</span>
        </div>
        <div className="sp-stat">
          <span className="sp-stat-value">{forcedCount}</span>
          <span className="sp-stat-label">{t('chart.forcedDowngrade')}</span>
        </div>
        <div className="sp-stat">
          <span className="sp-stat-value">
            {stats.shadow_policy_avg_propensity != null ? stats.shadow_policy_avg_propensity.toFixed(4) : '—'}
          </span>
          <span className="sp-stat-label">{t('chart.avgPropensity')}</span>
        </div>
      </div>

      {/* Mode & Tier distribution */}
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        {hasModeData && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '9px', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
              {t('chart.spMode')}
            </div>
            <MiniDonut data={modeData} colors={Object.values(MODE_COLORS)} centerLabel="total" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', marginTop: '0.25rem' }}>
              {modeData.map((d) => (
                <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px' }}>
                  <div style={{ width: 7, height: 7, borderRadius: 2, background: MODE_COLORS[d.name] || '#888', flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}>{d.name}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {hasTierData && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '9px', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
              {t('chart.candidateTier')}
            </div>
            <MiniDonut data={tierData} colors={TIER_COLORS} centerLabel="total" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', marginTop: '0.25rem' }}>
              {tierData.map((d, i) => (
                <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px' }}>
                  <div style={{ width: 7, height: 7, borderRadius: 2, background: TIER_COLORS[i % TIER_COLORS.length], flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}>{d.name}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Exclusion reasons bar chart */}
      {hasExclusionData && (
        <div>
          <div style={{ fontSize: '9px', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
            {t('chart.exclusionReasons')}
          </div>
          {exclusionData.length > 0 && (
            <ResponsiveContainer width="100%" height={exclusionData.length * 18 + 20}>
              <BarChart data={exclusionData} layout="vertical" margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fontSize: 8, fontFamily: 'var(--font-mono)' }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 8, fontFamily: 'var(--font-mono)' }} tickLine={false} axisLine={false} width={110} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--popover-foreground)',
                  }}
                  formatter={(value: any) => [value, 'Count']}
                />
                <Bar dataKey="value" fill="hsl(25 95% 55%)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}

          {hardExclusionData.length > 0 && (
            <>
              <div style={{ fontSize: '9px', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem', marginTop: '0.5rem' }}>
                {t('chart.hardExclusionRules')}
              </div>
              <ResponsiveContainer width="100%" height={hardExclusionData.length * 18 + 20}>
                <BarChart data={hardExclusionData} layout="vertical" margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 8, fontFamily: 'var(--font-mono)' }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 8, fontFamily: 'var(--font-mono)' }} tickLine={false} axisLine={false} width={130} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--popover)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--popover-foreground)',
                    }}
                    formatter={(value: any) => [value, 'Count']}
                  />
                  <Bar dataKey="value" fill="hsl(340 70% 52%)" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      )}
    </div>
  )
}
