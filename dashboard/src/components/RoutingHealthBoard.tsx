import { useState } from 'react'
import { useI18n } from '@/i18n'
import type { Stats } from '@/hooks/useApi'

interface Props {
  stats: Stats | null
}

type SortKey = 'health' | 'count' | 'latency' | 'errors' | 'fallback' | 'coverage'

const TIER_COLORS: Record<string, string> = {
  tier1: 'hsl(280 65% 60%)',
  tier2: 'hsl(200 75% 55%)',
  tier3: 'hsl(145 65% 48%)',
}

function getTier(name: string): string {
  const n = name.toLowerCase()
  if (/sonnet|opus|gpt-4|claude|gemini-2|grok/.test(n)) return 'tier1'
  if (/mini|tiny|gpt-3|haiku|qwen|deepseek-7/.test(n)) return 'tier3'
  return 'tier2'
}

function computeHealth(stats: Stats, model: string): number {
  const ms = stats.models[model]
  if (!ms || ms.count === 0) return 0

  const errorRate = ms.errors / ms.count
  const fallbackRate = (stats.fallbacks || 0) / (stats.total || 1)
  const latencyScore = Math.max(0, 1 - (ms.avg_latency_ms || 0) / 8000) // penalize if >8s

  // Composite: 60% latency, 25% error, 15% fallback avoidance
  const score = latencyScore * 0.6 + (1 - errorRate * 10) * 0.25 + (1 - fallbackRate * 5) * 0.15
  return Math.max(0, Math.min(1, score)) * 100
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  return (
    <span style={{ fontSize: 8, marginLeft: 2, opacity: active ? 1 : 0.3 }}>
      {active ? (dir === 'desc' ? '↓' : '↑') : '↕'}
    </span>
  )
}

export function RoutingHealthBoard({ stats }: Props) {
  const { t } = useI18n()
  const [sortKey, setSortKey] = useState<SortKey>('health')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  if (!stats || Object.keys(stats.models).length === 0) {
    return <div className="gs-empty-state">{t('chart.noData')}</div>
  }

  const models = Object.keys(stats.models)
  const totalRequests = stats.total || 1

  const rows = models.map((model) => {
    const ms = stats.models[model]
    const tier = getTier(model)
    const health = computeHealth(stats, model)
    const errorRate = ms.count > 0 ? (ms.errors / ms.count) * 100 : 0
    const fallbackRate = stats.fallbacks && stats.total ? (stats.fallbacks / stats.total) * 100 : 0
    const coverage = stats.total > 0 ? (stats.feature_snapshot_count / stats.total) * 100 : 0
    const trafficShare = (ms.count / totalRequests) * 100

    return {
      model,
      tier,
      count: ms.count,
      errors: ms.errors,
      errorRate,
      latency: ms.avg_latency_ms || 0,
      fallbackRate,
      health,
      coverage,
      trafficShare,
    }
  })

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  rows.sort((a, b) => {
    const mult = sortDir === 'desc' ? -1 : 1
    if (sortKey === 'health') return (a.health - b.health) * mult
    if (sortKey === 'count') return (a.count - b.count) * mult
    if (sortKey === 'latency') return (a.latency - b.latency) * mult
    if (sortKey === 'errors') return (a.errors - b.errors) * mult
    if (sortKey === 'fallback') return (a.fallbackRate - b.fallbackRate) * mult
    if (sortKey === 'coverage') return (a.coverage - b.coverage) * mult
    return 0
  })

  const healthColor = (h: number) => {
    if (h >= 80) return 'hsl(145 65% 55%)'
    if (h >= 60) return 'hsl(45 85% 55%)'
    if (h >= 40) return 'hsl(25 95% 55%)'
    return 'hsl(0 72% 55%)'
  }

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      onClick={() => handleSort(k)}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: sortKey === k ? 'var(--primary)' : 'var(--muted-foreground)',
        fontFamily: 'var(--font-mono)',
        fontSize: '9px',
        fontWeight: 600,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        padding: '2px 4px',
        borderRadius: 3,
        transition: 'all 150ms',
      }}
    >
      {label}
      <SortIcon active={sortKey === k} dir={sortDir} />
    </button>
  )

  return (
    <div style={{ padding: '0.25rem 0.5rem', overflow: 'auto', maxHeight: 280 }}>
      {/* Header row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.2fr 1fr 0.8fr 0.8fr 1fr', gap: '0 6px', padding: '0 0 0.375rem 0', borderBottom: '1px solid var(--border)', marginBottom: '0.25rem' }}>
        <SortBtn k="health" label="Health" />
        <SortBtn k="count" label="Requests" />
        <SortBtn k="latency" label="Latency" />
        <SortBtn k="errors" label="Errors" />
        <SortBtn k="fallback" label="Fallback%" />
        <SortBtn k="coverage" label="v3%" />
        <div style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, textAlign: 'right' }}>Traffic</div>
      </div>

      {rows.map((row) => (
        <div
          key={row.model}
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1.2fr 1fr 0.8fr 0.8fr 1fr',
            gap: '0 6px',
            alignItems: 'center',
            padding: '0.25rem 0.25rem',
            borderRadius: 5,
            marginBottom: 2,
            background: 'transparent',
            transition: 'background 150ms',
          }}
          className="health-row"
        >
          {/* Model + tier badge + health bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0 }}>
            <div style={{ width: 3, height: 14, borderRadius: 2, background: TIER_COLORS[row.tier], flexShrink: 0, boxShadow: `0 0 4px ${TIER_COLORS[row.tier]}` }} />
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.model}
            </span>
          </div>

          {/* Health score */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--muted)', overflow: 'hidden' }}>
              <div style={{ width: `${row.health}%`, height: '100%', background: healthColor(row.health), borderRadius: 2, transition: 'width 600ms ease' }} />
            </div>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: healthColor(row.health), width: 26, textAlign: 'right', flexShrink: 0 }}>
              {row.health.toFixed(0)}
            </span>
          </div>

          {/* Latency */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: row.latency > 5000 ? 'hsl(25 95% 60%)' : 'var(--foreground)' }}>
              {row.latency}ms
            </span>
          </div>

          {/* Errors */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            {row.errors > 0 && (
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'hsl(0 72% 60%)', boxShadow: '0 0 4px hsl(0 72% 60%)', flexShrink: 0 }} />
            )}
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: row.errors > 0 ? 'hsl(0 72% 65%)' : 'var(--muted-foreground)' }}>
              {row.errors}
            </span>
          </div>

          {/* Fallback % */}
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: row.fallbackRate > 10 ? 'hsl(25 95% 60%)' : 'var(--muted-foreground)' }}>
            {row.fallbackRate.toFixed(1)}%
          </span>

          {/* Coverage */}
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: row.coverage > 80 ? 'hsl(145 65% 55%)' : 'var(--muted-foreground)' }}>
            {row.coverage.toFixed(0)}%
          </span>

          {/* Traffic share bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', justifyContent: 'flex-end' }}>
            <div style={{ width: 32, height: 4, borderRadius: 2, background: 'var(--muted)', overflow: 'hidden' }}>
              <div style={{ width: `${row.trafficShare}%`, height: '100%', background: TIER_COLORS[row.tier], opacity: 0.7, borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', width: 26, textAlign: 'right', flexShrink: 0 }}>
              {row.trafficShare.toFixed(0)}%
            </span>
          </div>
        </div>
      ))}

      <style>{`
        .health-row:hover {
          background: hsl(200 75% 50% / 0.05) !important;
        }
      `}</style>
    </div>
  )
}
