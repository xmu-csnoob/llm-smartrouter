import { useState, useRef, useEffect } from 'react'
import type { Stats, ModelStats } from '@/hooks/useApi'
import { archiveLogs } from '@/hooks/useApi'
import { useI18n } from '@/i18n'

interface Props {
  stats: Stats | null
  modelStats?: ModelStats | null
  onRefresh: () => void
}

// ── Animated number counter hook ──────────────────────────────────────────────
function useCountUp(target: number, enabled: boolean) {
  const [display, setDisplay] = useState(target)
  const prevRef = useRef(target)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled || target === prevRef.current) return

    const from = prevRef.current
    const diff = target - from
    const duration = Math.min(Math.abs(diff) * 1.5, 600) // scale duration with diff size, cap 600ms

    const animate = (ts: number) => {
      if (startRef.current === null) startRef.current = ts
      const elapsed = ts - startRef.current
      const t = Math.min(elapsed / duration, 1)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + diff * eased))
      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        prevRef.current = target
        startRef.current = null
        setDisplay(target)
      }
    }

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(animate)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [target, enabled])

  return display
}

// ── Animated stat value ──────────────────────────────────────────────────────
function AnimatedNumber({ value, format }: { value: number; format?: (n: number) => string }) {
  const animated = useCountUp(value, true)
  const display = format ? format(animated) : animated.toLocaleString()
  return <>{display}</>
}

export function StatsCards({ stats, onRefresh }: Props) {
  const { t } = useI18n()
  const [clearing, setClearing] = useState(false)
  const [flashIdx, setFlashIdx] = useState(0)

  // Track previous stat values to trigger flash on change
  const prevTotal = useRef(0)
  const prevErrors = useRef(0)
  const prevFallbacks = useRef(0)

  useEffect(() => {
    if (!stats) return
    const changed = (
      stats.total !== prevTotal.current ||
      stats.errors !== prevErrors.current ||
      stats.fallbacks !== prevFallbacks.current
    )
    if (changed && prevTotal.current !== 0) {
      setFlashIdx(i => i + 1)
    }
    prevTotal.current = stats.total ?? 0
    prevErrors.current = stats.errors ?? 0
    prevFallbacks.current = stats.fallbacks ?? 0
  }, [stats])

  const total = stats?.total ?? 0
  const avgLatencyMs = stats?.avg_latency_ms ?? 0
  const avgTtft = stats?.avg_ttft_ms != null ? `${stats.avg_ttft_ms}` : '—'
  const errorRateNum = stats?.error_rate ?? 0
  const fallbackRateNum = stats?.fallback_rate ?? 0
  const errorCount = stats?.errors ?? 0
  const fallbackCount = stats?.fallbacks ?? 0

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
      <div className="stat-block" data-flash={flashIdx > 0 ? "true" : undefined}>
        <div className="stat-block-label">
          <span className="label-dot" />
          {t('stats.totalRequests')}
        </div>
        <div className="stat-block-value">
          <AnimatedNumber value={total} />
        </div>
        <div className="stat-block-sub">{t('stats.period24h')}</div>
        <div className="stat-block-action" />
      </div>

      {/* Avg Latency */}
      <div className="stat-block" data-flash={flashIdx > 0 ? "true" : undefined}>
        <div className="stat-block-label">
          <span className="label-dot" style={{ background: 'hsl(200 75% 55%)', boxShadow: '0 0 6px hsl(200 75% 55% / 0.4)' }} />
          {t('stats.avgLatency')}
        </div>
        <div className="stat-block-value" style={{ color: 'hsl(200 75% 55%)' }}>
          <AnimatedNumber value={avgLatencyMs} />
          <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--muted-foreground)', marginLeft: '2px' }}>ms</span>
        </div>
        <div className="stat-block-sub">
          TTFT: {avgTtft !== '—' ? `${avgTtft}ms` : '—'}
        </div>
      </div>

      {/* Fallback Rate */}
      <div className="stat-block" data-flash={flashIdx > 0 ? "true" : undefined}>
        <div className="stat-block-label">
          <span className="label-dot" style={{ background: 'hsl(145 65% 55%)', boxShadow: '0 0 6px hsl(145 65% 55% / 0.4)' }} />
          {t('stats.fallbackRate')}
        </div>
        <div className="stat-block-value" style={{ color: 'hsl(145 65% 55%)' }}>
          <AnimatedNumber value={fallbackRateNum} />
          <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--muted-foreground)', marginLeft: '2px' }}>%</span>
        </div>
        <div className="stat-block-sub">
          {stats ? t('stats.fallbacks', { count: fallbackCount }) : ''}
        </div>
      </div>

      {/* Error Rate */}
      <div className="stat-block" data-flash={flashIdx > 0 ? "true" : undefined}>
        <div className="stat-block-label">
          {errorCount > 0
            ? <span className="label-dot" style={{ background: 'hsl(0 72% 60%)', boxShadow: '0 0 6px hsl(0 72% 60% / 0.4)', animation: 'none' }} />
            : <span className="label-dot" style={{ background: 'hsl(145 65% 55%)', boxShadow: '0 0 6px hsl(145 65% 55% / 0.4)' }} />
          }
          {t('stats.errorRate')}
        </div>
        <div className="stat-block-value" style={{ color: errorCount > 0 ? 'hsl(0 72% 60%)' : 'hsl(145 65% 55%)' }}>
          <AnimatedNumber value={errorRateNum} />
          <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--muted-foreground)', marginLeft: '2px' }}>%</span>
        </div>
        <div className="stat-block-sub">
          {stats ? t('stats.errors', { count: errorCount }) : ''}
        </div>
        <div className="stat-block-action">
          <button
            onClick={handleArchive}
            disabled={clearing}
            style={{ padding: '0.25rem 0.625rem', fontSize: '0.625rem', fontWeight: 600, borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--muted)', color: 'var(--muted-foreground)', cursor: clearing ? 'not-allowed' : 'pointer', opacity: clearing ? 0.5 : 1, transition: 'all 150ms', fontFamily: 'var(--font-mono)' }}
          >
            {clearing ? '...' : t('stats.clearLogs')}
          </button>
        </div>
      </div>

      {/* Data Collection */}
      <div className="stat-block" data-flash={flashIdx > 0 ? "true" : undefined}>
        <div className="stat-block-label">
          <span className="label-dot" style={{ background: 'hsl(260 65% 65%)', boxShadow: '0 0 6px hsl(260 65% 65% / 0.4)' }} />
          {t('stats.dataCollection')}
        </div>
        <div className="stat-block-value" style={{ color: 'hsl(260 65% 65%)', fontSize: '1.25rem' }}>
          <AnimatedNumber value={schemaV3Coverage} />
          <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--muted-foreground)', marginLeft: '2px' }}>%</span>
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
