import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t('analysis.title')}</CardTitle>
          <div className="flex items-center gap-2">
            {timeRanges.map(range => (
              <Button
                key={range.value}
                variant={hours === range.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setHours(range.value)}
              >
                {range.label}
              </Button>
            ))}
            <Button
              size="sm"
              onClick={handleAnalyze}
              disabled={loading}
            >
              {loading ? t('analysis.analyzing') : t('analysis.analyze')}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="text-sm text-destructive mb-3">{error}</div>
        )}
        {analysis ? (
          <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
            <ReactMarkdown>{analysis}</ReactMarkdown>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {loading ? t('analysis.analyzingLogs') : t('analysis.placeholder')}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
