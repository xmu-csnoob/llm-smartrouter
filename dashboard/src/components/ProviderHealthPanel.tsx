import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

interface ProviderStats {
  name: string
  count: number
  errorRate: number
  avgLatency: number
}

function errorBarColor(rate: number): string {
  if (rate < 5) return 'hsl(145, 65%, 55%)'
  if (rate < 15) return 'hsl(38, 92%, 55%)'
  return 'hsl(0, 72%, 55%)'
}

export function ProviderHealthPanel({ entries }: Props) {
  const providers = useMemo<ProviderStats[]>(() => {
    const map = new Map<string, { count: number; errors: number; latencies: number[] }>()

    for (const e of entries) {
      const p = e.routed_provider
      if (!p) continue
      if (!map.has(p)) map.set(p, { count: 0, errors: 0, latencies: [] })
      const s = map.get(p)!
      s.count++
      if (e.status >= 400 || e.error != null) s.errors++
      if (e.latency_ms != null) s.latencies.push(e.latency_ms)
    }

    const result: ProviderStats[] = []
    for (const [name, s] of map) {
      if (s.count < 3) continue
      const avgLat = s.latencies.length > 0
        ? s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length
        : 0
      result.push({
        name,
        count: s.count,
        errorRate: (s.errors / s.count) * 100,
        avgLatency: avgLat,
      })
    }

    return result.sort((a, b) => b.errorRate - a.errorRate)
  }, [entries])

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.4rem 0.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.2rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '968ms',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: '0.1rem',
        }}
      >
        <span
          style={{
            fontSize: '9px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--muted-foreground)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Provider Health
        </span>
        <span
          style={{
            fontSize: '5.5px',
            fontFamily: 'var(--font-mono)',
            color: providers.length > 0 ? 'hsl(185, 80%, 50%)' : 'hsl(225, 45%, 20%)',
            fontWeight: 600,
          }}
        >
          {providers.length} provider{providers.length !== 1 ? 's' : ''}
        </span>
      </div>

      {providers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span
            style={{
              fontSize: '8px',
              fontFamily: 'var(--font-mono)',
              color: 'hsl(225, 45%, 25%)',
              letterSpacing: '0.06em',
            }}
          >
            NO PROVIDER DATA
          </span>
        </div>
      ) : (
        <>
          {/* Column headers */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.2rem',
              padding: '0 0.4rem 0.1rem',
              borderBottom: '1px solid hsl(225 45% 12%)',
            }}
          >
            {[['PROVIDER', 60], ['', 4], ['N', 18], ['ERR', 28], ['', 2], ['LAT', 36]].map(
              ([label, width], i) => (
                <div
                  key={i}
                  style={{
                    fontSize: '4.5px',
                    fontFamily: 'var(--font-mono)',
                    color: 'hsl(225, 45%, 20%)',
                    letterSpacing: '0.06em',
                    width,
                    flexShrink: 0,
                    textAlign: i === 2 || i === 3 || i === 5 ? 'right' : 'left',
                  }}
                >
                  {label}
                </div>
              ),
            )}
          </div>

          {/* Provider rows */}
          {providers.slice(0, 6).map((p) => {
            const barColor = errorBarColor(p.errorRate)
            return (
              <div
                key={p.name}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.08rem',
                  padding: '0.12rem 0.4rem',
                  borderBottom: '1px solid hsl(225 45% 10%)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  {/* Provider name */}
                  <div
                    style={{
                      fontSize: '7px',
                      fontFamily: 'var(--font-mono)',
                      color: 'hsl(225, 45%, 65%)',
                      width: 60,
                      flexShrink: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={p.name}
                  >
                    {p.name}
                  </div>

                  {/* Count badge */}
                  <div
                    style={{
                      fontSize: '5px',
                      fontFamily: 'var(--font-mono)',
                      color: 'hsl(225, 45%, 40%)',
                      width: 18,
                      flexShrink: 0,
                      textAlign: 'right',
                    }}
                  >
                    {p.count}
                  </div>

                  {/* Error rate bar + pct */}
                  <div
                    style={{
                      fontSize: '5.5px',
                      fontFamily: 'var(--font-mono)',
                      color: barColor,
                      width: 28,
                      flexShrink: 0,
                      textAlign: 'right',
                      fontWeight: 700,
                    }}
                  >
                    {p.errorRate.toFixed(1)}%
                  </div>

                  {/* Error bar track */}
                  <div
                    style={{
                      flex: 1,
                      height: 3,
                      background: 'hsl(225, 45%, 10%)',
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min(p.errorRate, 100)}%`,
                        height: '100%',
                        background: `linear-gradient(90deg, ${barColor}40, ${barColor}80)`,
                        borderRadius: 2,
                        boxShadow: `0 0 4px ${barColor}30`,
                        transition: 'width 600ms cubic-bezier(0.34, 1.2, 0.64, 1)',
                      }}
                    />
                  </div>

                  {/* Avg latency */}
                  <div
                    style={{
                      fontSize: '6px',
                      fontFamily: 'var(--font-mono)',
                      color: 'hsl(225, 45%, 45%)',
                      width: 36,
                      flexShrink: 0,
                      textAlign: 'right',
                    }}
                  >
                    {p.avgLatency.toFixed(0)}ms
                  </div>
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
