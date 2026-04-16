import { useMemo } from 'react'

interface Props {
  entries: { latency_ms: number | null }[]
  value: number | null
  maxReadings?: number
}

/**
 * Tiny inline sparkline bar chart showing recent latency trend for a model.
 * Rendered inline within a table cell.
 */
export function LatencySparkline({ entries, value, maxReadings = 8 }: Props) {
  const readings = useMemo(() => {
    // Collect up to maxReadings non-null latency values from entries
    const result: number[] = []
    for (const entry of entries) {
      if (entry.latency_ms != null) {
        result.push(entry.latency_ms)
        if (result.length >= maxReadings) break
      }
    }
    return result
  }, [entries, maxReadings])

  if (readings.length < 2) {
    return (
      <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
        {value != null ? `${value}` : '—'}
        <span style={{ fontSize: '8px', color: 'var(--muted-foreground)' }}>ms</span>
      </span>
    )
  }

  const max = Math.max(...readings)
  const min = Math.min(...readings)
  const range = max - min || 1
  const barW = 3
  const gap = 1
  const hScale = 16 / range // max bar height 16px

  const isHigh = (v: number) => v > 5000
  const isRising = readings.length >= 2 && readings[readings.length - 1] > readings[0]

  const lastColor = isHigh(readings[readings.length - 1])
    ? 'hsl(0 72% 55%)'
    : isRising
    ? 'hsl(45 85% 50%)'
    : 'hsl(145 65% 48%)'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
      {/* Sparkline */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: `${gap}px`, height: 16 }}>
        {readings.map((v, i) => {
          const h = Math.max(1, (v - min) * hScale + 1)
          const isLast = i === readings.length - 1
          return (
            <div
              key={i}
              style={{
                width: barW,
                height: h,
                borderRadius: 1,
                background: isLast ? lastColor : 'var(--muted-foreground)',
                opacity: isLast ? 1 : 0.25 + (i / readings.length) * 0.4,
                transition: 'height 200ms ease',
              }}
            />
          )
        })}
      </div>
      {/* Current value */}
      <span style={{
        fontSize: '9px',
        fontFamily: 'var(--font-mono)',
        color: isHigh(value ?? 0) ? 'hsl(0 72% 55%)' : 'var(--foreground)',
        minWidth: 28,
      }}>
        {value != null ? `${value}` : '—'}
      </span>
    </div>
  )
}
