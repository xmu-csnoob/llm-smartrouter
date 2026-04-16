import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const ML_KEYS = new Set(['scoring', 'legacy-rule+scoring'])
const RULE_KEYS = new Set(['keyword', 'expr', 'default'])

const BUCKET_COUNT = 6
const BUCKET_MINUTES = 5

function getBucketIndex(timestamp: string): number {
  const now = Date.now()
  const then = new Date(timestamp).getTime()
  const diffMs = now - then
  const diffMins = diffMs / 60000
  // Buckets: 0 = most recent (0-5min), 5 = oldest (25-30min)
  const idx = Math.floor(diffMins / BUCKET_MINUTES)
  return Math.min(idx, BUCKET_COUNT - 1)
}

interface Bucket {
  label: string
  ml: number
  rule: number
  total: number
  mlPct: number
}

function formatLabel(idx: number): string {
  const minsAgo = (BUCKET_COUNT - 1 - idx) * BUCKET_MINUTES
  if (minsAgo === 0) return 'now'
  if (minsAgo === BUCKET_MINUTES) return `${minsAgo}m`
  return `${minsAgo}m`
}

export function RoutingConfidenceTimeline({ entries }: Props) {
  const { buckets, mlTrend, overallMlPct } = useMemo(() => {
    const counts: Bucket[] = Array.from({ length: BUCKET_COUNT }, (_, i) => ({
      label: formatLabel(i),
      ml: 0,
      rule: 0,
      total: 0,
      mlPct: 0,
    }))

    const cutoff = Date.now() - BUCKET_COUNT * BUCKET_MINUTES * 60000
    let mlTotal = 0
    let ruleTotal = 0

    for (const entry of entries) {
      const ts = new Date(entry.timestamp).getTime()
      if (ts < cutoff) continue

      const idx = getBucketIndex(entry.timestamp)
      const bucket = counts[idx]
      if (!bucket) continue

      if (ML_KEYS.has(entry.matched_by)) {
        bucket.ml++
        mlTotal++
      } else if (RULE_KEYS.has(entry.matched_by)) {
        bucket.rule++
        ruleTotal++
      } else {
        // passthrough, cross-tier, etc — neutral
      }
      bucket.total++
    }

    // Compute percentages
    for (const bucket of counts) {
      bucket.mlPct = bucket.total > 0 ? (bucket.ml / bucket.total) * 100 : 0
    }

    const mlTrend = counts.map(b => b.ml)
    const overallMlPct = mlTotal + ruleTotal > 0 ? (mlTotal / (mlTotal + ruleTotal)) * 100 : 0

    return { buckets: counts.reverse(), mlTrend, overallMlPct }
  }, [entries])

  const hasData = buckets.some(b => b.total > 0)
  const maxVal = Math.max(...buckets.map(b => b.total), 1)

  const isRising = mlTrend.length >= 2 && mlTrend[mlTrend.length - 1] > mlTrend[0]
  const trendLabel = isRising ? '↑' : mlTrend.length >= 2 && mlTrend[mlTrend.length - 1] < mlTrend[0] ? '↓' : '→'

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.35rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '920ms',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: '9px', fontFamily: 'var(--font-mono)',
          color: 'var(--muted-foreground)', textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Routing Confidence
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          {hasData ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'hsl(185 80% 50%)', boxShadow: '0 0 4px hsl(185 80% 50%)' }} />
                <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>ML</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'hsl(38 92% 55%)', boxShadow: '0 0 4px hsl(38 92% 55%)' }} />
                <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>Rule</span>
              </div>
              <span style={{
                fontSize: '6px', fontFamily: 'var(--font-mono)',
                color: overallMlPct > 60 ? 'hsl(185 80% 50%)' : overallMlPct > 40 ? 'hsl(38 92% 55%)' : 'hsl(0 72% 55%)',
                fontWeight: 700,
              }}>
                {overallMlPct.toFixed(0)}% ML {trendLabel}
              </span>
            </>
          ) : null}
        </div>
      </div>

      {/* Chart area */}
      {!hasData ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            NO ROUTING DATA
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.2rem', height: 36 }}>
          {buckets.map((bucket, i) => {
            const mlH = maxVal > 0 ? (bucket.ml / maxVal) * 36 : 0
            const ruleH = maxVal > 0 ? (bucket.rule / maxVal) * 36 : 0
            const isRecent = i === buckets.length - 1

            return (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.05rem', height: 36, justifyContent: 'flex-end' }}>
                {/* Stacked bar */}
                <div style={{
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0,
                  height: 36,
                  justifyContent: 'flex-end',
                }}>
                  {/* ML segment */}
                  <div style={{
                    width: '100%',
                    height: mlH,
                    background: isRecent
                      ? 'linear-gradient(180deg, hsl(185 80% 50% / 0.8), hsl(185 80% 50% / 0.4))'
                      : 'hsl(185 80% 50% / 0.35)',
                    borderRadius: '2px 2px 0 0',
                    boxShadow: isRecent ? '0 0 4px hsl(185 80% 50% / 0.3)' : 'none',
                    transition: 'height 500ms cubic-bezier(0.34, 1.2, 0.64, 1)',
                    position: 'relative',
                  }}>
                    {bucket.ml > 0 && (
                      <div style={{
                        position: 'absolute',
                        top: 1, left: '50%',
                        transform: 'translateX(-50%)',
                        fontSize: '3.5px',
                        fontFamily: 'var(--font-mono)',
                        color: 'hsl(185 80% 80%)',
                        fontWeight: 700,
                        opacity: mlH > 8 ? 1 : 0,
                        transition: 'opacity 200ms',
                      }}>
                        {bucket.ml}
                      </div>
                    )}
                  </div>
                  {/* Rule segment */}
                  <div style={{
                    width: '100%',
                    height: ruleH,
                    background: isRecent
                      ? 'linear-gradient(180deg, hsl(38 92% 55% / 0.8), hsl(38 92% 55% / 0.4))'
                      : 'hsl(38 92% 55% / 0.25)',
                    borderRadius: '0 0 2px 2px',
                    boxShadow: isRecent ? '0 0 4px hsl(38 92% 55% / 0.3)' : 'none',
                    transition: 'height 500ms cubic-bezier(0.34, 1.2, 0.64, 1)',
                    position: 'relative',
                  }}>
                    {bucket.rule > 0 && (
                      <div style={{
                        position: 'absolute',
                        bottom: 1, left: '50%',
                        transform: 'translateX(-50%)',
                        fontSize: '3.5px',
                        fontFamily: 'var(--font-mono)',
                        color: 'hsl(38 92% 80%)',
                        fontWeight: 700,
                        opacity: ruleH > 8 ? 1 : 0,
                        transition: 'opacity 200ms',
                      }}>
                        {bucket.rule}
                      </div>
                    )}
                  </div>
                </div>

                {/* Label */}
                <span style={{
                  fontSize: '4px', fontFamily: 'var(--font-mono)',
                  color: isRecent ? 'hsl(185 80% 50%)' : 'hsl(225 45% 20%)',
                  fontWeight: isRecent ? 700 : 400,
                  marginTop: 1,
                }}>
                  {bucket.label}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Footer */}
      {hasData && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: '0.05rem',
          borderTop: '1px solid hsl(225 45% 12%)',
        }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            ML = scoring + legacy-rule+scoring
          </span>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            {BUCKET_COUNT}×{BUCKET_MINUTES}min buckets · 30min window
          </span>
        </div>
      )}
    </div>
  )
}
