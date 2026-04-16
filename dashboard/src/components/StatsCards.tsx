import { useState } from 'react'
import { useI18n } from '@/i18n'
import type { Stats, ModelStats } from '@/hooks/useApi'
import { archiveLogs } from '@/hooks/useApi'
import { Activity, AlertTriangle, ArrowDownUp, CheckCircle, Database } from 'lucide-react'

interface Props {
  stats: Stats | null
  modelStats?: ModelStats | null
  onRefresh: () => void
}

export function StatsCards({ stats, onRefresh }: Props) {
  const { t } = useI18n()
  const [clearing, setClearing] = useState(false)

  const total = stats?.total ?? 0
  const avgLatency = stats?.avg_latency_ms != null ? `${stats.avg_latency_ms}` : '—'
  const avgTtft = stats?.avg_ttft_ms != null ? `${stats.avg_ttft_ms}` : '—'
  const errorRate = stats ? `${stats.error_rate}` : '—'
  const fallbackRate = stats ? `${stats.fallback_rate}` : '—'
  const errorCount = stats?.errors ?? 0
  const fallbackCount = stats?.fallbacks ?? 0

  // Schema v3 coverage
  const featureSnapshotCount = stats?.feature_snapshot_count ?? 0
  const schemaV3Coverage = total > 0 ? Math.round((featureSnapshotCount / total) * 100) : 0
  const topIntentType = stats?.task_types
    ? Object.entries(stats.task_types).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
    : '—'
  const intentTypeCount = stats?.task_types ? Object.keys(stats.task_types).length : 0

  const handleArchive = async () => {
    if (!window.confirm(t('stats.clearLogsConfirm'))) return
    setClearing(true)
    try {
      const result = await archiveLogs()
      if (result.total_archived > 0) {
        onRefresh()
      }
    } catch {
      // silent fail
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="stat-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
      {/* Total Requests */}
      <div className="stat-block">
        <div className="stat-block-accent" />
        <div className="stat-block-label">
          <Activity size={10} />
          {t('stats.totalRequests')}
        </div>
        <div className="stat-block-value">
          {typeof total === 'number' ? total.toLocaleString() : total}
        </div>
        <div className="stat-block-sub">{t('stats.period24h')}</div>
        <div className="stat-block-action" />
      </div>

      {/* Avg Latency */}
      <div className="stat-block">
        <div className="stat-block-accent" style={{ background: 'hsl(200 75% 45%)' }} />
        <div className="stat-block-label">
          <Activity size={10} />
          {t('stats.avgLatency')}
        </div>
        <div className="stat-block-value" style={{ color: 'hsl(200 75% 45%)' }}>
          {avgLatency}
          <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--muted-foreground)', marginLeft: '2px' }}>ms</span>
        </div>
        <div className="stat-block-sub">
          TTFT: {avgTtft !== '—' ? `${avgTtft}ms` : '—'}
        </div>
      </div>

      {/* Fallback Rate */}
      <div className="stat-block">
        <div className="stat-block-accent" style={{ background: 'hsl(142 65% 40%)' }} />
        <div className="stat-block-label">
          <ArrowDownUp size={10} />
          {t('stats.fallbackRate')}
        </div>
        <div className="stat-block-value" style={{ color: 'hsl(142 65% 40%)' }}>
          {fallbackRate !== '—' ? fallbackRate : '—'}
          {fallbackRate !== '—' && <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--muted-foreground)', marginLeft: '2px' }}>%</span>}
        </div>
        <div className="stat-block-sub">
          {stats ? t('stats.fallbacks', { count: fallbackCount }) : ''}
        </div>
      </div>

      {/* Error Rate */}
      <div className="stat-block">
        <div className="stat-block-accent" style={{ background: errorCount > 0 ? 'hsl(0 72% 50%)' : 'hsl(142 65% 40%)' }} />
        <div className="stat-block-label">
          {errorCount > 0 ? <AlertTriangle size={10} /> : <CheckCircle size={10} />}
          {t('stats.errorRate')}
        </div>
        <div className="stat-block-value" style={{ color: errorCount > 0 ? 'hsl(0 72% 50%)' : 'hsl(142 65% 40%)' }}>
          {errorRate !== '—' ? errorRate : '—'}
          {errorRate !== '—' && <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--muted-foreground)', marginLeft: '2px' }}>%</span>}
        </div>
        <div className="stat-block-sub">
          {stats ? t('stats.errors', { count: errorCount }) : ''}
        </div>
        <div className="stat-block-action">
          <button
            onClick={handleArchive}
            disabled={clearing}
            className="px-2.5 py-1 text-[10px] font-semibold rounded border border-border hover:bg-muted transition-colors disabled:opacity-50"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {clearing ? '...' : t('stats.clearLogs')}
          </button>
        </div>
      </div>

      {/* Data Collection */}
      <div className="stat-block">
        <div className="stat-block-accent" style={{ background: 'hsl(280 60% 55%)' }} />
        <div className="stat-block-label">
          <Database size={10} />
          {t('stats.dataCollection')}
        </div>
        <div className="stat-block-value" style={{ color: 'hsl(280 60% 55%)', fontSize: '1.25rem' }}>
          {schemaV3Coverage}<span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--muted-foreground)', marginLeft: '2px' }}>%</span>
        </div>
        <div className="stat-block-sub">
          v3: {featureSnapshotCount}/{total}
        </div>
        <div className="stat-block-sub" style={{ marginTop: '0.25rem' }}>
          {topIntentType !== '—' ? `${topIntentType} (${t('stats.taskTypes', { count: intentTypeCount })})` : '—'}
        </div>
      </div>
    </div>
  )
}
