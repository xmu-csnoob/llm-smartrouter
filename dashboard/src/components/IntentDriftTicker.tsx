import { useState, useEffect, useRef } from 'react'
import type { Stats } from '@/hooks/useApi'

interface Props {
  stats: Stats | null
}

const INTENT_ORDER = ['simple', 'debug', 'implementation', 'architecture', 'analysis', 'general'] as const
type IntentType = typeof INTENT_ORDER[number]

const INTENT_COLORS: Record<IntentType, string> = {
  simple: 'hsl(145 65% 50%)',
  debug: 'hsl(45 85% 60%)',
  implementation: 'hsl(200 75% 55%)',
  architecture: 'hsl(280 65% 65%)',
  analysis: 'hsl(260 65% 55%)',
  general: 'hsl(0 0% 55%)',
}

const INTENT_LABELS: Record<IntentType, string> = {
  simple: 'Simple',
  debug: 'Debug',
  implementation: 'Impl',
  architecture: 'Arch',
  analysis: 'Analysis',
  general: 'General',
}

interface BarItem {
  type: IntentType
  count: number
  pct: number
  delta: number // change from previous snapshot
}

export function IntentDriftTicker({ stats }: Props) {
  const prevIntent = useRef<string | null>(null)
  const prevCounts = useRef<Record<string, number>>({})
  const [flash, setFlash] = useState(false)
  const [bars, setBars] = useState<BarItem[]>([])
  const [tickerItems, setTickerItems] = useState<string[]>([])
  const [topIntent, setTopIntent] = useState<IntentType>('general')

  useEffect(() => {
    if (!stats?.task_types) return

    const counts: Record<string, number> = {}
    let total = 0
    for (const key of INTENT_ORDER) {
      counts[key] = stats.task_types[key] ?? 0
      total += counts[key]
    }

    // Detect dominant intent change → flash
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] as IntentType | undefined
    if (dominant && dominant !== prevIntent.current && prevIntent.current !== null) {
      setFlash(true)
      setTimeout(() => setFlash(false), 600)
    }
    if (dominant) {
      prevIntent.current = dominant
      setTopIntent(dominant)
    }

    // Build bar items with delta
    const newBars: BarItem[] = INTENT_ORDER.map(type => {
      const count = counts[type] ?? 0
      const prev = prevCounts.current[type] ?? 0
      return {
        type,
        count,
        pct: total > 0 ? (count / total) * 100 : 0,
        delta: count - prev,
      }
    })
    setBars(newBars)

    // Build ticker items (recent intents in order of frequency)
    const sorted = [...INTENT_ORDER].sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))
    setTickerItems(sorted.filter(type => (counts[type] ?? 0) > 0).map(type => INTENT_LABELS[type]))

    prevCounts.current = { ...counts }
  }, [stats])

  const maxPct = Math.max(...bars.map(b => b.pct), 1)

  const flashColor = INTENT_COLORS[topIntent]

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        overflow: 'hidden',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '660ms',
        boxShadow: flash ? `inset 0 0 0 1px ${flashColor}80, 0 0 18px ${flashColor}30` : undefined,
        transition: 'box-shadow 300ms ease',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Intent Drift
          </span>
          {/* Live pulse */}
          <div style={{
            width: 5, height: 5, borderRadius: '50%',
            background: 'hsl(185 80% 50%)',
            boxShadow: '0 0 6px hsl(185 80% 50%)',
            animation: 'pulse-dot 2.5s ease-in-out infinite',
          }} />
        </div>
        {/* Top intent badge */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.25rem',
          padding: '0.1rem 0.4rem',
          borderRadius: 4,
          background: `${INTENT_COLORS[topIntent]}20`,
          border: `1px solid ${INTENT_COLORS[topIntent]}50`,
          boxShadow: flash ? `0 0 8px ${INTENT_COLORS[topIntent]}40` : 'none',
          transition: 'box-shadow 300ms ease',
        }}>
          <div style={{
            width: 4, height: 4, borderRadius: '50%',
            background: INTENT_COLORS[topIntent],
            boxShadow: `0 0 4px ${INTENT_COLORS[topIntent]}`,
          }} />
          <span style={{
            fontSize: '7px', fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            color: INTENT_COLORS[topIntent],
            letterSpacing: '0.04em',
          }}>
            {INTENT_LABELS[topIntent]}
          </span>
        </div>
      </div>

      {/* Horizontal bar chart */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
        {bars.map(({ type, pct, count, delta }) => {
          const widthPct = (pct / maxPct) * 100
          const hasDelta = delta !== 0
          const isTop = type === topIntent
          return (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              {/* Label */}
              <div style={{
                fontSize: '6px', fontFamily: 'var(--font-mono)',
                color: isTop ? INTENT_COLORS[type] : 'var(--muted-foreground)',
                width: 52, flexShrink: 0,
                fontWeight: isTop ? 700 : 400,
              }}>
                {INTENT_LABELS[type]}
              </div>
              {/* Bar track */}
              <div style={{
                flex: 1,
                height: 6,
                background: 'hsl(225 45% 12%)',
                borderRadius: 3,
                overflow: 'hidden',
                position: 'relative',
              }}>
                <div style={{
                  position: 'absolute',
                  left: 0, top: 0, bottom: 0,
                  width: `${widthPct}%`,
                  background: `linear-gradient(90deg, ${INTENT_COLORS[type]}60, ${INTENT_COLORS[type]})`,
                  borderRadius: 3,
                  boxShadow: isTop ? `0 0 6px ${INTENT_COLORS[type]}60` : 'none',
                  transition: 'width 500ms cubic-bezier(0.34, 1.2, 0.64, 1)',
                }} />
              </div>
              {/* Delta indicator */}
              {hasDelta && (
                <div style={{
                  fontSize: '5.5px', fontFamily: 'var(--font-mono)',
                  color: delta > 0 ? 'hsl(145 65% 55%)' : 'hsl(0 72% 60%)',
                  width: 28, flexShrink: 0, textAlign: 'right',
                  fontWeight: 600,
                }}>
                  {delta > 0 ? '+' : ''}{delta}
                </div>
              )}
              {!hasDelta && <div style={{ width: 28 }} />}
              {/* Count */}
              <div style={{
                fontSize: '6px', fontFamily: 'var(--font-mono)',
                color: 'var(--muted-foreground)',
                width: 24, flexShrink: 0, textAlign: 'right',
              }}>
                {count}
              </div>
            </div>
          )
        })}
      </div>

      {/* Ticker */}
      {tickerItems.length > 0 && (
        <div style={{
          overflow: 'hidden',
          position: 'relative',
          maskImage: 'linear-gradient(90deg, transparent, black 8%, black 92%, transparent)',
          WebkitMaskImage: 'linear-gradient(90deg, transparent, black 8%, black 92%, transparent)',
        }}>
          <div className="intent-ticker-track" style={{
            display: 'flex', gap: '0.75rem', width: 'max-content',
          }}>
            {[...tickerItems, ...tickerItems].map((item, i) => (
              <span key={i} style={{
                fontSize: '7px', fontFamily: 'var(--font-mono)',
                color: 'var(--muted-foreground)',
                whiteSpace: 'nowrap',
                letterSpacing: '0.03em',
              }}>
                {item}
              </span>
            ))}
            <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>·</span>
          </div>
        </div>
      )}
    </div>
  )
}
