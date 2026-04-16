import { useI18n } from '@/i18n'
import type { Stats } from '@/hooks/useApi'
import { DollarSign, ArrowDown, ArrowUp } from 'lucide-react'

interface Props {
  stats: Stats | null
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(4)}`
  return `$${n.toFixed(6)}`
}

export function TokenCostCard({ stats }: Props) {
  const { t } = useI18n()

  const inputTokens = stats?.total_input_tokens ?? 0
  const outputTokens = stats?.total_output_tokens ?? 0
  const totalCost = stats?.total_cost ?? 0
  const total = stats?.total ?? 0

  const avgInputPerReq = total > 0 ? Math.round(inputTokens / total) : 0
  const avgOutputPerReq = total > 0 ? Math.round(outputTokens / total) : 0

  return (
    <div className="stat-block" style={{ gridColumn: 'span 1' }}>
      <div className="stat-block-accent" style={{ background: 'hsl(142 65% 40%)' }} />
      <div className="stat-block-label">
        <DollarSign size={10} />
        {t('stats.tokenCost')}
      </div>
      <div className="stat-block-value" style={{ color: 'hsl(142 65% 40%)', fontSize: '1.1rem' }}>
        {totalCost > 0 ? fmtCost(totalCost) : '—'}
      </div>
      <div className="stat-block-sub">{t('stats.totalCost')}</div>
      <div className="stat-block-sub" style={{ marginTop: '0.35rem', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <ArrowUp size={9} style={{ color: 'hsl(200 75% 45%)' }} />
          {inputTokens > 0 ? fmt(inputTokens) : '—'} {t('keys.inputTokens')}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <ArrowDown size={9} style={{ color: 'hsl(280 60% 55%)' }} />
          {outputTokens > 0 ? fmt(outputTokens) : '—'} {t('keys.outputTokens')}
        </span>
      </div>
      <div className="stat-block-sub">
        avg: {avgInputPerReq > 0 ? fmt(avgInputPerReq) : '—'} / {avgOutputPerReq > 0 ? fmt(avgOutputPerReq) : '—'}
      </div>
    </div>
  )
}
