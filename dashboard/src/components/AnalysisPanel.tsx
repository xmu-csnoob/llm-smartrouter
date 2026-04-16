import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { analyzeLogs } from '@/hooks/useApi'
import { useI18n } from '@/i18n'
import { Sparkles } from 'lucide-react'

export function AnalysisPanel() {
  const { t, locale } = useI18n()
  const [hours, setHours] = useState(24)
  const [analysis, setAnalysis] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAnalyze = async () => {
    setLoading(true)
    setAnalysis('')
    setError(null)

    try {
      await analyzeLogs(hours, locale, (text) => {
        setAnalysis((prev) => prev + text)
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('analysis.failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="analysis-controls">
          {[1, 6, 24].map((h) => (
            <button
              key={h}
              onClick={() => setHours(h)}
              className={`time-btn ${hours === h ? 'active' : ''}`}
            >
              {h}h
            </button>
          ))}
        </div>
        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="analyze-btn"
        >
          {loading ? (
            <span className="flex items-center gap-1.5">
              <span className="animate-spin" style={{ fontSize: '10px' }}>◌</span>
              {t('analysis.analyzing')}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Sparkles size={12} />
              {t('analysis.analyze')}
            </span>
          )}
        </button>
      </div>

      {error && (
        <div className="gs-empty-state text-destructive mb-3" style={{ textAlign: 'left', padding: '0.5rem 0.75rem' }}>
          {error}
        </div>
      )}

      {analysis ? (
        <div
          className="analysis-body prose prose-sm max-w-none"
          style={{
            '--tw-prose-body': 'var(--muted-foreground)',
            '--tw-prose-headings': 'var(--foreground)',
            '--tw-prose-strong': 'var(--foreground)',
            '--tw-prose-code': 'var(--foreground)',
            '--tw-prose-links': 'hsl(25 95% 55%)',
          } as React.CSSProperties}
        >
          <ReactMarkdown>{analysis}</ReactMarkdown>
        </div>
      ) : (
        <div className="analysis-placeholder">
          {loading ? t('analysis.analyzingLogs') : t('analysis.placeholder')}
        </div>
      )}
    </div>
  )
}
