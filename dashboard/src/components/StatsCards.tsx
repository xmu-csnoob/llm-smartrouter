import { useI18n } from '@/i18n'
import type { Stats, ModelStats } from '@/hooks/useApi'

interface Props {
  stats: Stats | null
  modelStats?: ModelStats | null
}

export function StatsCards({ stats, modelStats }: Props) {
  const { t } = useI18n()
  const isModelView = !!modelStats

  const total = isModelView ? (modelStats?.count ?? 0) : (stats?.total ?? 0)
  const avgLatency = isModelView
    ? (modelStats?.avg_latency_ms != null ? `${modelStats.avg_latency_ms}` : '—')
    : (stats?.avg_latency_ms != null ? `${stats.avg_latency_ms}` : '—')
  const avgTtft = isModelView
    ? (modelStats?.avg_ttft_ms != null ? `${modelStats.avg_ttft_ms}` : '—')
    : (stats?.avg_ttft_ms != null ? `${stats.avg_ttft_ms}` : '—')
  const errorRate = isModelView
    ? (modelStats && modelStats.count > 0 ? `${Math.round(modelStats.errors / modelStats.count * 1000) / 10}` : '—')
    : (stats ? `${stats.error_rate}` : '—')
  const errorCount = isModelView ? (modelStats?.errors ?? 0) : (stats?.errors ?? 0)
  const fallbackRate = stats ? `${stats.fallback_rate}` : '—'

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="gs-stat-module">
        <div className="gs-stat-label">{t('stats.totalRequests')}</div>
        <div className="gs-stat-value">
          {typeof total === 'number' ? total.toLocaleString() : total}
        </div>
        <div className="gs-stat-desc">{t('stats.period24h')}</div>
      </div>

      <div className="gs-stat-module">
        <div className="gs-stat-label">{t('stats.avgLatency')}</div>
        <div className="gs-stat-value">
          {avgLatency}{avgLatency !== '—' ? <span className="text-sm font-normal text-muted-foreground ml-0.5">ms</span> : null}
        </div>
        <div className="gs-stat-desc">{t('stats.ttft', { value: avgTtft + (avgTtft !== '—' ? 'ms' : '') })}</div>
      </div>

      <div className="gs-stat-module">
        <div className="gs-stat-label">{t('stats.fallbackRate')}</div>
        <div className="gs-stat-value">
          {isModelView ? '—' : <>
            {fallbackRate}{fallbackRate !== '—' ? <span className="text-sm font-normal text-muted-foreground ml-0.5">%</span> : null}
          </>}
        </div>
        <div className="gs-stat-desc">
          {isModelView ? t('stats.perModelNA') : (stats ? t('stats.fallbacks', { count: stats.fallbacks }) : '')}
        </div>
      </div>

      <div className="gs-stat-module">
        <div className="gs-stat-label">{t('stats.errorRate')}</div>
        <div className="gs-stat-value">
          {errorRate}{errorRate !== '—' ? <span className="text-sm font-normal text-muted-foreground ml-0.5">%</span> : null}
        </div>
        <div className="gs-stat-desc">{t('stats.errors', { count: errorCount })}</div>
      </div>
    </div>
  )
}
