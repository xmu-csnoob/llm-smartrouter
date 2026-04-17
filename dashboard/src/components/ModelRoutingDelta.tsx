import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

interface SwapPair {
  from: string
  to: string
  count: number
  pct: number
}

export function ModelRoutingDelta({ entries }: Props) {
  const { swapRate, swapCount, totalWithBoth, swapPairs } = useMemo(() => {
    let totalWithBoth = 0
    let swapCount = 0
    const swapMap: Record<string, number> = {}

    for (const entry of entries) {
      const requested = entry.requested_model
      const routed = entry.routed_model

      if (!requested || !routed) continue

      totalWithBoth++

      if (routed !== requested) {
        swapCount++
        const key = `${requested} → ${routed}`
        swapMap[key] = (swapMap[key] ?? 0) + 1
      }
    }

    const swapRate = totalWithBoth > 0 ? (swapCount / totalWithBoth) * 100 : 0

    const pairs: SwapPair[] = Object.entries(swapMap)
      .map(([key, count]) => {
        const [from, to] = key.split(' → ')
        return { from, to, count, pct: totalWithBoth > 0 ? (count / totalWithBoth) * 100 : 0 }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    return { swapRate, swapCount, totalWithBoth, swapPairs: pairs }
  }, [entries])

  const maxCount = swapPairs.length > 0 ? swapPairs[0].count : 1

  const badgeColor =
    swapRate > 20
      ? 'hsl(0, 72%, 55%)'
      : swapRate > 10
        ? 'hsl(38, 92%, 55%)'
        : 'hsl(145, 65%, 55%)'

  const hasData = totalWithBoth > 0

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.35rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '950ms',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: '9px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--muted-foreground)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Model Routing Delta
        </span>
        {hasData && (
          <span
            style={{
              fontSize: '6px',
              fontFamily: 'var(--font-mono)',
              color: badgeColor,
              fontWeight: 700,
              padding: '1px 4px',
              borderRadius: '3px',
              background: `${badgeColor}20`,
              border: `1px solid ${badgeColor}40`,
            }}
          >
            {swapRate.toFixed(1)}%
          </span>
        )}
      </div>

      {!hasData ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span
            style={{
              fontSize: '8px',
              fontFamily: 'var(--font-mono)',
              color: 'hsl(225, 45%, 20%)',
            }}
          >
            NO ROUTING DELTA DATA
          </span>
        </div>
      ) : (
        <>
          {/* Large swap count */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem' }}>
            <span
              style={{
                fontSize: '22px',
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                color: badgeColor,
                lineHeight: 1,
              }}
            >
              {swapCount.toLocaleString()}
            </span>
            <span
              style={{
                fontSize: '8px',
                fontFamily: 'var(--font-mono)',
                color: 'hsl(225, 45%, 30%)',
              }}
            >
              swaps / {totalWithBoth.toLocaleString()} total
            </span>
          </div>

          {/* Swap pair breakdown */}
          {swapPairs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.1rem' }}>
              {swapPairs.map((pair, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    minWidth: 0,
                  }}
                >
                  {/* Rank number */}
                  <span
                    style={{
                      fontSize: '5px',
                      fontFamily: 'var(--font-mono)',
                      color: 'hsl(225, 45%, 25%)',
                      width: '6px',
                      flex: '0 0 auto',
                      textAlign: 'right',
                    }}
                  >
                    {i + 1}
                  </span>

                  {/* From */}
                  <span
                    style={{
                      fontSize: '5px',
                      fontFamily: 'var(--font-mono)',
                      color: 'hsl(225, 45%, 35%)',
                      flex: '0 0 auto',
                      maxWidth: '48px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={pair.from}
                  >
                    {pair.from}
                  </span>

                  {/* Arrow */}
                  <span
                    style={{
                      fontSize: '5px',
                      fontFamily: 'var(--font-mono)',
                      color: 'hsl(185, 80%, 50%)',
                      flex: '0 0 auto',
                    }}
                  >
                    →
                  </span>

                  {/* To */}
                  <span
                    style={{
                      fontSize: '5px',
                      fontFamily: 'var(--font-mono)',
                      color: 'hsl(185, 80%, 50%)',
                      flex: '0 0 auto',
                      maxWidth: '48px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={pair.to}
                  >
                    {pair.to}
                  </span>

                  {/* Mini bar */}
                  <div
                    style={{
                      flex: 1,
                      height: '3px',
                      background: 'hsl(225, 45%, 10%)',
                      borderRadius: '1px',
                      overflow: 'hidden',
                      minWidth: '16px',
                    }}
                  >
                    <div
                      style={{
                        width: `${(pair.count / maxCount) * 100}%`,
                        height: '100%',
                        background: 'hsl(185, 80%, 50%)',
                        borderRadius: '1px',
                        boxShadow: '0 0 4px hsl(185, 80%, 50% / 0.5)',
                        transition: 'width 400ms ease',
                      }}
                    />
                  </div>

                  {/* Count */}
                  <span
                    style={{
                      fontSize: '5px',
                      fontFamily: 'var(--font-mono)',
                      color: 'hsl(225, 45%, 30%)',
                      flex: '0 0 auto',
                      width: '20px',
                      textAlign: 'right',
                    }}
                  >
                    {pair.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
