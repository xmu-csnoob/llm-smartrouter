import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

interface BurstEvent {
  request_id: string
  model: string
  tier: string
  status: number
  error: string | null
  timestamp: string
}

const ERROR_TYPES: Record<number, string> = {
  400: 'BAD_REQ',
  401: 'AUTH_ERR',
  403: 'FORBIDDEN',
  408: 'TIMEOUT',
  429: 'RATE_LIMIT',
  500: 'SERVER_ERR',
  502: 'BAD_GATEWAY',
  503: 'UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
}

function getErrorType(status: number): string {
  return ERROR_TYPES[status] ?? `HTTP_${status}`
}

export function ErrorBurstDetector({ entries }: Props) {
  const { errors, bursts, errorRate, isBursting } = useMemo(() => {
    const errors: BurstEvent[] = []
    for (const entry of entries) {
      if (entry.status >= 400 || entry.error) {
        errors.push({
          request_id: entry.request_id,
          model: entry.routed_model,
          tier: entry.routed_tier,
          status: entry.status,
          error: entry.error,
          timestamp: entry.timestamp,
        })
      }
    }

    const totalErrors = errors.length
    const totalRequests = entries.length
    const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0

    // Detect bursts: 3+ consecutive errors within 5 entries
    const bursts: BurstEvent[][] = []
    let windowStart = 0
    let windowErrors = 0

    for (let i = 0; i < entries.length; i++) {
      const isErr = entries[i].status >= 400 || !!entries[i].error
      if (isErr) windowErrors++
      else {
        if (windowErrors >= 3) {
          bursts.push(errors.slice(windowStart, i))
        }
        windowStart = i + 1
        windowErrors = 0
      }
    }
    if (windowErrors >= 3) {
      bursts.push(errors.slice(windowStart, entries.length))
    }

    const isBursting = bursts.length > 0 || errorRate > 10

    return { errors, bursts, errorRate, isBursting }
  }, [entries])

  const recentErrors = errors.slice(0, 8)

  if (errors.length === 0) {
    return (
      <div style={{ padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'hsl(145 65% 48%)',
            boxShadow: '0 0 6px hsl(145 65% 48%)',
          }} />
          <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'hsl(145 65% 55%)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            All Clear
          </span>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
            No errors in {entries.length} requests
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.25rem 0.5rem', background: 'hsl(145 65% 48% / 0.08)', borderRadius: 6, border: '1px solid hsl(145 65% 48% / 0.2)' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(145 65% 55%)' }}>0%</span>
          <div style={{ flex: 1, height: 4, background: 'var(--muted)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: '0%', height: '100%', background: 'hsl(145 65% 48%)', borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>0/{entries.length}</span>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '0.375rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      {/* Header status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {isBursting ? (
            <>
              <div style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'hsl(0 72% 55%)',
                boxShadow: '0 0 6px hsl(0 72% 55%)',
                animation: 'pulse-dot 1.5s ease-in-out infinite',
              }} />
              <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'hsl(0 72% 60%)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {bursts.length > 0 ? 'Burst' : 'High Error Rate'}
              </span>
            </>
          ) : (
            <>
              <div style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'hsl(45 85% 50%)',
                boxShadow: '0 0 6px hsl(45 85% 50%)',
              }} />
              <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'hsl(45 85% 55%)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Errors Detected
              </span>
            </>
          )}
        </div>
        <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          {errors.length}/{entries.length} ({errorRate.toFixed(1)}%)
        </span>
      </div>

      {/* Error rate bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.2rem 0.4rem', background: 'hsl(0 72% 55% / 0.08)', borderRadius: 5, border: `1px solid ${isBursting ? 'hsl(0 72% 55% / 0.25)' : 'hsl(45 85% 50% / 0.2)'}` }}>
        <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: isBursting ? 'hsl(0 72% 60%)' : 'hsl(45 85% 60%)', minWidth: 28 }}>
          {errorRate.toFixed(1)}%
        </span>
        <div style={{ flex: 1, height: 4, background: 'var(--muted)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            width: `${Math.min(100, errorRate)}%`,
            height: '100%',
            background: isBursting ? 'hsl(0 72% 55%)' : 'hsl(45 85% 50%)',
            borderRadius: 2,
            transition: 'width 400ms ease',
          }} />
        </div>
      </div>

      {/* Burst indicators */}
      {bursts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {bursts.map((burst, i) => (
            <div key={i} style={{
              background: 'hsl(0 72% 55% / 0.1)',
              border: '1px solid hsl(0 72% 55% / 0.3)',
              borderRadius: 4,
              padding: '0.2rem 0.35rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
            }}>
              <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'hsl(0 72% 65%)', fontWeight: 700 }}>
                BURST {i + 1}
              </span>
              <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
                {burst.length} errors · {burst[0]?.model}
              </span>
              <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'hsl(0 72% 65%)', marginLeft: 'auto' }}>
                {burst[0] && new Date(burst[0].timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Recent error list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        {recentErrors.map((err) => (
          <div key={err.request_id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{
              fontSize: '7px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              color: 'hsl(0 72% 60%)',
              background: 'hsl(0 72% 55% / 0.15)',
              border: '1px solid hsl(0 72% 55% / 0.3)',
              borderRadius: 3,
              padding: '0.05rem 0.25rem',
              flexShrink: 0,
            }}>
              {getErrorType(err.status)}
            </span>
            <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {err.model}
            </span>
            {err.error && (
              <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'hsl(0 72% 65%)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {err.error}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
