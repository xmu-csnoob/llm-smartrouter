import { useState, useEffect } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const TIER_COLORS: Record<string, string> = {
  tier1: 'hsl(280 65% 60%)',
  tier2: 'hsl(200 75% 55%)',
  tier3: 'hsl(145 65% 48%)',
}

interface DiscrepancyEntry {
  id: string
  timestamp: string
  prompt: string
  selectedTier: string
  routedTier: string
  // When shadow_tier backend field is available, shadowTier will be populated
  shadowTier: string | null
  delta: number
  status: number
  latencyMs: number
}

function extractDiscrepancy(entry: LogEntry): DiscrepancyEntry | null {
  const routedTier = entry.routed_tier || 'tier2'
  const selectedTier = entry.selected_tier || routedTier

  // Detect selected vs routed discrepancy (tier selection was overridden)
  const hasTierDiscrepancy = selectedTier !== routedTier
  // Detect quality guard applied (guard forced a different tier)
  const guardApplied = entry.quality_guard_applied

  if (!hasTierDiscrepancy && !guardApplied) return null

  const delta = guardApplied ? -30 : 0 // guard penalty indicator

  return {
    id: `${entry.request_id || entry.timestamp}-${Math.random()}`,
    timestamp: entry.timestamp,
    prompt: entry.request_preview?.substring(0, 60) || '(no preview)',
    selectedTier,
    routedTier,
    shadowTier: null, // populated when backend surfaces shadow_tier field
    delta,
    status: 0,
    latencyMs: 0,
  }
}

function DiscrepancyRow({ item }: { item: DiscrepancyEntry }) {
  const isGuard = item.shadowTier === null && item.delta !== 0
  const borderColor = isGuard
    ? 'hsl(38 92% 65% / 0.5)'
    : item.selectedTier === item.routedTier
    ? 'hsl(145 65% 48% / 0.3)'
    : 'hsl(280 65% 60% / 0.4)'

  const badgeColor = (tier: string) => TIER_COLORS[tier] || 'hsl(0 0% 50%)'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.3rem',
      padding: '0.2rem 0',
      borderLeft: `2px solid ${borderColor}`,
      paddingLeft: '0.3rem',
      marginBottom: '0.15rem',
      animation: 'fade-in-up 300ms ease forwards',
    }}>
      {/* Timestamp */}
      <div style={{
        fontSize: '6px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--muted-foreground)',
        width: 36,
        flexShrink: 0,
      }}>
        {new Date(item.timestamp).toLocaleTimeString('en-US', { hour12: false })}
      </div>

      {/* Prompt preview */}
      <div style={{
        flex: 1,
        fontSize: '6px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--foreground)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        minWidth: 0,
      }}>
        {item.prompt}
      </div>

      {/* Selected badge */}
      <div style={{
        fontSize: '6px',
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        color: badgeColor(item.selectedTier),
        background: `${badgeColor(item.selectedTier)}20`,
        border: `1px solid ${badgeColor(item.selectedTier)}40`,
        borderRadius: 3,
        padding: '0.05rem 0.25rem',
        flexShrink: 0,
      }}>
        {item.selectedTier.replace('tier', 'T')}
      </div>

      {/* Arrow */}
      <div style={{
        fontSize: '6px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--muted-foreground)',
      }}>
        →
      </div>

      {/* Routed badge */}
      <div style={{
        fontSize: '6px',
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        color: badgeColor(item.routedTier),
        background: `${badgeColor(item.routedTier)}20`,
        border: `1px solid ${badgeColor(item.routedTier)}40`,
        borderRadius: 3,
        padding: '0.05rem 0.25rem',
        flexShrink: 0,
      }}>
        {item.routedTier.replace('tier', 'T')}
      </div>

      {/* Guard indicator */}
      {isGuard && (
        <div style={{
          fontSize: '5px',
          fontFamily: 'var(--font-mono)',
          color: 'hsl(38 92% 65%)',
          fontWeight: 700,
          letterSpacing: '0.05em',
          flexShrink: 0,
        }}>
          GUARD
        </div>
      )}
    </div>
  )
}

export function ShadowDiscrepancyFeed({ entries }: Props) {
  const [visible, setVisible] = useState<DiscrepancyEntry[]>([])
  const [total, setTotal] = useState(0)

  useEffect(() => {
    const all = entries
      .map(extractDiscrepancy)
      .filter((d): d is DiscrepancyEntry => d !== null)
      .slice(0, 12)

    setVisible(all)
    setTotal(entries.filter(e => extractDiscrepancy(e) !== null).length)
  }, [entries])

  const guardCount = visible.filter(v => v.shadowTier === null && v.delta !== 0).length
  const discrepancyCount = visible.filter(v => v.selectedTier !== v.routedTier).length

  if (entries.length === 0) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center' }}>
        <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
          NO SHADOW DATA
        </span>
      </div>
    )
  }

  return (
    <div style={{ padding: '0.375rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Shadow Discrepancy
          </span>
          {/* Live pulse dot */}
          <div style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: 'hsl(185 80% 50%)',
            boxShadow: '0 0 6px hsl(185 80% 50%)',
            animation: 'pulse-dot 2.5s ease-in-out infinite',
          }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {guardCount > 0 && (
            <div style={{
              fontSize: '7px',
              fontFamily: 'var(--font-mono)',
              color: 'hsl(38 92% 65%)',
              fontWeight: 700,
            }}>
              {guardCount} guard
            </div>
          )}
          {discrepancyCount > 0 && (
            <div style={{
              fontSize: '7px',
              fontFamily: 'var(--font-mono)',
              color: 'hsl(280 65% 60%)',
              fontWeight: 700,
            }}>
              {discrepancyCount} reroute
            </div>
          )}
          <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
            {total} total
          </span>
        </div>
      </div>

      {/* Column labels */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.3rem',
        paddingLeft: '0.3rem',
        borderBottom: '1px solid var(--border)',
        paddingBottom: '0.15rem',
      }}>
        {['TIME', 'PROMPT', 'SELECTED', '', 'ROUTED'].map((h, i) => (
          <div key={i} style={{
            fontSize: '5px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--muted-foreground)',
            letterSpacing: '0.05em',
            width: h === 'PROMPT' ? undefined : (i === 0 ? 36 : undefined),
            flex: i === 2 ? undefined : 1,
          }}>
            {h}
          </div>
        ))}
      </div>

      {/* Feed */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {visible.length === 0 ? (
          <div style={{ padding: '0.5rem 0', textAlign: 'center' }}>
            <span style={{ fontSize: '7px', fontFamily: 'var(--font-mono)', color: 'hsl(145 65% 60%)' }}>
              NOMINAL — no discrepancies detected
            </span>
          </div>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.05rem',
            maxHeight: 120,
            overflowY: 'auto',
            overflowX: 'hidden',
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--muted) transparent',
          }}>
            {visible.map((item) => (
              <DiscrepancyRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        {[
          { color: 'hsl(280 65% 60%)', label: 'reroute' },
          { color: 'hsl(38 92% 65%)', label: 'guard applied' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
            <div style={{ width: 6, height: 6, borderLeft: `2px solid ${color}` }} />
            <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
