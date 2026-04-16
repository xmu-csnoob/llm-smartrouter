import { useEffect, useRef, useState } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const MAX_ENTRIES = 20

const INTENT_COLORS: Record<string, string> = {
  simple: 'hsl(145 65% 55%)',
  debug: 'hsl(38 92% 55%)',
  implementation: 'hsl(200 75% 55%)',
  architecture: 'hsl(280 65% 65%)',
  analysis: 'hsl(260 65% 55%)',
  general: 'hsl(0 0% 55%)',
}

type StatusDot = 'ok' | 'fallback' | 'error'

function getStatusDot(entry: LogEntry): StatusDot {
  if (entry.status >= 400 || entry.error) return 'error'
  if (entry.is_fallback || (entry.fallback_chain && entry.fallback_chain.length > 0)) return 'fallback'
  return 'ok'
}

const STATUS_COLORS: Record<StatusDot, string> = {
  ok: 'hsl(145 65% 55%)',
  fallback: 'hsl(38 92% 55%)',
  error: 'hsl(0 72% 55%)',
}

const STATUS_GLOW: Record<StatusDot, string> = {
  ok: '0 0 4px hsl(145 65% 55% / 0.5)',
  fallback: '0 0 4px hsl(38 92% 55% / 0.5)',
  error: '0 0 4px hsl(0 72% 55% / 0.5)',
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function formatTs(ts: string) {
  try {
    const d = new Date(ts)
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  } catch {
    return '--:--:--'
  }
}

function truncateModel(model: string, max = 18) {
  if (!model) return '—'
  if (model.length <= max) return model
  return model.slice(0, max - 1) + '…'
}

function IntentBadge({ intent }: { intent: string }) {
  const color = INTENT_COLORS[intent] ?? 'hsl(0 0% 55%)'
  return (
    <span style={{
      fontSize: '4.5px',
      fontFamily: 'var(--font-mono)',
      fontWeight: 700,
      letterSpacing: '0.04em',
      color,
      textTransform: 'uppercase',
      flexShrink: 0,
    }}>
      {intent.slice(0, 6)}
    </span>
  )
}

function StatusDotEl({ dot }: { dot: StatusDot }) {
  return (
    <div style={{
      width: 5, height: 5,
      borderRadius: '50%',
      background: STATUS_COLORS[dot],
      boxShadow: STATUS_GLOW[dot],
      flexShrink: 0,
    }} />
  )
}

interface TickerEntry {
  id: string
  timestamp: string
  tsFormatted: string
  intent: string
  model: string
  latency: number | null
  dot: StatusDot
  isNew: boolean
}

export function RequestStreamLiveTicker({ entries }: Props) {
  const prevIdsRef = useRef<Set<string>>(new Set())
  const [visible, setVisible] = useState<TickerEntry[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const isScrolledToTop = useRef(true)

  useEffect(() => {
    // Build ticker entries from latest entries (newest first)
    const newIds = new Set(entries.map(e => e.request_id))
    const tickerEntries: TickerEntry[] = []

    for (const entry of entries) {
      if (tickerEntries.length >= MAX_ENTRIES) break
      const isNew = !prevIdsRef.current.has(entry.request_id)
      const dot = getStatusDot(entry)
      const intent = entry.semantic_features?.intent ?? entry.task_type ?? 'general'
      tickerEntries.push({
        id: entry.request_id,
        timestamp: entry.timestamp,
        tsFormatted: formatTs(entry.timestamp),
        intent,
        model: truncateModel(entry.routed_model ?? entry.requested_model),
        latency: entry.latency_ms,
        dot,
        isNew,
      })
    }

    setVisible(tickerEntries)

    // Auto-scroll to top if user hasn't scrolled away
    if (isScrolledToTop.current && containerRef.current) {
      containerRef.current.scrollTop = 0
    }

    prevIdsRef.current = newIds
  }, [entries])

  const handleScroll = () => {
    if (!containerRef.current) return
    isScrolledToTop.current = containerRef.current.scrollTop < 10
  }

  const hasErrors = visible.some(e => e.dot === 'error')

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.35rem 0.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.2rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '820ms',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* CRT scanline overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, hsl(225 45% 6%) 2px, hsl(225 45% 6%) 3px)',
        opacity: 0.07,
        pointerEvents: 'none',
        zIndex: 0,
      }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{
            fontSize: '8px', fontFamily: 'var(--font-mono)',
            color: 'var(--muted-foreground)', textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            Request Stream
          </span>
          {hasErrors && (
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'hsl(0 72% 55%)', boxShadow: '0 0 5px hsl(0 72% 55%)', animation: 'pulse-dot 1.5s ease-in-out infinite' }} />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {(['ok', 'fallback', 'error'] as StatusDot[]).map(dot => (
            <div key={dot} style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
              <div style={{ width: 4, height: 4, borderRadius: '50%', background: STATUS_COLORS[dot], boxShadow: STATUS_GLOW[dot] }} />
              <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)', textTransform: 'uppercase' }}>{dot === 'ok' ? 'OK' : dot === 'fallback' ? 'FB' : 'ERR'}</span>
            </div>
          ))}
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)', marginLeft: '0.15rem' }}>
            {visible.length} live
          </span>
        </div>
      </div>

      {/* Column labels */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.2rem',
        paddingBottom: '0.05rem',
        borderBottom: '1px solid hsl(225 45% 12%)',
        position: 'relative',
        zIndex: 1,
      }}>
        {['TIME', 'INTENT', 'MODEL', '', 'LAT', ''].map((label, i) => (
          <div key={i} style={{
            fontSize: '4px', fontFamily: 'var(--font-mono)',
            color: 'hsl(225 45% 20%)', letterSpacing: '0.06em',
            flex: i === 2 ? 1 : 'none',
            width: i === 0 ? 42 : i === 1 ? 34 : i === 3 ? 14 : i === 4 ? 28 : 5,
            textAlign: i === 4 ? 'right' : 'left',
          }}>
            {label}
          </div>
        ))}
      </div>

      {/* Scrollable feed */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.03rem',
          maxHeight: 72,
          overflowY: 'auto',
          position: 'relative',
          zIndex: 1,
          scrollbarWidth: 'thin',
          scrollbarColor: 'hsl(225 45% 15%) transparent',
        }}
      >
        {visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '0.3rem 0' }}>
            <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
              AWAITING STREAM...
            </span>
          </div>
        ) : (
          visible.map((entry, idx) => (
            <div
              key={entry.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.2rem',
                padding: '0.04rem 0.1rem',
                borderRadius: 2,
                background: entry.isNew && idx === 0
                  ? 'hsl(185 80% 50% / 0.05)'
                  : 'transparent',
                animation: entry.isNew && idx === 0
                  ? 'fade-in-down 250ms ease both'
                  : 'none',
                transition: 'background 300ms ease',
              }}
            >
              {/* Time */}
              <div style={{
                width: 42, flexShrink: 0,
                fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 35%)',
                letterSpacing: '0.02em',
              }}>
                {entry.tsFormatted}
              </div>

              {/* Intent */}
              <div style={{ width: 34, flexShrink: 0 }}>
                <IntentBadge intent={entry.intent} />
              </div>

              {/* Model */}
              <div style={{
                flex: 1,
                fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: 'var(--muted-foreground)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontWeight: 500,
              }}>
                {entry.model}
              </div>

              {/* Latency */}
              <div style={{
                width: 28, flexShrink: 0, textAlign: 'right',
                fontSize: '5px', fontFamily: 'var(--font-mono)',
                color: entry.dot === 'error' ? STATUS_COLORS.error
                  : entry.dot === 'fallback' ? STATUS_COLORS.fallback
                  : 'hsl(225 45% 40%)',
                fontWeight: 600,
              }}>
                {entry.latency != null ? `${entry.latency}ms` : '—'}
              </div>

              {/* Status dot */}
              <div style={{ width: 5, flexShrink: 0 }}>
                <StatusDotEl dot={entry.dot} />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {visible.length > 0 && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: '0.05rem',
          borderTop: '1px solid hsl(225 45% 10%)',
          position: 'relative',
          zIndex: 1,
        }}>
          <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            newest first · auto-scroll
          </span>
          <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            last {visible.length} of {entries.length} loaded
          </span>
        </div>
      )}
    </div>
  )
}
