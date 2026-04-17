import { useEffect, useId, useRef, useState } from 'react'
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

// Phosphor glow for terminal text — restrained, authentic CRT feel
const PHOSPHOR_GLOW = '0 0 5px hsl(145 65% 55% / 0.35)'
const PHOSPHOR_GLOW_CHROMATIC = {
  r: '1px 0 3px hsl(0 72% 55% / 0.5)',
  b: '-1px 0 3px hsl(200 75% 60% / 0.5)',
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function formatTs(ts: string) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) {
    return '--:--:--'
  }
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function truncateModel(model: string, max = 18) {
  if (!model) return '—'
  if (model.length <= max) return model
  return model.slice(0, max - 1) + '…'
}

function IntentBadge({ intent, glowing }: { intent: string; glowing?: boolean }) {
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
      textShadow: glowing ? `0 0 6px ${color}80` : 'none',
    }}>
      {intent.slice(0, 6)}
    </span>
  )
}

function StatusDotEl({ dot, enhanced }: { dot: StatusDot; enhanced?: boolean }) {
  const radius = enhanced ? 3.5 : 2.5
  return (
    <div style={{
      width: radius * 2, height: radius * 2,
      borderRadius: '50%',
      background: STATUS_COLORS[dot],
      boxShadow: enhanced
        ? `0 0 8px ${STATUS_COLORS[dot]}, 0 0 16px ${STATUS_COLORS[dot]}50`
        : STATUS_GLOW[dot],
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
  const [glitchingId, setGlitchingId] = useState<string | null>(null)
  const glitchTimeoutRef = useRef<number | null>(null)
  const noiseFilterId = useId()

  useEffect(() => {
    return () => {
      if (glitchTimeoutRef.current != null) {
        window.clearTimeout(glitchTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const newIds = new Set(entries.map(e => e.request_id))
    const tickerEntries: TickerEntry[] = []
    let nextGlitchId: string | null = null

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

      // Trigger chromatic aberration glitch for newly-seen entries
      if (isNew && tickerEntries.length === 1 && nextGlitchId == null) {
        nextGlitchId = entry.request_id
      }
    }

    if (glitchTimeoutRef.current != null) {
      window.clearTimeout(glitchTimeoutRef.current)
      glitchTimeoutRef.current = null
    }
    setGlitchingId(nextGlitchId)
    if (nextGlitchId != null) {
      glitchTimeoutRef.current = window.setTimeout(() => {
        setGlitchingId(current => (current === nextGlitchId ? null : current))
        glitchTimeoutRef.current = null
      }, 350)
    }

    setVisible(tickerEntries)
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
      className="gs-panel crt-panel"
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
      {/* ── CRT OVERLAY LAYERS ───────────────────────────── */}

      {/* Layer 1: Scanlines — 1px alternating, denser and more authentic */}
      <div aria-hidden="true" style={{
        position: 'absolute',
        inset: 0,
        backgroundImage:
          'repeating-linear-gradient(0deg, transparent 0px, transparent 1px, hsl(225 45% 6%) 1px, hsl(225 45% 6%) 2px)',
        opacity: 0.12,
        pointerEvents: 'none',
        zIndex: 10,
      }} />

      {/* Layer 2: Radial vignette — CRT screen curvature darkening */}
      <div aria-hidden="true" style={{
        position: 'absolute',
        inset: 0,
        background:
          'radial-gradient(ellipse at 50% 50%, transparent 55%, hsl(225 45% 3%) 100%)',
        opacity: 0.7,
        pointerEvents: 'none',
        zIndex: 11,
      }} />

      {/* Layer 3: Noise grain — SVG feTurbulence, very subtle */}
      <svg aria-hidden="true" style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 12,
        opacity: 0.025,
      }}>
        <filter id={noiseFilterId}>
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${noiseFilterId})`} />
      </svg>

      {/* Layer 4: Subtle horizontal sync band — very faint rolling line */}
      <div aria-hidden="true" style={{
        position: 'absolute',
        inset: 0,
        background:
          'repeating-linear-gradient(90deg, transparent 0px, transparent 3px, hsl(225 45% 6%) 3px, hsl(225 45% 6%) 4px)',
        opacity: 0.04,
        pointerEvents: 'none',
        zIndex: 9,
      }} />

      {/* Layer 5: Rolling scanline sweep — CRT electron beam refresh */}
      <div aria-hidden="true" className="crt-sweep" />

      {/* ── HEADER ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{
            fontSize: '8px', fontFamily: 'var(--font-mono)',
            color: 'hsl(145 65% 60%)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            textShadow: '0 0 8px hsl(145 65% 55% / 0.5)',
          }}>
            Request Stream
          </span>
          {hasErrors && (
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: 'hsl(0 72% 55%)',
              boxShadow: '0 0 5px hsl(0 72% 55%), 0 0 10px hsl(0 72% 55% / 0.4)',
              animation: 'pulse-dot 1.5s ease-in-out infinite',
            }} />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {(['ok', 'fallback', 'error'] as StatusDot[]).map(dot => (
            <div key={dot} style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
              <StatusDotEl dot={dot} enhanced />
              <span style={{
                fontSize: '4px', fontFamily: 'var(--font-mono)',
                color: 'hsl(225 45% 20%)',
                textTransform: 'uppercase',
              }}>
                {dot === 'ok' ? 'OK' : dot === 'fallback' ? 'FB' : 'ERR'}
              </span>
            </div>
          ))}
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: 'hsl(225 45% 20%)',
            marginLeft: '0.15rem',
          }}>
            {visible.length} live
          </span>
        </div>
      </div>

      {/* ── COLUMN LABELS ───────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.2rem',
        paddingBottom: '0.05rem',
        borderBottom: '1px solid hsl(225 45% 12%)',
        position: 'relative',
        zIndex: 20,
      }}>
        {['TIME', 'INTENT', 'MODEL', '', 'LAT', ''].map((label, i) => (
          <div key={i} style={{
            fontSize: '4px', fontFamily: 'var(--font-mono)',
            color: 'hsl(145 65% 40%)',
            letterSpacing: '0.06em',
            flex: i === 2 ? 1 : 'none',
            width: i === 0 ? 42 : i === 1 ? 34 : i === 3 ? 14 : i === 4 ? 28 : 5,
            textAlign: i === 4 ? 'right' : 'left',
            textShadow: '0 0 4px hsl(145 65% 55% / 0.2)',
          }}>
            {label}
          </div>
        ))}
      </div>

      {/* ── SCROLLABLE FEED ────────────────────────────────── */}
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
          zIndex: 20,
          scrollbarWidth: 'thin',
          scrollbarColor: 'hsl(225 45% 15%) transparent',
        }}
      >
        {visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '0.3rem 0' }}>
            <span style={{
              fontSize: '7px', fontFamily: 'var(--font-mono)',
              color: 'hsl(145 65% 35%)',
              textShadow: '0 0 6px hsl(145 65% 55% / 0.3)',
              letterSpacing: '0.08em',
            }}>
              AWAITING STREAM...
            </span>
          </div>
        ) : (
          visible.map((entry, idx) => {
            const isGlitch = glitchingId === entry.id
            const isNewAndFirst = entry.isNew && idx === 0
            return (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.2rem',
                  padding: '0.04rem 0.1rem',
                  borderRadius: 2,
                  background: isNewAndFirst
                    ? 'hsl(185 80% 50% / 0.06)'
                    : 'transparent',
                  animation: isNewAndFirst
                    ? 'fade-in-down 250ms ease both'
                    : 'none',
                  transition: 'background 300ms ease',
                  // Chromatic aberration on the whole row for glitching entry
                  ...(isGlitch ? {
                    textShadow: `${PHOSPHOR_GLOW_CHROMATIC.r}, ${PHOSPHOR_GLOW_CHROMATIC.b}`,
                  } : {}),
                }}
              >
                {/* Time */}
                <div style={{
                  width: 42, flexShrink: 0,
                  fontSize: '5px', fontFamily: 'var(--font-mono)',
                  color: 'hsl(225 45% 40%)',
                  letterSpacing: '0.02em',
                  textShadow: isGlitch ? `0 0 5px hsl(145 65% 55% / 0.4)` : 'none',
                }}>
                  {entry.tsFormatted}
                </div>

                {/* Intent */}
                <div style={{ width: 34, flexShrink: 0 }}>
                  <IntentBadge intent={entry.intent} glowing={isNewAndFirst} />
                </div>

                {/* Model */}
                <div style={{
                  flex: 1,
                  fontSize: '5px', fontFamily: 'var(--font-mono)',
                  color: 'hsl(225 45% 50%)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontWeight: 500,
                  textShadow: isGlitch
                    ? `${PHOSPHOR_GLOW_CHROMATIC.r}, ${PHOSPHOR_GLOW_CHROMATIC.b}, 0 0 4px hsl(145 65% 55% / 0.3)`
                    : PHOSPHOR_GLOW,
                }}>
                  {entry.model}
                </div>

                {/* Latency */}
                <div style={{
                  width: 28, flexShrink: 0, textAlign: 'right',
                  fontSize: '5px', fontFamily: 'var(--font-mono)',
                  color: entry.dot === 'error' ? STATUS_COLORS.error
                    : entry.dot === 'fallback' ? STATUS_COLORS.fallback
                    : 'hsl(225 45% 45%)',
                  fontWeight: 600,
                  textShadow: isGlitch
                    ? `${PHOSPHOR_GLOW_CHROMATIC.r}, ${PHOSPHOR_GLOW_CHROMATIC.b}`
                    : 'none',
                }}>
                  {entry.latency != null ? `${entry.latency}ms` : '—'}
                </div>

                {/* Status dot */}
                <div style={{ width: 5, flexShrink: 0 }}>
                  <StatusDotEl dot={entry.dot} enhanced={isNewAndFirst} />
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* ── FOOTER ─────────────────────────────────────────── */}
      {visible.length > 0 && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: '0.05rem',
          borderTop: '1px solid hsl(225 45% 10%)',
          position: 'relative',
          zIndex: 20,
        }}>
          <span style={{
            fontSize: '4.5px', fontFamily: 'var(--font-mono)',
            color: 'hsl(225 45% 18%)',
          }}>
            newest first · auto-scroll
          </span>
          <span style={{
            fontSize: '4.5px', fontFamily: 'var(--font-mono)',
            color: 'hsl(225 45% 18%)',
          }}>
            last {visible.length} of {entries.length} loaded
          </span>
        </div>
      )}
    </div>
  )
}
