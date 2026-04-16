import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import { fetchShadowPolicyStats, type ShadowPolicyStats } from '@/hooks/useApi'
import { Shield, AlertTriangle, TrendingDown, Activity } from 'lucide-react'

function ModeBadge({ mode }: { mode: string }) {
  const colors: Record<string, string> = {
    off: 'hsl(0 0% 50%)',
    observe_only: 'hsl(200 75% 45%)',
    forced_lower_tier: 'hsl(142 65% 40%)',
  }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={{ background: colors[mode] || 'hsl(0 0% 50%)', color: 'hsl(0 0% 100%)' }}
    >
      {mode}
    </span>
  )
}

export function ShadowPolicyPanel() {
  const { t } = useI18n()
  const [stats, setStats] = useState<ShadowPolicyStats | null>(null)
  const [hours, setHours] = useState(24)

  useEffect(() => {
    const load = async () => {
      try {
        const s = await fetchShadowPolicyStats(hours)
        setStats(s)
      } catch {}
    }
    load()
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [hours])

  if (!stats) {
    return (
      <div className="gs-panel">
        <div className="gs-panel-header">
          <span className="gs-eyebrow">{t('shadow.title')}</span>
        </div>
        <div className="gs-panel-body text-muted-foreground text-sm py-8 text-center">
          {t('chart.noData')}
        </div>
      </div>
    )
  }

  const total = stats.total_requests || 1
  const shadowPct = Math.round((stats.shadow_requests / total) * 100)
  const forcedPct = Math.round((stats.forced_lower_tier_count / total) * 100)

  const tierTransitions = Object.entries(stats.forced_tier_transitions || {})

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Shield size={16} className="text-muted-foreground" />
        <span className="font-semibold text-sm">{t('shadow.title')}</span>
        <ModeBadge mode={stats.shadow_enabled ? (Object.keys(stats.mode_counts)[0] || 'observe_only') : 'off'} />
        <span className="text-xs text-muted-foreground ml-auto">
          {t('shadow.window', { hours: stats.window_hours })}
        </span>
      </div>

      {/* Summary row */}
      <div className="flex gap-4 flex-wrap">
        <div className="stat-block" style={{ flex: '1 1 100px', minWidth: 100 }}>
          <div className="stat-block-accent" style={{ background: 'hsl(200 75% 45%)' }} />
          <div className="stat-block-label">{t('shadow.shadowRequests')}</div>
          <div className="stat-block-value">{stats.shadow_requests.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground font-mono">{shadowPct}% of total</div>
        </div>
        <div className="stat-block" style={{ flex: '1 1 100px', minWidth: 100 }}>
          <div className="stat-block-accent" style={{ background: 'hsl(142 65% 40%)' }} />
          <div className="stat-block-label">{t('shadow.forcedExecutions')}</div>
          <div className="stat-block-value">{stats.forced_lower_tier_count.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground font-mono">{forcedPct}% of total</div>
        </div>
        <div className="stat-block" style={{ flex: '1 1 100px', minWidth: 100 }}>
          <div className="stat-block-accent" style={{ background: 'hsl(25 85% 50%)' }} />
          <div className="stat-block-label">{t('shadow.exclusions')}</div>
          <div className="stat-block-value">{stats.exclusion_count.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground font-mono">{Object.keys(stats.exclusion_reasons || {}).length} types</div>
        </div>
        {stats.avg_latency_shadow_ms != null && stats.avg_latency_primary_ms != null && (
          <div className="stat-block" style={{ flex: '1 1 120px', minWidth: 120 }}>
            <div className="stat-block-accent" style={{ background: 'hsl(280 60% 55%)' }} />
            <div className="stat-block-label">{t('shadow.latencySavings')}</div>
            <div className="stat-block-value" style={{ fontSize: '1rem', color: 'hsl(142 65% 40%)' }}>
              {Math.round(stats.avg_latency_primary_ms - stats.avg_latency_shadow_ms)}ms
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              {stats.avg_latency_shadow_ms}ms shadow vs {stats.avg_latency_primary_ms}ms primary
            </div>
          </div>
        )}
      </div>

      {/* Latency comparison */}
      {(stats.avg_latency_shadow_ms || stats.avg_latency_primary_ms) && (
        <div className="gs-panel">
          <div className="gs-panel-header">
            <span className="gs-eyebrow">{t('shadow.latencyComparison')}</span>
          </div>
          <div className="gs-panel-body">
            <div className="flex gap-6 flex-wrap">
              {[
                { label: 'P50 Shadow', value: stats.p50_shadow_ms, color: 'hsl(200 75% 45%)' },
                { label: 'P95 Shadow', value: stats.p95_shadow_ms, color: 'hsl(200 75% 45%)' },
                { label: 'P50 Primary', value: stats.p50_primary_ms, color: 'hsl(280 60% 55%)' },
                { label: 'P95 Primary', value: stats.p95_primary_ms, color: 'hsl(280 60% 55%)' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex-1 min-w-20">
                  <div className="text-xs text-muted-foreground mb-1">{label}</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'hsl(var(--border))' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          background: color,
                          width: `${Math.min(((value || 0) / (stats.p95_primary_ms || 1)) * 100, 100)}%`,
                        }}
                      />
                    </div>
                    <span className="font-mono text-xs font-semibold" style={{ color }}>
                      {value != null ? `${value}ms` : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Forced tier transitions */}
      {tierTransitions.length > 0 && (
        <div className="gs-panel">
          <div className="gs-panel-header">
            <TrendingDown size={12} style={{ display: 'inline', marginRight: 4 }} />
            <span className="gs-eyebrow">{t('shadow.tierTransitions')}</span>
          </div>
          <div className="gs-panel-body">
            <div className="flex gap-2 flex-wrap">
              {tierTransitions.map(([transition, count]) => (
                <span
                  key={transition}
                  className="inline-flex items-center px-2 py-1 rounded text-xs font-mono"
                  style={{ background: 'hsl(142 65% 40%)', color: 'hsl(0 0% 100%)' }}
                >
                  {transition.replace('_to_', ' → ')}: {count}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Exclusion events */}
      {stats.recent_exclusion_events.length > 0 && (
        <div className="gs-panel">
          <div className="gs-panel-header">
            <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4 }} />
            <span className="gs-eyebrow">{t('shadow.recentExclusions')}</span>
          </div>
          <div className="gs-panel-body">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">{t('table.time')}</th>
                    <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">{t('table.tier')}</th>
                    <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">Reason</th>
                    <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">Triggered Rules</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recent_exclusion_events.slice(0, 10).map((event, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-1.5 px-2 font-mono text-muted-foreground">
                        {event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : '—'}
                      </td>
                      <td className="py-1.5 px-2 font-mono">{event.routed_tier || '—'}</td>
                      <td className="py-1.5 px-2 text-warning">{event.reason || '—'}</td>
                      <td className="py-1.5 px-2 font-mono">
                        <div className="flex gap-1 flex-wrap">
                          {(event.triggered_rules || []).slice(0, 3).map((r) => (
                            <span key={r} className="inline-flex items-center px-1 py-0.5 rounded" style={{ background: 'hsl(25 85% 50% / 0.2)', color: 'hsl(25 85% 50%)' }}>
                              {r}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Window selector */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Activity size={12} />
        <span>{t('stats.period24h')}:</span>
        {[6, 24, 72, 168].map((h) => (
          <button
            key={h}
            onClick={() => setHours(h)}
            className={`px-1.5 py-0.5 rounded font-mono ${hours === h ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
          >
            {h}h
          </button>
        ))}
      </div>
    </div>
  )
}
