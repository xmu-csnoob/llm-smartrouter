import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

const WINDOW_MS = 15 * 60 * 1000
const MIN_SAMPLES = 15
const MAX_FLOW_ANNOTATIONS = 8

function parseTimestamp(ts: string | null | undefined): number | null {
  if (typeof ts !== 'string' || !ts) return null
  const parsed = new Date(ts).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

type FlowType = 'direct' | 'degraded' | 'escalated'

interface FlowEdge {
  from: string
  to: string
  count: number
  flowType: FlowType
}

interface TierNode {
  tier: string
  x: number
  y: number
  totalIn: number
  totalOut: number
  health: 'NOMINAL' | 'WATCH' | 'CRITICAL'
}

const TIER_COLORS: Record<string, string> = {
  tier1: 'hsl(280 65% 65%)',
  tier2: 'hsl(200 75% 55%)',
  tier3: 'hsl(145 65% 55%)',
}
const TIER_LABELS: Record<string, string> = {
  tier1: 'Frontier',
  tier2: 'Workhorse',
  tier3: 'Routine',
}

function healthFromEntries(entries: LogEntry[], tier: string): 'NOMINAL' | 'WATCH' | 'CRITICAL' {
  const filtered = entries.filter(e => e.routed_tier === tier)
  if (filtered.length === 0) return 'NOMINAL'
  const errors = filtered.filter(e => e.status >= 400 || !!e.error).length
  const fallbacks = filtered.filter(e => e.is_fallback).length
  const errRate = errors / filtered.length
  const fbRate = fallbacks / filtered.length
  if (errRate > 0.10 || fbRate > 0.15) return 'CRITICAL'
  if (errRate > 0.03 || fbRate > 0.05) return 'WATCH'
  return 'NOMINAL'
}

function healthColor(h: 'NOMINAL' | 'WATCH' | 'CRITICAL'): string {
  if (h === 'CRITICAL') return 'hsl(0 72% 55%)'
  if (h === 'WATCH') return 'hsl(38 92% 55%)'
  return 'hsl(145 65% 55%)'
}

export function TierRoutingFlowDiagram({ entries }: { entries: LogEntry[] }) {
  const stats = useMemo((): {
    nodes: TierNode[]
    edges: FlowEdge[]
    total: number
    windowSize: number
  } | null => {
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

    // Build inter-tier flow map
    const flowMap = new Map<string, number>()

    for (const e of logEntries) {
      const selected = e.selected_tier || e.routed_tier || 'unknown'
      const routed = e.routed_tier || 'unknown'

      if (selected === 'unknown' || routed === 'unknown') continue
      if (!(selected in TIER_COLORS) || !(routed in TIER_COLORS)) continue

      const key = `${selected}→${routed}`
      flowMap.set(key, (flowMap.get(key) || 0) + 1)
    }

    // Build nodes
    const nodeX: Record<string, number> = { tier1: 60, tier2: 210, tier3: 360 }
    const nodeY = 100

    const nodes: TierNode[] = (['tier1', 'tier2', 'tier3'] as const).map(tier => {
      const inEdges = [...flowMap.entries()].filter(([k]) => k.endsWith(`→${tier}`))
      const outEdges = [...flowMap.entries()].filter(([k]) => k.startsWith(`${tier}→`))
      const totalIn = inEdges.reduce((s, [, v]) => s + v, 0)
      const totalOut = outEdges.reduce((s, [, v]) => s + v, 0)
      return {
        tier,
        x: nodeX[tier],
        y: nodeY,
        totalIn,
        totalOut,
        health: healthFromEntries(logEntries, tier),
      }
    })

    // Build edges
    const edges: FlowEdge[] = []
    for (const [key, count] of flowMap) {
      const [from, to] = key.split('→')
      let flowType: FlowType = 'direct'
      const tierOrder: Record<string, number> = { tier3: 0, tier2: 1, tier1: 2 }
      const selOrder = tierOrder[from] ?? -1
      const rouOrder = tierOrder[to] ?? -1
      if (selOrder !== -1 && rouOrder !== -1) {
        if (rouOrder < selOrder) flowType = 'degraded'
        else if (rouOrder > selOrder) flowType = 'escalated'
      }
      edges.push({ from, to, count, flowType })
    }

    // Sort edges by count, take top flows
    edges.sort((a, b) => b.count - a.count)
    const topEdges = edges.slice(0, MAX_FLOW_ANNOTATIONS)

    return { nodes, edges: topEdges, total: logEntries.length, windowSize: window.length }
  }, [entries])

  if (!stats) {
    return (
      <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', animation: 'fade-in-up 400ms ease both', animationDelay: '983ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          INSUFFICIENT ROUTING FLOW DATA
        </div>
      </div>
    )
  }

  const { nodes, edges, total, windowSize } = stats
  const svgW = 440
  const svgH = 200

  // Node positions (same as nodes)
  const getNode = (tier: string) => nodes.find(n => n.tier === tier)!

  const edgePath = (e: FlowEdge): string => {
    const from = getNode(e.from)
    const to = getNode(e.to)
    if (!from || !to) return ''
    const dx = to.x - from.x
    const cx1 = from.x + dx * 0.5
    const cy1 = from.y
    const cx2 = from.x + dx * 0.5
    const cy2 = to.y
    return `M ${from.x} ${from.y} C ${cx1} ${cy1} ${cx2} ${cy2} ${to.x} ${to.y}`
  }

  const edgeLabelPos = (e: FlowEdge): { x: number; y: number } => {
    const from = getNode(e.from)
    const to = getNode(e.to)
    if (!from || !to) return { x: 0, y: 0 }
    return {
      x: (from.x + to.x) / 2,
      y: from.y + (to.y - from.y) / 2 - 8,
    }
  }

  const maxEdgeCount = Math.max(...edges.map(e => e.count), 1)
  const edgeWidth = (count: number) => Math.max(1, (count / maxEdgeCount) * 10)

  const flowColor = (ft: FlowType): string => {
    if (ft === 'degraded') return 'hsl(38 92% 55%)'
    if (ft === 'escalated') return 'hsl(280 65% 65%)'
    return 'hsl(185 80% 55%)'
  }

  return (
    <div className="gs-panel" style={{ padding: '0.4rem 0.5rem', gap: '0.18rem', animation: 'fade-in-up 400ms ease both', animationDelay: '983ms' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
          Tier Routing Flow
        </span>
        <div style={{ display: 'flex', gap: '0.15rem', alignItems: 'center' }}>
          {([
            { label: '→', color: 'hsl(185 80% 55%)', desc: 'direct' },
            { label: '↓', color: 'hsl(38 92% 55%)', desc: 'degraded' },
            { label: '↑', color: 'hsl(280 65% 65%)', desc: 'escalated' },
          ] as const).map(({ label, color, desc }) => (
            <span key={desc} style={{
              fontSize: '5px', fontFamily: 'var(--font-mono)',
              color, background: `${color}15`,
              border: `1px solid ${color}30`,
              borderRadius: 2, padding: '2px 5px',
            }}>
              {label} {desc}
            </span>
          ))}
        </div>
      </div>

      {/* SVG Flow Diagram */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <svg width={svgW} height={svgH} style={{ overflow: 'visible' }}>
          {/* Tier nodes */}
          {nodes.map(node => {
            const hc = healthColor(node.health)
            return (
              <g key={node.tier}>
                {/* Glow */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={28}
                  fill={hc}
                  opacity={0.08}
                  style={{ filter: `blur(8px)` }}
                />
                {/* Node ring */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={22}
                  fill="hsl(225 45% 6%)"
                  stroke={hc}
                  strokeWidth={node.health === 'NOMINAL' ? 1.5 : 2}
                  strokeOpacity={0.7}
                />
                {/* Inner fill */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={16}
                  fill={hc}
                  opacity={0.15}
                />
                {/* Tier label */}
                <text
                  x={node.x}
                  y={node.y - 2}
                  fontSize="6"
                  fill={hc}
                  fontFamily="var(--font-mono)"
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {TIER_LABELS[node.tier]}
                </text>
                {/* Count */}
                <text
                  x={node.x}
                  y={node.y + 9}
                  fontSize="4.5"
                  fill={hc}
                  fontFamily="var(--font-mono)"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  opacity={0.8}
                >
                  n={node.totalIn}
                </text>
              </g>
            )
          })}

          {/* Edges */}
          {edges.map((edge, i) => {
            const path = edgePath(edge)
            if (!path) return null
            const labelPos = edgeLabelPos(edge)
            const ew = edgeWidth(edge.count)
            const color = flowColor(edge.flowType)
            const pct = ((edge.count / total) * 100).toFixed(1)

            return (
              <g key={`${edge.from}-${edge.to}`}>
                {/* Animated dash flow */}
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={ew}
                  strokeOpacity={0.4}
                  strokeLinecap="round"
                  strokeDasharray="6 4"
                  style={{
                    animation: `flow-dash 1.5s linear infinite`,
                    animationDelay: `${i * 0.18}s`,
                  }}
                />
                {/* Solid thin base */}
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={0.5}
                  strokeOpacity={0.2}
                  strokeLinecap="round"
                />
                {/* Arrow head at end */}
                {(() => {
                  const from = getNode(edge.from)
                  const to = getNode(edge.to)
                  if (!from || !to) return null
                  const angle = Math.atan2(to.y - from.y, to.x - from.x)
                  const arrowX = to.x - 24 * Math.cos(angle)
                  const arrowY = to.y - 24 * Math.sin(angle)
                  const arrowSize = 5
                  const a1 = angle + Math.PI * 0.8
                  const a2 = angle - Math.PI * 0.8
                  return (
                    <polygon
                      points={`${to.x - 22 * Math.cos(angle)},${to.y - 22 * Math.sin(angle)} ${arrowX + arrowSize * Math.cos(a1)},${arrowY + arrowSize * Math.sin(a1)} ${arrowX + arrowSize * Math.cos(a2)},${arrowY + arrowSize * Math.sin(a2)}`}
                      fill={color}
                      opacity={0.7}
                    />
                  )
                })()}
                {/* Label */}
                <rect
                  x={labelPos.x - 14}
                  y={labelPos.y - 6}
                  width={28}
                  height={12}
                  rx={2}
                  fill="hsl(225 45% 6%)"
                  stroke="hsl(225 45% 15%)"
                  strokeWidth={0.5}
                />
                <text
                  x={labelPos.x}
                  y={labelPos.y + 1}
                  fontSize="5"
                  fill={color}
                  fontFamily="var(--font-mono)"
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {pct}%
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Legend + footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.15rem' }}>
          {(['NOMINAL', 'WATCH', 'CRITICAL'] as const).map(h => (
            <span key={h} style={{
              fontSize: '4px', fontFamily: 'var(--font-mono)',
              color: healthColor(h),
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              ● {h}
            </span>
          ))}
        </div>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '5px',
          color: 'var(--muted-foreground)', opacity: 0.7,
        }}>
          {windowSize} entries · 15-min window · top {Math.min(edges.length, MAX_FLOW_ANNOTATIONS)} flows shown
        </span>
      </div>

      <style>{`
        @keyframes flow-dash {
          from { stroke-dashoffset: 20; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  )
}
