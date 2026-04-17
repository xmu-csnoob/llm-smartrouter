import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

type WarmthLevel = 'hot' | 'warm' | 'cold'

interface ModelWarmth {
  model: string
  lastTimestamp: number
  warmth: WarmthLevel
  secondsAgo: number
}

const WARMTH_COLORS: Record<WarmthLevel, string> = {
  hot: 'hsl(145 65% 55%)',
  warm: 'hsl(185 80% 50%)',
  cold: 'hsl(225 45% 25%)',
}

const WARMTH_BAR_WIDTH: Record<WarmthLevel, string> = {
  hot: '100%',
  warm: '50%',
  cold: '10%',
}

function getWarmth(secondsAgo: number): WarmthLevel {
  if (secondsAgo < 60) return 'hot'
  if (secondsAgo < 300) return 'warm'
  return 'cold'
}

function formatTimeAgo(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

function truncateModelName(name: string, maxLen = 18): string {
  if (name.length <= maxLen) return name
  return name.slice(0, maxLen - 2) + '..'
}

export function ModelWarmthIndicator({ entries }: Props) {
  const { topModels, coldModels, hotCount, warmCount, coldCount } = useMemo(() => {
    const now = Date.now()

    // Group entries by routed_model and find most recent timestamp per model
    const modelTimestamps: Record<string, number> = {}
    for (const entry of entries) {
      const model = entry.routed_model || 'unknown'
      const ts = new Date(entry.timestamp).getTime()
      if (isNaN(ts)) continue
      if (!modelTimestamps[model] || ts > modelTimestamps[model]) {
        modelTimestamps[model] = ts
      }
    }

    // Compute warmth for each model
    const modelWarmths: ModelWarmth[] = Object.entries(modelTimestamps).map(([model, lastTs]) => {
      const secondsAgo = (now - lastTs) / 1000
      return {
        model,
        lastTimestamp: lastTs,
        warmth: getWarmth(secondsAgo),
        secondsAgo,
      }
    })

    // Sort by most recent (hottest first)
    modelWarmths.sort((a, b) => b.lastTimestamp - a.lastTimestamp)

    // Top 6 for main display
    const top6 = modelWarmths.slice(0, 6)

    // Cold models: no requests in > 10 minutes (600 seconds)
    const cold = modelWarmths.filter(m => m.secondsAgo > 600)

    const hotCount = modelWarmths.filter(m => m.warmth === 'hot').length
    const warmCount = modelWarmths.filter(m => m.warmth === 'warm').length
    const coldCount = modelWarmths.filter(m => m.warmth === 'cold').length

    return {
      topModels: top6,
      coldModels: cold,
      hotCount,
      warmCount,
      coldCount,
    }
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
        animationDelay: '958ms',
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
          Model Warmth
        </span>
        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <span style={{ fontSize: '5.5px', fontFamily: 'var(--font-mono)', color: WARMTH_COLORS.hot }}>
            {hotCount} HOT
          </span>
          <span style={{ fontSize: '5.5px', fontFamily: 'var(--font-mono)', color: WARMTH_COLORS.warm }}>
            {warmCount} WARM
          </span>
          <span style={{ fontSize: '5.5px', fontFamily: 'var(--font-mono)', color: WARMTH_COLORS.cold }}>
            {coldCount} COLD
          </span>
        </div>
      </div>

      {entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span
            style={{
              fontSize: '6px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--muted-foreground)',
              letterSpacing: '0.05em',
            }}
          >
            NO RECENT DATA
          </span>
        </div>
      ) : (
        <>
          {/* 3-column grid of warmth indicators */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '0.25rem',
            }}
          >
            {topModels.map((item) => (
              <div
                key={item.model}
                style={{
                  background: 'hsl(225 45% 10%)',
                  borderRadius: '3px',
                  padding: '0.25rem 0.3rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.15rem',
                  border: '1px solid hsl(225 45% 15%)',
                }}
              >
                {/* Model name */}
                <span
                  style={{
                    fontSize: '5px',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--foreground)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={item.model}
                >
                  {truncateModelName(item.model)}
                </span>

                {/* Warmth badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  <span
                    style={{
                      fontSize: '5px',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      color: WARMTH_COLORS[item.warmth],
                      textTransform: 'uppercase',
                    }}
                  >
                    {item.warmth.toUpperCase()}
                  </span>
                </div>

                {/* Time since last request */}
                <span
                  style={{
                    fontSize: '4.5px',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--muted-foreground)',
                  }}
                >
                  {formatTimeAgo(item.secondsAgo)}
                </span>

                {/* Warmth bar */}
                <div
                  style={{
                    height: '2px',
                    background: 'hsl(225 45% 15%)',
                    borderRadius: '1px',
                    overflow: 'hidden',
                    marginTop: '0.1rem',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: WARMTH_BAR_WIDTH[item.warmth],
                      background: WARMTH_COLORS[item.warmth],
                      transition: 'width 300ms ease',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Cold Models Section */}
          {coldModels.length > 0 && (
            <div style={{ marginTop: '0.15rem' }}>
              <div
                style={{
                  fontSize: '5px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--muted-foreground)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: '0.1rem',
                }}
              >
                Cold Models ({coldModels.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.15rem' }}>
                {coldModels.map((item) => (
                  <span
                    key={item.model}
                    style={{
                      fontSize: '4.5px',
                      fontFamily: 'var(--font-mono)',
                      color: WARMTH_COLORS.cold,
                      background: 'hsl(225 45% 8%)',
                      padding: '0.1rem 0.2rem',
                      borderRadius: '2px',
                    }}
                    title={`${item.model}: ${formatTimeAgo(item.secondsAgo)}`}
                  >
                    {truncateModelName(item.model, 12)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
