import { useEffect, useMemo, useState } from 'react'
import { StatsCards } from './components/StatsCards'
import { RequestTable } from './components/RequestTable'
import { ModelChart } from './components/ModelChart'
import { LatencyChart } from './components/LatencyChart'
import { AnalysisPanel } from './components/AnalysisPanel'
import { fetchRecent, fetchStats, type LogEntry, type Stats } from './hooks/useApi'
import { useI18n } from './i18n'

function App() {
  const { t, locale, setLocale } = useI18n()
  const [stats, setStats] = useState<Stats | null>(null)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)

  // Model detail state
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [totalEntries, setTotalEntries] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 20

  const selectedModelStats = useMemo(
    () => selectedModel && stats?.models[selectedModel]
      ? stats.models[selectedModel]
      : null,
    [stats, selectedModel],
  )

  // Load global stats
  useEffect(() => {
    const load = async () => {
      try {
        const s = await fetchStats()
        setStats(s)
      } catch {
        // backend not available yet
      }
    }
    load()
    const interval = setInterval(load, 10000)
    return () => clearInterval(interval)
  }, [])

  // Load model-specific entries when in model detail
  useEffect(() => {
    if (!selectedModel) return
    const load = async () => {
      try {
        const offset = (currentPage - 1) * pageSize
        const response = await fetchRecent(offset, pageSize, selectedModel)
        setEntries(response.entries)
        setTotalEntries(response.total)
      } catch {
        // backend not available yet
      }
    }
    load()
    const interval = setInterval(load, 10000)
    return () => clearInterval(interval)
  }, [selectedModel, currentPage])

  const handleModelSelect = (model: string) => {
    setSelectedModel(model)
    setCurrentPage(1)
    setEntries([])
    setTotalEntries(0)
  }

  const handleBack = () => {
    setSelectedModel(null)
    setEntries([])
    setTotalEntries(0)
  }

  const handlePageChange = (newOffset: number) => {
    setCurrentPage(Math.floor(newOffset / pageSize) + 1)
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {selectedModel && (
            <button
              onClick={handleBack}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium ring-offset-background hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              ← {t('app.overview')}
            </button>
          )}
          <h1 className="text-2xl font-bold">
            {selectedModel ? selectedModel : t('app.title')}
          </h1>
        </div>
        <button
          onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium ring-offset-background hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          {locale === 'en' ? '中文' : 'EN'}
        </button>
      </div>

      {selectedModel ? (
        // === Model Detail View ===
        <>
          <StatsCards stats={stats} modelStats={selectedModelStats} />
          <div className="mt-6">
            <LatencyChart entries={entries} />
          </div>
          <div className="mt-6">
            <h2 className="text-lg font-semibold mb-3">{t('app.recentRequests')}</h2>
            <RequestTable
              entries={entries}
              total={totalEntries}
              offset={(currentPage - 1) * pageSize}
              limit={pageSize}
              onPageChange={handlePageChange}
            />
          </div>
        </>
      ) : (
        // === Overview ===
        <>
          <StatsCards stats={stats} />
          <div className="mt-6">
            <ModelChart stats={stats} onSliceClick={handleModelSelect} />
          </div>
          <div className="mt-6">
            <AnalysisPanel />
          </div>
        </>
      )}
    </div>
  )
}

export default App
