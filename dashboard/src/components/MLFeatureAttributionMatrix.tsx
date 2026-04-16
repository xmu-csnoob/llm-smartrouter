import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 15 * 60 * 1000
const MIN_SAMPLES = 15

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

const TIER_ORDER = ['tier1', 'tier2', 'tier3', 'unknown'] as const
type Tier = typeof TIER_ORDER[number]

const TIER_META: Record<Tier, { color: string; label: string }> = {
  tier1:   { color: 'hsl(280 65% 65%)', label: 'T1' },
  tier2:   { color: 'hsl(185 80% 55%)', label: 'T2' },
  tier3:   { color: 'hsl(145 65% 55%)', label: 'T3' },
  unknown: { color: 'hsl(225 45% 35%)', label: 'Unkn' },
}

// Normalize a raw feature value to 0-1 range
function normalizeValue(value: number | boolean): number {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value !== 'number') return 0
  const maxExpected = 10
  return Math.min(value, maxExpected) / maxExpected
}

interface FeatureStats {
  key: string
  isBoolean: boolean
  tierAverages: Record<Tier, { sum: number; count: number; normalizedSum: number }>
  overallAvg: number
  overallNormalizedAvg: number
  totalSamples: number
  tierCounts: Record<Tier, number>
}

interface MatrixStats {
  features: FeatureStats[]
  tiers: Tier[]
  windowSize: number
  coverage: number // fraction of entries that had raw_features
}

export function MLFeatureAttributionMatrix({ entries }: { entries: LogEntry[] }) {
  const stats = useMemo((): MatrixStats | null => {
    const now = Date.now()
    const timed = entries
      .map(e => {
        const tsMs = parseTimestamp(e.timestamp)
        return tsMs == null ? null : { entry: e, tsMs }
      })
      .filter((item): item is { entry: LogEntry; tsMs: number } => item != null)
      .sort((a, b) => b.tsMs - a.tsMs)

    const recent = timed.filter(({ tsMs }) => now - tsMs <= WINDOW_MS)
    const window = recent.length >= MIN_SAMPLES ? recent : timed.slice(0, 80)
    if (window.length < MIN_SAMPLES) return null

    const logEntries = window.map(w => w.entry)

    // Collect all raw_features keys across all entries
    const allKeys = new Set<string>()
    const entriesWithFeatures = logEntries.filter(e => e.raw_features && Object.keys(e.raw_features).length > 0)
    for (const e of entriesWithFeatures) {
      for (const key of Object.keys(e.raw_features!)) {
        allKeys.add(key)
      }
    }

    if (allKeys.size === 0) return null

    // Build per-feature, per-tier stats
    const featureMap = new Map<string, FeatureStats>()

    for (const key of allKeys) {
      const tierAverages: Record<Tier, { sum: number; count: number; normalizedSum: number }> = {
        tier1: { sum: 0, count: 0, normalizedSum: 0 },
        tier2: { sum: 0, count: 0, normalizedSum: 0 },
        tier3: { sum: 0, count: 0, normalizedSum: 0 },
        unknown: { sum: 0, count: 0, normalizedSum: 0 },
      }
      const tierCounts: Record<Tier, number> = { tier1: 0, tier2: 0, tier3: 0, unknown: 0 }

      let totalRaw = 0
      let totalNormalized = 0
      let totalSamples = 0
      let isBoolean = false

      for (const e of logEntries) {
        const raw = e.raw_features
        if (!raw || !(key in raw)) continue

        const value = raw[key]
        if (value === undefined || value === null) continue

        if (!isBoolean && typeof value === 'boolean') isBoolean = true

        const tier = (e.routed_tier || 'unknown') as Tier
        const tierKey = TIER_ORDER.includes(tier) ? tier : 'unknown'

        if (typeof value === 'number') {
          tierAverages[tierKey].sum += value
          tierAverages[tierKey].count++
          tierAverages[tierKey].normalizedSum += normalizeValue(value)
        } else if (typeof value === 'boolean') {
          const norm = value ? 1 : 0
          tierAverages[tierKey].sum += norm
          tierAverages[tierKey].count++
          tierAverages[tierKey].normalizedSum += norm
        }

        tierCounts[tierKey]++
        totalRaw += typeof value === 'number' ? value : (value ? 1 : 0)
        totalNormalized += normalizeValue(value)
        totalSamples++
      }

      const totalCount = Object.values(tierAverages).reduce((s, t) => s + t.count, 0)
      if (totalCount < 3) continue // skip features with very few samples

      featureMap.set(key, {
        key,
        isBoolean,
        tierAverages,
        overallAvg: totalCount > 0 ? totalRaw / totalCount : 0,
        overallNormalizedAvg: totalSamples > 0 ? totalNormalized / totalSamples : 0,
        totalSamples: totalCount,
        tierCounts,
      })
    }

    const features = [...featureMap.values()]
      .sort((a, b) => b.totalSamples - a.totalSamples)

    // Only show tiers that have data
    const tiers = TIER_ORDER.filter(t =>
      features.some(f => f.tierCounts[t] > 0)
    )

    const coverage = entriesWithFeatures.length / logEntries.length

    return { features, tiers, windowSize: window.length, coverage }
  }, [entries])

  if (!stats) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '978ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT ML FEATURE DATA
        </div>
      </div>
    )
  }

  const { features, tiers, windowSize, coverage } = stats

  const CELL_W = 36
  const CELL_H = 18
  const GAP = 2
  const FEATURE_L = 70
  const AVG_W = 22
  const svgW = FEATURE_L + AVG_W + tiers.length * (CELL_W + GAP) + GAP + 4
  const svgH = 12 + features.length * (CELL_H + GAP) + GAP + 4

  const cellX = (ci: number) => FEATURE_L + AVG_W + GAP + ci * (CELL_W + GAP)
  const cellY = (ri: number) => 12 + GAP + ri * (CELL_H + GAP)

  const toColor = (normVal: number): string => {
    if (normVal === 0) return 'hsl(225 45% 8%)'
    if (normVal < 0.2) return 'hsl(145 65% 18%)'
    if (normVal < 0.4) return 'hsl(145 65% 28%)'
    if (normVal < 0.6) return 'hsl(38 92% 38%)'
    if (normVal < 0.8) return 'hsl(38 92% 50%)'
    return 'hsl(38 92% 60%)'
  }

  const displayKey = (key: string): string => {
    // Shorten common prefixes
    return key
      .replace(/^debug_/, 'dbg_')
      .replace(/^design_/, 'dsn_')
      .replace(/^implementation_/, 'impl_')
      .replace(/^review_/, 'rev_')
      .replace(/^explain_/, 'exp_')
      .replace(/^generation_/, 'gen_')
      .replace(/^reasoning_/, 'rsn_')
      .replace(/^constraint_/, 'cnst_')
      .replace(/^comparison_/, 'cmp_')
      .replace(/^migration_/, 'mig_')
      .replace(/^performance_/, 'perf_')
      .replace(/^has_/, '')
      .replace(/^is_/, '')
      .slice(0, 12)
  }

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '978ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          ML Feature Attribution
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          <span style={{
            fontSize: '5px', fontFamily: 'var(--font-mono)',
            color: coverage > 0.5 ? 'hsl(145 65% 55%)' : 'hsl(38 92% 55%)',
            background: coverage > 0.5 ? 'hsl(145 65% 55% / 0.12)' : 'hsl(38 92% 55% / 0.12)',
            border: `1px solid ${coverage > 0.5 ? 'hsl(145 65% 55% / 0.3)' : 'hsl(38 92% 55% / 0.3)'}`,
            borderRadius: 2, padding: '2px 5px',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {(coverage * 100).toFixed(0)}% covered
          </span>
        </div>
      </div>

      {/* Sub-header */}
      <div style={{ display: 'flex', gap: '0.3rem', padding: '0.08rem 0.2rem', background: 'hsl(225 45% 8%)', borderRadius: 3 }}>
        {([
          { label: 'Features', value: features.length, color: 'var(--foreground)' },
          { label: 'Entries', value: windowSize, color: 'var(--foreground)' },
          { label: 'Avg Value', value: (features.reduce((s, f) => s + f.overallNormalizedAvg, 0) / (features.length || 1)).toFixed(2), color: 'hsl(185 80% 55%)' },
        ] as const).map(({ label, value, color }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center' }}>
            <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {label}
            </span>
            <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', fontWeight: 700, color, textShadow: `0 0 5px ${color}40` }}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Feature × Tier heatmap */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <svg width={svgW} height={svgH} style={{ overflow: 'visible' }}>
          {/* Column headers */}
          {/* Avg column header */}
          <text
            x={FEATURE_L + AVG_W / 2}
            y={8}
            fontSize="4"
            fill="hsl(225 45% 30%)"
            fontFamily="var(--font-mono)"
            textAnchor="middle"
            dominantBaseline="auto"
          >
            AVG
          </text>

          {/* Tier headers */}
          {tiers.map((tier, ci) => {
            const meta = TIER_META[tier]
            return (
              <text
                key={tier}
                x={cellX(ci) + CELL_W / 2}
                y={8}
                fontSize="4.5"
                fill={meta.color}
                fontFamily="var(--font-mono)"
                textAnchor="middle"
                dominantBaseline="auto"
              >
                {meta.label}
              </text>
            )
          })}

          {/* Rows */}
          {features.map((feat, ri) => {
            const featLabel = displayKey(feat.key)
            return (
              <g key={feat.key}>
                {/* Feature label */}
                <text
                  x={FEATURE_L - 2}
                  y={cellY(ri) + CELL_H / 2 + 1}
                  fontSize="4.5"
                  fill={feat.isBoolean ? 'hsl(38 92% 60%)' : 'hsl(185 80% 60%)'}
                  fontFamily="var(--font-mono)"
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {featLabel}
                </text>

                {/* Overall average bar */}
                <rect
                  x={FEATURE_L + 2}
                  y={cellY(ri) + 2}
                  width={AVG_W - 4}
                  height={CELL_H - 4}
                  rx={2}
                  fill={toColor(feat.overallNormalizedAvg)}
                  opacity={0.9}
                />
                <text
                  x={FEATURE_L + AVG_W / 2}
                  y={cellY(ri) + CELL_H / 2 + 1}
                  fontSize="4"
                  fill="hsl(225 45% 80%)"
                  fontFamily="var(--font-mono)"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {feat.overallNormalizedAvg.toFixed(2)}
                </text>

                {/* Per-tier cells */}
                {tiers.map((tier, ci) => {
                  const ta = feat.tierAverages[tier]
                  const avgNorm = ta.count > 0 ? ta.normalizedSum / ta.count : 0
                  const n = ta.count
                  const isLow = n < 5
                  return (
                    <g key={tier}>
                      <rect
                        x={cellX(ci)}
                        y={cellY(ri)}
                        width={CELL_W}
                        height={CELL_H}
                        rx={2}
                        fill={toColor(avgNorm)}
                        opacity={isLow ? 0.25 : 0.88}
                      />
                      {n >= 3 && (
                        <>
                          <text
                            x={cellX(ci) + CELL_W / 2}
                            y={cellY(ri) + CELL_H / 2 - 1.5}
                            fontSize="4.5"
                            fill="hsl(225 45% 85%)"
                            fontFamily="var(--font-mono)"
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontWeight={700}
                          >
                            {avgNorm.toFixed(2)}
                          </text>
                          <text
                            x={cellX(ci) + CELL_W / 2}
                            y={cellY(ri) + CELL_H / 2 + 4.5}
                            fontSize="3.5"
                            fill={isLow ? 'hsl(225 45% 25%)' : 'hsl(225 45% 40%)'}
                            fontFamily="var(--font-mono)"
                            textAnchor="middle"
                            dominantBaseline="middle"
                          >
                            {n < 10 ? `${n}` : `${n}`}
                          </text>
                        </>
                      )}
                      {n > 0 && n < 3 && (
                        <text
                          x={cellX(ci) + CELL_W / 2}
                          y={cellY(ri) + CELL_H / 2}
                          fontSize="3"
                          fill="hsl(225 45% 20%)"
                          fontFamily="var(--font-mono)"
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          n={n}
                        </text>
                      )}
                    </g>
                  )
                })}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Color legend */}
      <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)', marginRight: '0.1rem' }}>
          0.0
        </span>
        {([0, 0.2, 0.4, 0.6, 0.8, 1] as const).map(v => (
          <div key={v} style={{ width: 10, height: 6, borderRadius: 1, background: toColor(v) }} />
        ))}
        <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)', marginLeft: '0.1rem' }}>
          1.0
        </span>
        <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)', marginLeft: '0.2rem' }}>
          normalized avg · cells with n&lt;5 shown muted
        </span>
      </div>

      {/* Footer */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '5px',
        color: 'var(--muted-foreground)', textAlign: 'right', opacity: 0.7,
      }}>
        {windowSize} entries · 15-min window · booleans normalized 0/1 · n&lt;3 filtered
      </div>
    </div>
  )
}
