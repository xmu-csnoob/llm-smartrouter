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

  useEffect(() => {
    const load = async () => {
      try {
        const s = await fetchStats()
        setStats(s)
      } catch {}
    }
    load()
    const interval = setInterval(load, 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!selectedModel) return
    const load = async () => {
      try {
        const offset = (currentPage - 1) * pageSize
        const response = await fetchRecent(offset, pageSize, selectedModel)
        setEntries(response.entries)
        setTotalEntries(response.total)
      } catch {}
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
    <>
      <div className="scanlines" />
      <div className="min-h-screen p-4 md:p-6">
        {/* Header */}
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            {selectedModel && (
              <button
                onClick={handleBack}
                className="btn-terminal text-muted-foreground hover:text-foreground"
              >
                ← {t('app.overview')}
              </button>
            )}
            <div className="flex items-center gap-3">
              <div className="status-dot online pulse-live" />
              <h1 className="text-xl md:text-2xl font-bold tracking-tight">
                {selectedModel ? (
                  <span className="font-mono text-lg">{selectedModel}</span>
                ) : (
                  <>
                    <span className="text-muted-foreground">LLM Router</span>{' '}
                    <span className="text-primary">Dashboard</span>
                  </>
                )}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}
              className="btn-terminal min-w-[60px]"
            >
              {locale === 'en' ? '中文' : 'EN'}
            </button>
          </div>
        </header>

        {selectedModel ? (
          // Model Detail View
          <div className="space-y-4">
            <StatsCards stats={stats} modelStats={selectedModelStats} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="hud-card rounded-lg p-4">
                <h3 className="label-text mb-4">Latency Trend</h3>
                <LatencyChart entries={entries} />
              </div>
            </div>
            <div className="hud-card rounded-lg p-4">
              <h3 className="label-text mb-3">{t('app.recentRequests')}</h3>
              <RequestTable
                entries={entries}
                total={totalEntries}
                offset={(currentPage - 1) * pageSize}
                limit={pageSize}
                onPageChange={handlePageChange}
              />
            </div>
          </div>
        ) : (
          // Overview
          <div className="space-y-4">
            <StatsCards stats={stats} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="hud-card rounded-lg p-4 lg:col-span-1">
                <h3 className="label-text mb-4">Model Distribution</h3>
                <ModelChart stats={stats} onSliceClick={handleModelSelect} />
              </div>

              <div className="hud-card rounded-lg p-4 lg:col-span-2">
                <AnalysisPanel />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default App
