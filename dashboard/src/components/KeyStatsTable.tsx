import { useI18n } from '@/i18n'
import type { KeyStats } from '@/hooks/useApi'

interface Props {
  keys: Record<string, KeyStats>
  onKeyClick?: (key: string) => void
}

function ChipList({ items, color }: { items: Record<string, number>; color: string }) {
  const sorted = Object.entries(items).sort((a, b) => b[1] - a[1])
  return (
    <div className="flex flex-wrap gap-1">
      {sorted.slice(0, 4).map(([k, v]) => (
        <span
          key={k}
          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono"
          style={{ background: color, color: 'hsl(0 0% 100%)' }}
        >
          {k}: {v}
        </span>
      ))}
      {sorted.length > 4 && (
        <span className="text-[10px] text-muted-foreground">+{sorted.length - 4}</span>
      )}
    </div>
  )
}

export function KeyStatsTable({ keys, onKeyClick }: Props) {
  const { t } = useI18n()

  const sortedEntries = Object.entries(keys).sort((a, b) => b[1].total_cost - a[1].total_cost)

  const totalCost = Object.values(keys).reduce((sum, k) => sum + k.total_cost, 0)
  const totalInput = Object.values(keys).reduce((sum, k) => sum + k.total_input_tokens, 0)
  const totalOutput = Object.values(keys).reduce((sum, k) => sum + k.total_output_tokens, 0)
  const totalRequests = Object.values(keys).reduce((sum, k) => sum + k.count, 0)

  return (
    <div className="flex flex-col gap-4">
      {/* Summary row */}
      <div className="flex gap-4 flex-wrap">
        <div className="stat-block" style={{ flex: '1 1 120px', minWidth: 120 }}>
          <div className="stat-block-accent" style={{ background: 'hsl(200 75% 45%)' }} />
          <div className="stat-block-label">{t('keys.totalRequests')}</div>
          <div className="stat-block-value">{totalRequests.toLocaleString()}</div>
        </div>
        <div className="stat-block" style={{ flex: '1 1 120px', minWidth: 120 }}>
          <div className="stat-block-accent" style={{ background: 'hsl(142 65% 40%)' }} />
          <div className="stat-block-label">{t('keys.totalInputTokens')}</div>
          <div className="stat-block-value" style={{ fontSize: '1rem' }}>{totalInput.toLocaleString()}</div>
        </div>
        <div className="stat-block" style={{ flex: '1 1 120px', minWidth: 120 }}>
          <div className="stat-block-accent" style={{ background: 'hsl(280 60% 55%)' }} />
          <div className="stat-block-label">{t('keys.totalOutputTokens')}</div>
          <div className="stat-block-value" style={{ fontSize: '1rem' }}>{totalOutput.toLocaleString()}</div>
        </div>
        <div className="stat-block" style={{ flex: '1 1 120px', minWidth: 120 }}>
          <div className="stat-block-accent" style={{ background: 'hsl(25 85% 50%)' }} />
          <div className="stat-block-label">{t('keys.totalCost')}</div>
          <div className="stat-block-value" style={{ color: 'hsl(25 85% 50%)', fontSize: '1rem' }}>
            ${totalCost.toFixed(4)}
          </div>
        </div>
      </div>

      {/* Table */}
      {sortedEntries.length === 0 ? (
        <div className="text-center text-muted-foreground py-12 text-sm">{t('keys.noData')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-semibold text-muted-foreground text-xs">{t('keys.apiKey')}</th>
                <th className="text-right py-2 px-3 font-semibold text-muted-foreground text-xs">{t('keys.requests')}</th>
                <th className="text-right py-2 px-3 font-semibold text-muted-foreground text-xs">{t('keys.errorRate')}</th>
                <th className="text-right py-2 px-3 font-semibold text-muted-foreground text-xs">{t('keys.avgLatency')}</th>
                <th className="text-left py-2 px-3 font-semibold text-muted-foreground text-xs">{t('keys.models')}</th>
                <th className="text-left py-2 px-3 font-semibold text-muted-foreground text-xs">{t('keys.tiers')}</th>
                <th className="text-right py-2 px-3 font-semibold text-muted-foreground text-xs">{t('keys.inputTokens')}</th>
                <th className="text-right py-2 px-3 font-semibold text-muted-foreground text-xs">{t('keys.outputTokens')}</th>
                <th className="text-right py-2 px-3 font-semibold text-muted-foreground text-xs">{t('keys.totalCost')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map(([key, data]) => (
                <tr
                  key={key}
                  className="border-b border-border/50 hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => onKeyClick?.(key)}
                >
                  <td className="py-2 px-3 font-mono text-xs">{key}</td>
                  <td className="py-2 px-3 text-right font-mono">{data.count.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right">
                    <span
                      className="font-mono text-xs"
                      style={{ color: data.error_rate > 5 ? 'hsl(0 72% 50%)' : 'hsl(142 65% 40%)' }}
                    >
                      {data.error_rate}%
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-xs">
                    {data.avg_latency_ms != null ? `${data.avg_latency_ms}ms` : '—'}
                  </td>
                  <td className="py-2 px-3">
                    <ChipList items={data.models} color="hsl(200 75% 40%)" />
                  </td>
                  <td className="py-2 px-3">
                    <ChipList items={data.tiers} color="hsl(280 60% 45%)" />
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-xs">{data.total_input_tokens.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right font-mono text-xs">{data.total_output_tokens.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right font-mono text-xs font-semibold" style={{ color: 'hsl(25 85% 50%)' }}>
                    ${data.total_cost.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
