import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'
import { formatTimeAgo } from '@/lib/utils'

interface Props {
  entries: LogEntry[]
}

const INTENT_COLORS: Record<string, string> = {
  simple: 'hsl(145 65% 55%)',
  debug: 'hsl(38 92% 55%)',
  implementation: 'hsl(200 75% 55%)',
  architecture: 'hsl(280 65% 65%)',
  analysis: 'hsl(260 65% 55%)',
  general: 'hsl(0 0% 55%)',
}

const TIER_COLORS: Record<string, string> = {
  tier1: 'hsl(280 65% 65%)',
  tier2: 'hsl(200 75% 55%)',
  tier3: 'hsl(145 65% 50%)',
}

interface FallbackEvent {
  path: string       // "T1→T2"
  fromTier: string
  toTier: string
  intent: string
  intentColor: string
  error: string      // truncated to 40 chars
  tokens: number
  timeAgo: string
  index: number      // position for animation
}

function FallbackRow({ event, isNew }: { event: FallbackEvent; isNew: boolean }) {
  const fromColor = TIER_COLORS[event.fromTier] ?? 'hsl(0 0% 50%)'
  const toColor = TIER_COLORS[event.toTier] ?? 'hsl(0 0% 50%)'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.3rem',
      padding: '0.12rem 0.2rem',
      borderRadius: 4,
      background: isNew ? 'hsl(0 60% 8% / 0.4)' : 'transparent',
      borderBottom: '1px solid hsl(225 45% 10%)',
      animation: isNew ? 'flash-in 600ms ease' : 'none',
      transition: 'background 300ms ease',
    }}>
      {/* Degradation path badge */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: '6px', fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          color: fromColor,
        }}>
          {event.fromTier.replace('tier', 'T')}
        </span>
        <span style={{ fontSize: '6px', color: 'hsl(225 45% 20%)' }}>→</span>
        <span style={{
          fontSize: '6px', fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          color: toColor,
        }}>
          {event.toTier.replace('tier', 'T')}
        </span>
      </div>

      {/* Intent badge */}
      <div style={{
        fontSize: '5.5px', fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        color: event.intentColor,
        width: 28, flexShrink: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {event.intent}
      </div>

      {/* Error truncated */}
      <div style={{
        flex: 1,
        fontSize: '5.5px', fontFamily: 'var(--font-mono)',
        color: 'hsl(225 45% 35%)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        minWidth: 0,
      }}>
        {event.error}
      </div>

      {/* Tokens */}
      <div style={{
        fontSize: '5px', fontFamily: 'var(--font-mono)',
        color: 'hsl(225 45% 25%)',
        width: 32, flexShrink: 0, textAlign: 'right',
      }}>
        {event.tokens > 0 ? `${(event.tokens / 1000).toFixed(0)}k` : '—'}
      </div>

      {/* Relative time */}
      <div style={{
        fontSize: '5px', fontFamily: 'var(--font-mono)',
        color: 'hsl(225 45% 20%)',
        width: 36, flexShrink: 0, textAlign: 'right',
      }}>
        {event.timeAgo}
      </div>
    </div>
  )
}

export function RecentFallbackFeed({ entries }: Props) {
  const { events, totalFallbacks } = useMemo(() => {
    const fallbackEntries = entries
      .filter(e => e.is_fallback)
      .slice(0, 12)

    const events: FallbackEvent[] = fallbackEntries.map((entry, idx) => {
      const fromTier = entry.selected_tier || entry.routed_tier || 'tier?'
      let toTier = entry.degraded_to_tier ?? 'tier?'
      if (!toTier || toTier === fromTier) {
        toTier = entry.fallback_chain?.[0]?.tier ?? entry.routed_tier ?? 'tier?'
      }

      const intent = (entry.semantic_features?.intent ?? entry.task_type ?? 'general') as string
      const errorStr = entry.fallback_chain?.[0]?.error ?? entry.error ?? 'degraded'
      const errorTrunc = errorStr.length > 40 ? errorStr.slice(0, 40) + '…' : errorStr
      const tokens = entry.estimated_tokens ?? 0
      const timeAgo = entry.timestamp ? formatTimeAgo(entry.timestamp) : '—'

      return {
        path: `${fromTier}→${toTier}`,
        fromTier,
        toTier,
        intent: intent.slice(0, 8),
        intentColor: INTENT_COLORS[intent] ?? 'hsl(0 0% 55%)',
        error: errorTrunc,
        tokens,
        timeAgo,
        index: idx,
      }
    })

    const totalFallbacks = entries.filter(e => e.is_fallback).length
    return { events, totalFallbacks }
  }, [entries])

  const hasData = events.length > 0

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '930ms',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{
            fontSize: '9px', fontFamily: 'var(--font-mono)',
            color: 'var(--muted-foreground)', textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            Fallback Events
          </span>
          {totalFallbacks > 0 && (
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: 'hsl(0 72% 55%)',
              boxShadow: '0 0 6px hsl(0 72% 55%)',
              animation: 'pulse-dot 1.5s ease-in-out infinite',
            }} />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          {hasData ? (
            <span style={{
              fontSize: '5px', fontFamily: 'var(--font-mono)',
              color: 'hsl(0 72% 60%)',
              fontWeight: 600,
            }}>
              {totalFallbacks} total
            </span>
          ) : (
            <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
              NO FALLBACKS
            </span>
          )}
        </div>
      </div>

      {/* Column headers */}
      {hasData && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.3rem',
          padding: '0 0.2rem',
          borderBottom: '1px solid hsl(225 45% 12%)',
        }}>
          {[['PATH', 58], ['INTENT', 28], ['', 1], ['TOKENS', 32], ['TIME', 36]].map(([label, width]) => (
            <div key={label} style={{
              fontSize: '4.5px', fontFamily: 'var(--font-mono)',
              color: 'hsl(225 45% 20%)',
              letterSpacing: '0.06em',
              width, flexShrink: 0,
              textAlign: label === 'TOKENS' || label === 'TIME' ? 'right' : 'left',
            }}>
              {label}
            </div>
          ))}
        </div>
      )}

      {/* Event rows */}
      {!hasData ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            NO FALLBACK EVENTS
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {events.map(event => (
            <FallbackRow key={event.index} event={event} isNew={event.index === 0} />
          ))}
        </div>
      )}

      {/* Footer */}
      {hasData && (
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          paddingTop: '0.1rem',
          borderTop: '1px solid hsl(225 45% 12%)',
        }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            newest {events.length} events · last fallback_chain error
          </span>
        </div>
      )}
    </div>
  )
}
