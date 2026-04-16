import type { LogEntry } from '@/hooks/useApi'
import { X } from 'lucide-react'

interface Props {
  entry: LogEntry | null
  onClose: () => void
}

const TIER_COLORS: Record<string, string> = {
  tier1: 'hsl(280 65% 60%)',
  tier2: 'hsl(200 75% 55%)',
  tier3: 'hsl(145 65% 48%)',
}

function FeatureBar({ label, value, max = 1, color = 'hsl(200 75% 55%)' }: { label: string; value: number; max?: number; color?: string }) {
  const pct = Math.min(100, (value / max) * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 4 }}>
      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', width: 120, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 5, background: 'var(--muted)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 400ms ease' }} />
      </div>
      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--foreground)', width: 28, textAlign: 'right' }}>{value.toFixed(2)}</span>
    </div>
  )
}

export function RoutingDecisionDrawer({ entry, onClose }: Props) {
  if (!entry) return null

  const sf = entry.semantic_features
  const sp = entry.shadow_policy_decision
  const rc = entry.router_context as Record<string, unknown> | undefined
  const tierColor = TIER_COLORS[entry.routed_tier] || 'var(--muted-foreground)'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} />

      {/* Drawer */}
      <div
        style={{
          position: 'relative',
          width: 420,
          maxWidth: '90vw',
          height: '100%',
          background: 'var(--card)',
          borderLeft: '1px solid var(--border)',
          overflowY: 'auto',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideInRight 200ms ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--popover)' }}>
          <div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--foreground)' }}>Routing Decision</div>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
              {entry.request_id}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center' }}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
          {/* Tier Result */}
          <section>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Tier Result</div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <div style={{
                padding: '0.3rem 0.75rem',
                borderRadius: 6,
                background: `${tierColor}20`,
                border: `1px solid ${tierColor}60`,
                boxShadow: `0 0 10px ${tierColor}30`,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 700,
                color: tierColor,
              }}>
                {entry.routed_tier?.toUpperCase()}
              </div>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>→</span>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}>{entry.routed_model}</span>
              {entry.is_fallback && (
                <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', padding: '0.1rem 0.4rem', borderRadius: 3, background: 'hsl(25 95% 55% / 0.15)', border: '1px solid hsl(25 95% 55% / 0.3)', color: 'hsl(25 95% 60%)' }}>
                  FALLBACK
                </span>
              )}
            </div>
            <div style={{ marginTop: '0.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.375rem' }}>
              {[
                { label: 'Latency', value: entry.latency_ms ? `${entry.latency_ms}ms` : '—' },
                { label: 'TTFT', value: entry.ttft_ms ? `${entry.ttft_ms}ms` : '—' },
                { label: 'Status', value: entry.status || '—' },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: 'var(--muted)', borderRadius: 5, padding: '0.3rem 0.5rem', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>{label}</div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--foreground)', marginTop: 2 }}>{value}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Semantic Features */}
          {sf && (
            <section>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Semantic Features</div>
              <div style={{ background: 'var(--muted)', borderRadius: 8, padding: '0.75rem', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem', marginBottom: '0.5rem' }}>
                  {[
                    { label: 'Intent', value: sf.intent },
                    { label: 'Difficulty', value: sf.difficulty },
                    { label: 'Domain', value: sf.domain },
                    { label: 'Recursive', value: sf.recursive_depth },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background: 'var(--card)', borderRadius: 5, padding: '0.25rem 0.4rem', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>{label}</div>
                      <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--foreground)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(value)}</div>
                    </div>
                  ))}
                </div>
                <FeatureBar label="Debug Signal" value={sf.debug_signal_count} max={10} color="hsl(0 72% 60%)" />
                <FeatureBar label="Design Signal" value={sf.design_signal_count} max={10} color="hsl(280 65% 60%)" />
                <FeatureBar label="Impl Signal" value={sf.implementation_signal_count} max={10} color="hsl(200 75% 55%)" />
                <FeatureBar label="Review Signal" value={sf.review_signal_count} max={10} color="hsl(145 65% 48%)" />
                <FeatureBar label="Explain Signal" value={sf.explain_signal_count} max={10} color="hsl(45 85% 50%)" />
                <FeatureBar label="Generation" value={sf.generation_signal_count} max={10} color="hsl(330 70% 55%)" />
                <FeatureBar label="Reasoning" value={sf.reasoning_signal_count} max={10} color="hsl(190 80% 45%)" />
                <FeatureBar label="Constraints" value={sf.constraint_signal_count} max={10} color="hsl(260 65% 65%)" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.25rem', marginTop: '0.25rem' }}>
                  {[
                    { label: 'Cross-file', value: sf.cross_file_analysis },
                    { label: 'Reasoning', value: sf.requires_reasoning },
                    { label: 'Followup', value: sf.is_followup },
                    { label: 'Clarify', value: sf.clarification_needed_score.toFixed(2) },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background: 'var(--card)', borderRadius: 4, padding: '0.2rem 0.35rem', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 7, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>{label}</div>
                      <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: value === true || value === false ? (value ? 'hsl(145 65% 55%)' : 'var(--muted-foreground)') : 'var(--foreground)', marginTop: 1 }}>
                        {String(value)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Shadow Policy Decision */}
          {sp && (
            <section>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Shadow Policy</div>
              <div style={{ background: 'var(--muted)', borderRadius: 8, padding: '0.75rem', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>Mode:</span>
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: sp.enabled ? 'hsl(145 65% 55%)' : 'var(--muted-foreground)' }}>{sp.mode.toUpperCase()}</span>
                  {sp.candidate_tier && (
                    <>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>→</span>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: TIER_COLORS[sp.candidate_tier] }}>{sp.candidate_tier.toUpperCase()}</span>
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>Propensity:</span>
                  <div style={{ flex: 1, height: 5, background: 'var(--card)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${(sp.propensity || 0) * 100}%`, height: '100%', background: 'hsl(280 65% 60%)', borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}>{(sp.propensity || 0).toFixed(3)}</span>
                </div>
                {sp.hard_exclusions_triggered?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.125rem' }}>
                    <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'hsl(0 72% 60%)' }}>Hard exclusions:</span>
                    {sp.hard_exclusions_triggered.map((r) => (
                      <span key={r} style={{ fontSize: 8, fontFamily: 'var(--font-mono)', padding: '0.1rem 0.3rem', borderRadius: 3, background: 'hsl(0 72% 55% / 0.1)', border: '1px solid hsl(0 72% 55% / 0.3)', color: 'hsl(0 72% 65%)' }}>{r}</span>
                    ))}
                  </div>
                )}
                {sp.exclusion_reason && (
                  <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'hsl(25 95% 60%)', marginTop: '0.125rem' }}>Excluded: {sp.exclusion_reason}</div>
                )}
              </div>
            </section>
          )}

          {/* Router Context */}
          {rc && Object.keys(rc).length > 0 && (
            <section>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Router Context</div>
              <div style={{ background: 'var(--muted)', borderRadius: 8, padding: '0.75rem', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {Object.entries(rc).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)' }}>{k}</span>
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--foreground)' }}>
                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Fallback Chain */}
          {entry.fallback_chain && entry.fallback_chain.length > 0 && (
            <section>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Fallback Chain</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {entry.fallback_chain.map((step, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'hsl(25 95% 55% / 0.2)', border: '1px solid hsl(25 95% 55% / 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontFamily: 'var(--font-mono)', color: 'hsl(25 95% 60%)', flexShrink: 0 }}>
                      {i + 1}
                    </div>
                    <div style={{ flex: 1, background: 'var(--muted)', borderRadius: 5, padding: '0.25rem 0.5rem', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, color: TIER_COLORS[step.tier] }}>{step.tier.toUpperCase()}</span>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}>{step.model}</span>
                    </div>
                    {step.error && (
                      <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'hsl(0 72% 60%)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {step.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Request Preview */}
          {entry.request_preview && (
            <section>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Request Preview</div>
              <div style={{ background: 'var(--muted)', borderRadius: 8, padding: '0.75rem', border: '1px solid var(--border)', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', lineHeight: 1.5, maxHeight: 100, overflow: 'hidden' }}>
                {entry.request_preview}
              </div>
            </section>
          )}
        </div>

        <style>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  )
}
