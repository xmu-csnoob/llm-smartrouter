import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const TIER_COLORS: Record<string, string> = {
  tier1: 'hsl(280 65% 65%)',
  tier2: 'hsl(200 75% 55%)',
  tier3: 'hsl(145 65% 50%)',
}

const INTENT_COLORS: Record<string, string> = {
  simple: 'hsl(145 65% 55%)',
  debug: 'hsl(38 92% 55%)',
  implementation: 'hsl(200 75% 55%)',
  architecture: 'hsl(280 65% 65%)',
  analysis: 'hsl(260 65% 55%)',
  general: 'hsl(0 0% 55%)',
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function formatTs(ts: string) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '--:--:--'
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function getStatusDot(entry: LogEntry): 'ok' | 'fallback' | 'error' {
  if (entry.status >= 400 || entry.error) return 'error'
  if (entry.is_fallback || (entry.fallback_chain && entry.fallback_chain.length > 0)) return 'fallback'
  return 'ok'
}

const STATUS_COLORS: Record<string, string> = {
  ok: 'hsl(145 65% 55%)',
  fallback: 'hsl(38 92% 55%)',
  error: 'hsl(0 72% 55%)',
}

function truncateModel(model: string, max = 22) {
  if (!model) return '—'
  if (model.length <= max) return model
  return model.slice(0, max - 1) + '…'
}

const DISPLAY_COUNT = 5

export function RecentActivityStrip({ entries }: Props) {
  const recent = useMemo(() => entries.slice(0, DISPLAY_COUNT), [entries])

  if (entries.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0.5rem 1rem',
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        color: 'var(--muted-foreground)',
        letterSpacing: '0.06em',
      }}>
        NO RECENT ACTIVITY
      </div>
    )
  }

  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.3rem 0.75rem',
        borderBottom: '1px solid hsl(225 20% 12%)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <div style={{
            width: 5, height: 5,
            borderRadius: '50%',
            background: 'hsl(145 65% 55%)',
            boxShadow: '0 0 5px hsl(145 65% 55%)',
            animation: 'pulse-dot 2s ease-in-out infinite',
          }} />
          <span style={{
            fontSize: '9px',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            color: 'hsl(145 65% 60%)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>
            Recent Activity
          </span>
        </div>
        <span style={{
          fontSize: '8px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)',
        }}>
          last {recent.length} of {entries.length}
        </span>
      </div>

      {/* Column labels */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0.2rem 0.75rem',
        borderBottom: '1px solid hsl(225 20% 10%)',
        gap: '0.5rem',
      }}>
        {['TIME', 'INTENT', 'MODEL', 'TIER', '', 'LAT'].map((l, i) => (
          <div key={l} style={{
            fontSize: '6px',
            fontFamily: 'var(--font-mono)',
            color: 'hsl(215 15% 40%)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            width: i === 0 ? 42 : i === 1 ? 44 : i === 2 ? 1 : i === 3 ? 34 : i === 4 ? 10 : 28,
            flex: i === 2 ? 1 : 'none',
            textAlign: i === 5 ? 'right' : 'left',
          }}>
            {l}
          </div>
        ))}
      </div>

      {/* Rows */}
      {recent.map((entry, idx) => {
        const dot = getStatusDot(entry)
        const intent = entry.semantic_features?.intent ?? entry.task_type ?? 'general'
        const intentColor = INTENT_COLORS[intent] ?? 'hsl(0 0% 55%)'
        const tier = entry.routed_tier ?? '—'
        const tierColor = TIER_COLORS[tier] ?? 'hsl(0 0% 50%)'

        return (
          <div
            key={entry.request_id ?? idx}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '0.22rem 0.75rem',
              gap: '0.5rem',
              borderBottom: idx < recent.length - 1 ? '1px solid hsl(225 20% 8%)' : 'none',
              animation: 'fade-in-up 200ms ease both',
              animationDelay: `${idx * 50}ms`,
            }}
          >
            {/* Time */}
            <div style={{
              width: 42, flexShrink: 0,
              fontSize: '7px',
              fontFamily: 'var(--font-mono)',
              color: 'hsl(215 15% 40%)',
              letterSpacing: '0.02em',
            }}>
              {formatTs(entry.timestamp)}
            </div>

            {/* Intent */}
            <div style={{
              width: 44, flexShrink: 0,
              fontSize: '6px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              color: intentColor,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>
              {intent.slice(0, 6)}
            </div>

            {/* Model */}
            <div style={{
              flex: 1,
              fontSize: '7px',
              fontFamily: 'var(--font-mono)',
              color: 'hsl(210 15% 70%)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {truncateModel(entry.routed_model ?? entry.requested_model)}
            </div>

            {/* Tier badge */}
            <div style={{
              width: 34, flexShrink: 0,
              fontSize: '6px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              color: tierColor,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>
              {tier}
            </div>

            {/* Status dot */}
            <div style={{
              width: 10, flexShrink: 0,
              display: 'flex',
              justifyContent: 'center',
            }}>
              <div style={{
                width: 5, height: 5,
                borderRadius: '50%',
                background: STATUS_COLORS[dot],
                boxShadow: `0 0 4px ${STATUS_COLORS[dot]}80`,
              }} />
            </div>

            {/* Latency */}
            <div style={{
              width: 28, flexShrink: 0,
              textAlign: 'right',
              fontSize: '7px',
              fontFamily: 'var(--font-mono)',
              color: dot === 'error' ? STATUS_COLORS.error
                : dot === 'fallback' ? STATUS_COLORS.fallback
                : 'hsl(215 15% 55%)',
              fontWeight: 600,
            }}>
              {entry.latency_ms != null ? `${entry.latency_ms}ms` : '—'}
            </div>
          </div>
        )
      })}
    </div>
  )
}
