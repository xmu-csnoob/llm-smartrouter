import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { analyzeLogs } from '@/hooks/useApi'
import { useI18n } from '@/i18n'

export function AnalysisPanel() {
  const { t, locale } = useI18n()
  const [hours, setHours] = useState(24)
  const [analysis, setAnalysis] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const timeRanges = [
    { label: '1h', value: 1 },
    { label: '6h', value: 6 },
    { label: '24h', value: 24 },
  ]

  const handleAnalyze = async () => {
    setLoading(true)
    setAnalysis('')
    setError(null)

    try {
      await analyzeLogs(hours, locale, (text) => {
        setAnalysis(prev => prev + text)
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('analysis.failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-3">
        <span className="gs-eyebrow">{t('analysis.title')}</span>
        <div className="flex items-center gap-2">
          {timeRanges.map(range => (
            <button
              key={range.value}
              onClick={() => setHours(range.value)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                hours === range.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              {range.label}
            </button>
          ))}
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? t('analysis.analyzing') : t('analysis.analyze')}
          </button>
        </div>
      </div>

      {error && (
        <div className="gs-empty-state text-destructive mb-3">
          {error}
        </div>
      )}

      {analysis ? (
        <div className="prose prose-sm max-w-none
          prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-foreground
          prose-p:text-muted-foreground prose-p:text-sm prose-p:leading-relaxed
          prose-strong:text-foreground prose-semantic-strong:text-foreground
          prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:rounded prose-code:py-0.5 prose-code:font-mono
          prose-li:text-muted-foreground prose-li:text-sm
          prose-a:text-primary no-underline hover:underline">
          <ReactMarkdown>{analysis}</ReactMarkdown>
        </div>
      ) : (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
          {loading ? t('analysis.analyzingLogs') : t('analysis.placeholder')}
        </div>
      )}
    </div>
  )
}
