import type { Stats } from '@/hooks/useApi'

interface Props {
  stats: Stats | null
}

const MEDAL_COLORS = [
  'hsl(45 85% 60%)', // gold
  'hsl(30 80% 65%)', // silver
  'hsl(30 50% 55%)', // bronze
]

interface ModelRow {
  name: string
  errorRate: number
  latencyMs: number
  requestCount: number
  healthScore: number
}

function HealthRow({ row, rank, isTop }: { row: ModelRow; rank: number; isTop: boolean }) {
  const isWarning = row.errorRate >= 1 || row.latencyMs >= 2000
  const isCritical = row.errorRate >= 3 || row.latencyMs >= 5000

  const rowBg = isCritical
    ? 'hsl(0 50% 8% / 0.4)'
    : isWarning
    ? 'hsl(38 60% 8% / 0.3)'
    : isTop
    ? 'hsl(145 50% 8% / 0.3)'
    : 'transparent'

  const medalColor = rank <= 3 ? MEDAL_COLORS[rank - 1] : null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.3rem',
      padding: '0.15rem 0.3rem',
      borderRadius: 4,
      background: rowBg,
      transition: 'background 300ms ease',
      borderBottom: '1px solid hsl(225 45% 12%)',
    }}>
      {/* Rank / Medal */}
      <div style={{ width: 14, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
        {medalColor ? (
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: medalColor, boxShadow: `0 0 4px ${medalColor}` }} />
        ) : (
          <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>{rank}</span>
        )}
      </div>

      {/* Model name */}
      <div style={{
        flex: 1,
        fontSize: '6.5px', fontFamily: 'var(--font-mono)',
        color: isCritical ? 'hsl(0 72% 65%)' : isWarning ? 'hsl(38 92% 60%)' : 'var(--foreground)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
      }}>
        {row.name}
      </div>

      {/* Error rate */}
      <div style={{
        fontSize: '6px', fontFamily: 'var(--font-mono)', fontWeight: 600,
        color: row.errorRate >= 3 ? 'hsl(0 72% 65%)' : row.errorRate >= 1 ? 'hsl(38 92% 60%)' : 'hsl(145 65% 55%)',
        width: 36, textAlign: 'right', flexShrink: 0,
      }}>
        {row.errorRate.toFixed(1)}%
      </div>

      {/* Latency */}
      <div style={{
        fontSize: '6px', fontFamily: 'var(--font-mono)',
        color: row.latencyMs >= 5000 ? 'hsl(0 72% 65%)' : row.latencyMs >= 2000 ? 'hsl(38 92% 60%)' : 'var(--foreground)',
        width: 40, textAlign: 'right', flexShrink: 0,
      }}>
        {row.latencyMs >= 1000 ? `${(row.latencyMs / 1000).toFixed(1)}s` : `${row.latencyMs.toFixed(0)}ms`}
      </div>

      {/* Request count */}
      <div style={{
        fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)',
        width: 40, textAlign: 'right', flexShrink: 0,
      }}>
        {row.requestCount.toLocaleString()}
      </div>
    </div>
  )
}

export function ModelHealthLeaderboard({ stats }: Props) {
  const modelEntries = stats?.models ? Object.entries(stats.models) : []

  if (modelEntries.length === 0) {
    return (
      <div className="gs-panel" style={{
        padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem',
        animation: 'fade-in-up 400ms ease both', animationDelay: '800ms', minHeight: 140,
      }}>
        <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Model Health
        </span>
        <div style={{ textAlign: 'center', padding: '1rem 0' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>NO MODEL DATA</span>
        </div>
      </div>
    )
  }

  // Build rows: health score = 100 - (error_rate * 20) - (latency / 100)
  const rows: ModelRow[] = modelEntries.map(([name, m]) => {
    const errorRate = m.count > 0 ? (m.errors / m.count) * 100 : 0
    const latencyMs = m.avg_latency_ms ?? 0
    return { name, errorRate, latencyMs, requestCount: m.count, healthScore: 100 - (errorRate * 20) - (latencyMs / 100) }
  })

  // Sort: healthiest (highest score) first
  const sorted = [...rows].sort((a, b) => b.healthScore - a.healthScore)

  return (
    <div className="gs-panel" style={{
      padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem',
      animation: 'fade-in-up 400ms ease both', animationDelay: '800ms',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Model Health
          </span>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'hsl(185 80% 50%)', boxShadow: '0 0 6px hsl(185 80% 50%)', animation: 'pulse-dot 2.5s ease-in-out infinite' }} />
        </div>
        {sorted[0] && sorted[0].errorRate < 1 && sorted[0].latencyMs < 2000 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem', padding: '0.1rem 0.3rem', borderRadius: 4, background: 'hsl(145 50% 10%)', border: '1px solid hsl(145 65% 40% / 0.3)' }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'hsl(145 65% 55%)', boxShadow: '0 0 4px hsl(145 65% 55%)' }} />
            <span style={{ fontSize: '5.5px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'hsl(145 65% 55%)', letterSpacing: '0.05em' }}>NOMINAL</span>
          </div>
        )}
      </div>

      {/* Column headers */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0 0.3rem 0.1rem', borderBottom: '1px solid var(--border)' }}>
        {['#', 'MODEL', 'ERR%', 'LAT', 'REQS'].map((h, i) => (
          <div key={h} style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)',
            letterSpacing: '0.05em',
            width: i === 0 ? 14 : i === 1 ? undefined : (i === 2 ? 36 : i === 3 ? 40 : 40),
            textAlign: i >= 2 ? 'right' : 'left',
            flex: i === 1 ? 1 : undefined,
          }}>
            {h}
          </div>
        ))}
      </div>

      {/* Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.05rem' }}>
        {sorted.slice(0, 6).map((row, i) => (
          <HealthRow key={row.name} row={row} rank={i + 1} isTop={i === 0} />
        ))}
      </div>
    </div>
  )
}
