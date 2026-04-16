import { useMemo } from 'react'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
}

const MAX_MODELS = 8
const MIN_SAMPLE = 5

type ErrorType = 'rate_limit' | 'context_limit' | 'timeout' | 'server_error' | 'other'

const ERROR_TYPE_CONFIG: Record<ErrorType, { label: string; color: string }> = {
  rate_limit:    { label: '429',  color: 'hsl(38 92% 55%)' },
  context_limit: { label: 'CTX',  color: 'hsl(280 65% 65%)' },
  timeout:       { label: 'TMO',  color: 'hsl(200 75% 55%)' },
  server_error:  { label: '5XX',  color: 'hsl(0 72% 55%)'  },
  other:         { label: 'OTH',  color: 'hsl(0 0% 55%)'   },
}

interface ModelErrorProfile {
  model: string
  total: number
  rateLimit: number
  contextLimit: number
  timeout: number
  serverError: number
  other: number
  errorRate: number
  lowN: boolean
}

function classifyError(status: number, error: string | null): ErrorType {
  if (status === 429) return 'rate_limit'
  if (status === 400 || (error?.toLowerCase() ?? '').includes('context')) return 'context_limit'
  if ((error?.toLowerCase() ?? '').includes('timeout')) return 'timeout'
  if (status >= 500) return 'server_error'
  return 'other'
}

function ErrorFingerprintRow({ profile }: { profile: ModelErrorProfile }) {
  const { model, rateLimit, contextLimit, timeout, serverError, other, errorRate, lowN } = profile
  const segments: { type: ErrorType; count: number; color: string }[] = [
    { type: 'rate_limit' as ErrorType,    count: rateLimit,    color: ERROR_TYPE_CONFIG.rate_limit.color    },
    { type: 'context_limit' as ErrorType, count: contextLimit, color: ERROR_TYPE_CONFIG.context_limit.color },
    { type: 'timeout' as ErrorType,       count: timeout,       color: ERROR_TYPE_CONFIG.timeout.color       },
    { type: 'server_error' as ErrorType,  count: serverError,  color: ERROR_TYPE_CONFIG.server_error.color  },
    { type: 'other' as ErrorType,         count: other,         color: ERROR_TYPE_CONFIG.other.color         },
  ].filter(s => s.count > 0)

  const totalWidth = Math.max(...segments.map(s => s.count), 1)

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.3rem',
      padding: '0.1rem 0',
      borderBottom: '1px solid hsl(225 45% 10%)',
      opacity: lowN ? 0.4 : 1,
    }}>
      {/* Model name */}
      <div style={{
        width: 72, flexShrink: 0,
        fontSize: '6px', fontFamily: 'var(--font-mono)',
        color: 'var(--foreground)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontWeight: 600,
      }}>
        {model}
      </div>

      {/* Error bar */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', height: 8, background: 'hsl(225 45% 10%)', borderRadius: 3, overflow: 'hidden', gap: 1 }}>
        {segments.map(seg => (
          <div key={seg.type} style={{
            height: '100%',
            width: `${(seg.count / totalWidth) * 100}%`,
            background: seg.color,
            boxShadow: `0 0 3px ${seg.color}40`,
            transition: 'width 400ms ease',
          }} />
        ))}
        {segments.length === 0 && (
          <div style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '4px', fontFamily: 'var(--font-mono)', color: 'hsl(145 65% 55%)' }}>CLEAN</span>
          </div>
        )}
      </div>

      {/* Legend dots */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem', flexShrink: 0 }}>
        {segments.map(seg => (
          <div key={seg.type} style={{ width: 4, height: 4, borderRadius: '50%', background: seg.color, boxShadow: `0 0 3px ${seg.color}` }} />
        ))}
      </div>

      {/* Error count */}
      <div style={{
        width: 24, flexShrink: 0, textAlign: 'right',
        fontSize: '6px', fontFamily: 'var(--font-mono)',
        color: errorRate > 0 ? ERROR_TYPE_CONFIG.other.color : 'hsl(145 65% 55%)',
        fontWeight: 700,
      }}>
        {errorRate > 0 ? (rateLimit + contextLimit + timeout + serverError + other) : '0'}
      </div>

      {/* Error rate */}
      <div style={{
        width: 28, flexShrink: 0, textAlign: 'right',
        fontSize: '6px', fontFamily: 'var(--font-mono)',
        color: errorRate > 0.1 ? ERROR_TYPE_CONFIG.server_error.color : errorRate > 0 ? ERROR_TYPE_CONFIG.other.color : 'hsl(145 65% 55%)',
        fontWeight: 700,
      }}>
        {lowN ? 'LOW-N' : errorRate > 0 ? `${(errorRate * 100).toFixed(0)}%` : '—'}
      </div>
    </div>
  )
}

export function ModelErrorFingerprint({ entries }: Props) {
  const { profiles } = useMemo(() => {
    const modelMap: Record<string, ModelErrorProfile> = {}

    for (const entry of entries) {
      const model = entry.routed_model
      if (!model) continue

      if (!modelMap[model]) {
        modelMap[model] = { model, total: 0, rateLimit: 0, contextLimit: 0, timeout: 0, serverError: 0, other: 0, errorRate: 0, lowN: true }
      }
      const profile = modelMap[model]
      profile.total += 1

      // Top-level error
      const hasError = (entry.status >= 400) || !!entry.error
      if (hasError) {
        const type = classifyError(entry.status, entry.error)
        if (type === 'rate_limit') profile.rateLimit++
        else if (type === 'context_limit') profile.contextLimit++
        else if (type === 'timeout') profile.timeout++
        else if (type === 'server_error') profile.serverError++
        else profile.other++
      }

      // Fallback chain errors — attribute to the model that failed
      if (entry.fallback_chain) {
        for (const fb of entry.fallback_chain) {
          const fbModel = fb.model
          if (!fbModel || fbModel === model) continue
          if (!modelMap[fbModel]) {
            modelMap[fbModel] = { model: fbModel, total: 0, rateLimit: 0, contextLimit: 0, timeout: 0, serverError: 0, other: 0, errorRate: 0, lowN: true }
          }
          const fbProfile = modelMap[fbModel]
          fbProfile.total += 1
          const fbError = fb.error
          const fbHasError = !!fbError
          if (fbHasError) {
            const fbStatus = fbError?.toLowerCase().includes('rate') || fbError?.toLowerCase().includes('429') ? 429
              : fbError?.toLowerCase().includes('context') ? 400
              : fbError?.toLowerCase().includes('timeout') ? 408
              : fbError?.toLowerCase().includes('500') || fbError?.toLowerCase().includes('server') ? 500
              : 400  // default to 400 for any non-empty unrecognized error string
            const type = classifyError(fbStatus, fbError)
            if (type === 'rate_limit') fbProfile.rateLimit++
            else if (type === 'context_limit') fbProfile.contextLimit++
            else if (type === 'timeout') fbProfile.timeout++
            else if (type === 'server_error') fbProfile.serverError++
            else fbProfile.other++
          }
        }
      }
    }

    // Compute rates and lowN flag
    const profiles = Object.values(modelMap)
      .map(p => ({
        ...p,
        errorRate: p.total > 0 ? (p.rateLimit + p.contextLimit + p.timeout + p.serverError + p.other) / p.total : 0,
        lowN: p.total < MIN_SAMPLE,
      }))
      .filter(p => p.total > 0)
      .sort((a, b) => (b.rateLimit + b.contextLimit + b.timeout + b.serverError + b.other) - (a.rateLimit + a.contextLimit + a.timeout + a.serverError + a.other))
      .slice(0, MAX_MODELS)

    return { profiles }
  }, [entries])

  const totalErrors = profiles.reduce((s, p) => s + p.rateLimit + p.contextLimit + p.timeout + p.serverError + p.other, 0)

  return (
    <div
      className="gs-panel"
      style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        animation: 'fade-in-up 400ms ease both',
        animationDelay: '950ms',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{
            fontSize: '9px', fontFamily: 'var(--font-mono)',
            color: 'var(--muted-foreground)', textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            Error Fingerprint
          </span>
          {totalErrors > 0 && (
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'hsl(0 72% 55%)', boxShadow: '0 0 6px hsl(0 72% 55%)', animation: 'pulse-dot 2s ease-in-out infinite' }} />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          {totalErrors > 0 ? (
            <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(0 72% 60%)', fontWeight: 600 }}>
              {totalErrors} errors
            </span>
          ) : (
            <span style={{ fontSize: '6px', fontFamily: 'var(--font-mono)', color: 'hsl(145 65% 55%)' }}>ALL CLEAN</span>
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0 0.1rem' }}>
        {(Object.entries(ERROR_TYPE_CONFIG) as [ErrorType, { label: string; color: string }][]).map(([type, cfg]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: cfg.color }} />
            <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>{cfg.label}</span>
          </div>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
          <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'hsl(145 65% 55%)' }} />
          <span style={{ fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 25%)' }}>OK</span>
        </div>
      </div>

      {/* Column headers */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', paddingBottom: '0.05rem', borderBottom: '1px solid hsl(225 45% 12%)' }}>
        <div style={{ width: 72, flexShrink: 0, fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)', letterSpacing: '0.06em' }}>MODEL</div>
        <div style={{ flex: 1, fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)', letterSpacing: '0.06em' }}>ERROR BREAKDOWN</div>
        <div style={{ width: 14, flexShrink: 0 }} />
        <div style={{ width: 24, flexShrink: 0, textAlign: 'right', fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)', letterSpacing: '0.06em' }}>N</div>
        <div style={{ width: 28, flexShrink: 0, textAlign: 'right', fontSize: '4.5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)', letterSpacing: '0.06em' }}>RATE</div>
      </div>

      {/* Rows */}
      {profiles.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
          <span style={{ fontSize: '8px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>NO ERROR DATA</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {profiles.map(p => (
            <ErrorFingerprintRow key={p.model} profile={p} />
          ))}
        </div>
      )}

      {/* Footer */}
      {profiles.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.05rem', borderTop: '1px solid hsl(225 45% 12%)' }}>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>
            top {profiles.length} models · fallback_chain errors attributed
          </span>
          <span style={{ fontSize: '5px', fontFamily: 'var(--font-mono)', color: 'hsl(225 45% 20%)' }}>n≥{MIN_SAMPLE} per model</span>
        </div>
      )}
    </div>
  )
}
