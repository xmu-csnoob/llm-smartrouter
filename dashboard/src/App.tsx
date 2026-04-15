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

  // All logs (for overview)
  const [allEntries, setAllEntries] = useState<LogEntry[]>([])
  const [totalAllEntries, setTotalAllEntries] = useState(0)
  const [currentAllPage, setCurrentAllPage] = useState(1)

  // Model-specific logs (for detail view)
  const [modelEntries, setModelEntries] = useState<LogEntry[]>([])
  const [totalModelEntries, setTotalModelEntries] = useState(0)
  const [currentModelPage, setCurrentModelPage] = useState(1)
  const pageSize = 20

  const selectedModelStats = useMemo(
    () => selectedModel && stats?.models[selectedModel]
      ? stats.models[selectedModel]
      : null,
    [stats, selectedModel],
  )

  // Load stats
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

  // Load all logs for overview
  useEffect(() => {
    const load = async () => {
      try {
        const offset = (currentAllPage - 1) * pageSize
        const response = await fetchRecent(offset, pageSize, null)
        setAllEntries(response.entries)
        setTotalAllEntries(response.total)
      } catch {}
    }
    load()
    const interval = setInterval(load, 10000)
    return () => clearInterval(interval)
  }, [currentAllPage])

  // Load model-specific logs for detail view
  useEffect(() => {
    if (!selectedModel) return
    const load = async () => {
      try {
        const offset = (currentModelPage - 1) * pageSize
        const response = await fetchRecent(offset, pageSize, selectedModel)
        setModelEntries(response.entries)
        setTotalModelEntries(response.total)
      } catch {}
    }
    load()
    const interval = setInterval(load, 10000)
    return () => clearInterval(interval)
  }, [selectedModel, currentModelPage])

  const handleModelSelect = (model: string) => {
    setSelectedModel(model)
    setCurrentModelPage(1)
    setModelEntries([])
    setTotalModelEntries(0)
  }

  const handleBack = () => {
    setSelectedModel(null)
    setModelEntries([])
    setTotalModelEntries(0)
  }

  const handleAllPageChange = (newOffset: number) => {
    setCurrentAllPage(Math.floor(newOffset / pageSize) + 1)
  }

  const handleModelPageChange = (newOffset: number) => {
    setCurrentModelPage(Math.floor(newOffset / pageSize) + 1)
  }

  return (
    <div className="min-h-screen p-4 md:p-6">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {selectedModel && (
            <button
              onClick={handleBack}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              ← {t('app.overview')}
            </button>
          )}
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
            {selectedModel ? (
              <span className="font-mono">{selectedModel}</span>
            ) : (
              t('app.title')
            )}
          </h1>
        </div>
        <button
          onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}
          className="px-3 py-1.5 text-sm font-medium border border-border rounded-md hover:bg-secondary transition-colors"
        >
          {locale === 'en' ? '中文' : 'EN'}
        </button>
      </header>

      {selectedModel ? (
        // Model Detail View
        <div className="space-y-[18px]">
          <StatsCards stats={stats} modelStats={selectedModelStats} />
          <div className="gs-panel">
            <div className="gs-panel-header">
              <span className="gs-eyebrow">{t('app.recentRequests')}</span>
            </div>
            <div className="gs-panel-body">
              <LatencyChart entries={modelEntries} />
            </div>
          </div>
          <div className="gs-panel">
            <div className="gs-panel-header">
              <span className="gs-eyebrow">{t('app.recentRequests')}</span>
            </div>
            <div className="gs-panel-body">
              <RequestTable
                entries={modelEntries}
                total={totalModelEntries}
                offset={(currentModelPage - 1) * pageSize}
                limit={pageSize}
                onPageChange={handleModelPageChange}
              />
            </div>
          </div>
        </div>
      ) : (
        // Overview
        <div className="space-y-[18px]">
          <StatsCards stats={stats} />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-[18px]">
            <div className="gs-panel">
              <div className="gs-panel-header">
                <span className="gs-eyebrow">Model Distribution</span>
              </div>
              <div className="gs-panel-body">
                <ModelChart stats={stats} onSliceClick={handleModelSelect} />
              </div>
            </div>

            <div className="gs-panel lg:col-span-2">
              <div className="gs-panel-header">
                <span className="gs-eyebrow">{t('analysis.title')}</span>
              </div>
              <div className="gs-panel-body">
                <AnalysisPanel />
              </div>
            </div>
          </div>

          {/* All Logs Table */}
          <div className="gs-panel">
            <div className="gs-panel-header">
              <span className="gs-eyebrow">{t('app.allRequests')}</span>
            </div>
            <div className="gs-panel-body">
              <RequestTable
                entries={allEntries}
                total={totalAllEntries}
                offset={(currentAllPage - 1) * pageSize}
                limit={pageSize}
                onPageChange={handleAllPageChange}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
