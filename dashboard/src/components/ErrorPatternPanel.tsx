import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

type ErrorCategory = 'timeout' | 'rate_limit' | 'context_length' | 'model_error' | 'network' | 'auth' | 'unknown'

function categorizeError(error: string | null): ErrorCategory {
  if (!error) return 'unknown'
  const e = error.toLowerCase()
  if (e.includes('timeout')) return 'timeout'
  if (e.includes('rate limit') || e.includes('429') || e.includes('rate_limit')) return 'rate_limit'
  if (e.includes('context') || e.includes('length') || e.includes('tokens') || e.includes('too long')) return 'context_length'
  if (e.includes('network') || e.includes('connection') || e.includes('dns') || e.includes('refused') || e.includes('econn')) return 'network'
  if (e.includes('auth') || e.includes('401') || e.includes('403') || e.includes('unauthorized') || e.includes('api key') || e.includes('invalid key')) return 'auth'
  if (e.includes('model') || e.includes('api error') || e.includes('anthropic') || e.includes('openai') || e.includes('internal')) return 'model_error'
  return 'unknown'
}

const CATEGORY_COLORS: Record<ErrorCategory, string> = {
  timeout: 'hsl(280, 65%, 65%)',
  rate_limit: 'hsl(38, 92%, 55%)',
  context_length: 'hsl(25, 90%, 55%)',
  model_error: 'hsl(0, 72%, 55%)',
  network: 'hsl(185, 80%, 50%)',
  auth: 'hsl(15, 85%, 55%)',
  unknown: 'hsl(225, 45%, 45%)',
}

const CATEGORY_ORDER: ErrorCategory[] = ['timeout', 'rate_limit', 'context_length', 'model_error', 'network', 'auth', 'unknown']

export function ErrorPatternPanel({ entries }: Props) {
  const { totalErrors, perCategory, topError, maxCount } = useMemo(() => {
    const errorEntries = entries.filter((e) => e.error != null)
    const total = errorEntries.length

    const counts: Record<ErrorCategory, number> = {
      timeout: 0,
      rate_limit: 0,
      context_length: 0,
      model_error: 0,
      network: 0,
      auth: 0,
      unknown: 0,
    }

    const errorStrings: Record<string, number> = {}

    for (const e of errorEntries) {
      const cat = categorizeError(e.error)
      counts[cat]++
      if (e.error) {
        errorStrings[e.error] = (errorStrings[e.error] || 0) + 1
      }
    }

    let topError = ''
    let topCount = 0
    for (const [msg, cnt] of Object.entries(errorStrings)) {
      if (cnt > topCount) {
        topCount = cnt
        topError = msg
      }
    }

    const maxCount = Math.max(...Object.values(counts), 1)

    return { totalErrors: total, perCategory: counts, topError, maxCount }
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
          Error Patterns
        </span>
        <span
          style={{
            fontSize: '5.5px',
            fontFamily: 'var(--font-mono)',
            color: totalErrors > 0 ? 'hsl(0 72% 55%)' : 'hsl(225 45% 20%)',
            fontWeight: 600,
          }}
        >
          {totalErrors} error{totalErrors !== 1 ? 's' : ''}
        </span>
      </div>

      {totalErrors === 0 ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span
            style={{
              fontSize: '8px',
              fontFamily: 'var(--font-mono)',
              color: 'hsl(145 65% 50%)',
              letterSpacing: '0.06em',
            }}
          >
            NO ERRORS — NOMINAL
          </span>
        </div>
      ) : (
        <>
          {/* Column headers */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0 0.4rem 0.1rem',
              borderBottom: '1px solid hsl(225 45% 12%)',
            }}
          >
            {[
              ['CATEGORY', 52],
              ['', 1],
              ['N', 22],
              ['%', 28],
            ].map(([label, width], i) => (
              <div
                key={i}
                style={{
                  fontSize: '4.5px',
                  fontFamily: 'var(--font-mono)',
                  color: 'hsl(225 45% 20%)',
                  letterSpacing: '0.06em',
                  width,
                  flexShrink: 0,
                  textAlign: i === 2 || i === 3 ? 'right' : 'left',
                }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Category bars */}
          <div>
            {CATEGORY_ORDER.map((cat) => {
              const count = perCategory[cat]
              const pct = totalErrors > 0 ? (count / totalErrors) * 100 : 0
              const width = (count / maxCount) * 100
              const color = CATEGORY_COLORS[cat]
              const isZero = count === 0

              return (
                <div
                  key={cat}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.1rem',
                    padding: '0.1rem 0.4rem',
                    borderBottom: '1px solid hsl(225 45% 10%)',
                    opacity: isZero ? 0.3 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <div
                      style={{
                        fontSize: '7px',
                        fontFamily: 'var(--font-mono)',
                        color,
                        width: 52,
                        flexShrink: 0,
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {cat.replace('_', ' ')}
                    </div>

                    <div
                      style={{
                        flex: 1,
                        height: 5,
                        background: 'hsl(225 45% 10%)',
                        borderRadius: 2,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${width}%`,
                          height: '100%',
                          background: `linear-gradient(90deg, ${color}40, ${color}80)`,
                          borderRadius: 2,
                          boxShadow: isZero ? 'none' : `0 0 4px ${color}30`,
                          transition: 'width 600ms cubic-bezier(0.34, 1.2, 0.64, 1)',
                        }}
                      />
                    </div>

                    <div
                      style={{
                        fontSize: '6px',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--muted-foreground)',
                        width: 22,
                        flexShrink: 0,
                        textAlign: 'right',
                        fontWeight: 600,
                      }}
                    >
                      {count}
                    </div>

                    <div
                      style={{
                        fontSize: '5.5px',
                        fontFamily: 'var(--font-mono)',
                        color,
                        width: 28,
                        flexShrink: 0,
                        textAlign: 'right',
                        fontWeight: 700,
                      }}
                    >
                      {count > 0 ? `${pct.toFixed(1)}%` : '—'}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Top error callout */}
          {topError && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.1rem',
                padding: '0.2rem 0.4rem',
                background: 'hsl(225 45% 8%)',
                borderRadius: '4px',
                border: '1px solid hsl(225 45% 12%)',
              }}
            >
              <span
                style={{
                  fontSize: '4.5px',
                  fontFamily: 'var(--font-mono)',
                  color: 'hsl(225 45% 25%)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                Top Error
              </span>
              <span
                style={{
                  fontSize: '7px',
                  fontFamily: 'var(--font-mono)',
                  color: 'hsl(0 72% 55%)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={topError}
              >
                {topError.length > 40 ? topError.slice(0, 40) + '…' : topError}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
