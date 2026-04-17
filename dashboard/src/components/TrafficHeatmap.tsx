import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TIER_COLORS: Record<string, string> = {
  all: 'hsl(185 80% 50%)',
  tier1: 'hsl(280 65% 60%)',
  tier2: 'hsl(200 75% 55%)',
  tier3: 'hsl(145 65% 48%)',
}

function getDay(timestamp: string): number {
  return new Date(timestamp).getUTCDay()
}

function getHour(timestamp: string): number {
  return new Date(timestamp).getUTCHours()
}

function intensityColor(count: number, max: number, color: string): string {
  if (count === 0 || max === 0) return 'var(--muted)'
  const alpha = 0.1 + (count / max) * 0.85
  return color.replace(')', ` / ${alpha})`).replace('hsl', 'hsla')
}

export function TrafficHeatmap({ entries }: Props) {
  const { cells, maxCell, totalRequests, tierModes } = useMemo(() => {
    const cells: Record<number, Record<number, { total: number; tierCounts: Record<string, number> }>> = {}

    // Initialize 7 days × 24 hours
    for (let d = 0; d < 7; d++) {
      cells[d] = {}
      for (let h = 0; h < 24; h++) {
        cells[d][h] = { total: 0, tierCounts: {} }
      }
    }

    let total = 0
    let max = 0

    for (const entry of entries) {
      const day = getDay(entry.timestamp)
      const hour = getHour(entry.timestamp)
      const tier = entry.routed_tier || 'tier2'

      cells[day][hour].total++
      cells[day][hour].tierCounts[tier] = (cells[day][hour].tierCounts[tier] || 0) + 1
      total++

      if (cells[day][hour].total > max) max = cells[day][hour].total
    }

    // Dominant tier per cell
    const dominantTier: Record<number, Record<number, string>> = {}
    for (let d = 0; d < 7; d++) {
      dominantTier[d] = {}
      for (let h = 0; h < 24; h++) {
        const tc = cells[d][h].tierCounts
        dominantTier[d][h] = Object.entries(tc).sort((a, b) => b[1] - a[1])[0]?.[0] || 'all'
      }
    }

    return { cells, maxCell: max, totalRequests: total, tierModes: dominantTier }
  }, [entries])

  const currentHour = new Date().getUTCHours()
  const currentDay = new Date().getUTCDay()

  // Find overall peak day and hour
  const overallPeak = useMemo(() => {
    let peakDay = 0
    let peakHour = 0
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        if (cells[d][h].total > cells[peakDay][peakHour].total) {
          peakDay = d
          peakHour = h
        }
      }
    }
    return { day: peakDay, hour: peakHour }
  }, [cells])

  if (totalRequests === 0) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center' }}>
        <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          NO TRAFFIC DATA
        </span>
      </div>
    )
  }

  return (
    <div style={{ padding: '0.375rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Traffic Heatmap · 7d
        </span>
        <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          {totalRequests.toLocaleString()} req
        </span>
      </div>

      {/* Heatmap grid */}
      <div style={{ display: 'flex', gap: 2 }}>
        {/* Day labels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: '16px' }}>
          {DAYS.map((day, d) => (
            <div key={d} style={{
              height: 12,
              display: 'flex',
              alignItems: 'center',
              fontSize: '6px',
              fontFamily: 'var(--font-mono)',
              color: d === currentDay ? 'var(--primary)' : 'var(--muted-foreground)',
              fontWeight: d === currentDay ? 700 : 400,
              width: 14,
            }}>
              {day}
            </div>
          ))}
        </div>

        {/* Grid cells */}
        <div style={{ flex: 1 }}>
          {/* Hour labels row */}
          <div style={{ display: 'flex', gap: 1, marginBottom: 2 }}>
            {HOURS.map((h) => (
              <div key={h} style={{
                flex: 1,
                textAlign: 'center',
                fontSize: '5px',
                fontFamily: 'var(--font-mono)',
                color: h === currentHour ? 'var(--primary)' : 'var(--muted-foreground)',
                fontWeight: h === currentHour ? 700 : 400,
                opacity: h % 3 === 0 ? 1 : 0,
              }}>
                {h}
              </div>
            ))}
          </div>

          {/* Cells */}
          {Object.entries(cells).map(([dayStr, dayCells]) => {
            const d = Number(dayStr)
            return (
              <div key={d} style={{ display: 'flex', gap: 1, marginBottom: 2 }}>
                {Object.entries(dayCells).map(([hourStr, cell]) => {
                  const h = Number(hourStr)
                  const count = cell.total
                  const dominantTier = tierModes[d][h]
                  const color = TIER_COLORS[dominantTier] || TIER_COLORS.all
                  const bg = intensityColor(count, maxCell, color)
                  const isNow = d === currentDay && h === currentHour

                  return (
                    <div
                      key={h}
                      title={`${DAYS[d]} ${h}:00 — ${count} req (${dominantTier})`}
                      style={{
                        flex: 1,
                        height: 12,
                        background: bg,
                        borderRadius: 2,
                        border: isNow ? `1px solid ${color}` : '1px solid transparent',
                        transition: 'background 200ms ease',
                        cursor: 'default',
                        minWidth: 3,
                      }}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.125rem' }}>
        <div style={{ display: 'flex', gap: '0.625rem' }}>
          {(['tier1', 'tier2', 'tier3'] as const).map((tier) => (
            <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: TIER_COLORS[tier], opacity: 0.7 }} />
              <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
                {tier.replace('tier', 'T')}
              </span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>low</span>
          <div style={{ width: 40, height: 6, borderRadius: 2, background: `linear-gradient(90deg, var(--muted), ${TIER_COLORS.all})` }} />
          <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>high</span>
        </div>
      </div>

      {/* Current time indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginTop: '0.1rem' }}>
        <div style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: 'var(--primary)',
          boxShadow: '0 0 6px var(--primary)',
          animation: 'pulse-dot 2.5s ease-in-out infinite',
        }} />
        <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          Now: {DAYS[currentDay]} {currentHour}:00
        </span>
        <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', marginLeft: 'auto' }}>
          Peak: {DAYS[overallPeak.day]} {overallPeak.hour}:00
        </span>
      </div>
    </div>
  )
}
