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
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [totalEntries, setTotalEntries] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const pageSize = 20

  const availableModels = useMemo(
    () => stats ? Object.keys(stats.models) : [],
    [stats],
  )

  const selectedModelStats = useMemo(
    () => selectedModel && stats?.models[selectedModel]
      ? stats.models[selectedModel]
      : null,
    [stats, selectedModel],
  )

  const loadEntries = async (page: number) => {
    try {
      const offset = (page - 1) * pageSize
      const response = await fetchRecent(offset, pageSize, selectedModel)
      setEntries(response.entries)
      setTotalEntries(response.total)
    } catch {
      // backend not available yet
    }
  }

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
    loadEntries(currentPage)
    const interval = setInterval(() => {
      load()
      loadEntries(currentPage)
    }, 10000)
    return () => clearInterval(interval)
  }, [currentPage, selectedModel])

  const handlePageChange = (newOffset: number) => {
    const newPage = Math.floor(newOffset / pageSize) + 1
    setCurrentPage(newPage)
  }

  const handleModelChange = (value: string) => {
    setSelectedModel(value || null)
    setCurrentPage(1)
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('app.title')}</h1>
        <div className="flex items-center gap-3">
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as 'en' | 'zh')}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
          <select
            value={selectedModel ?? ''}
            onChange={(e) => handleModelChange(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">{t('app.allModels')}</option>
            {availableModels.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>
      <StatsCards stats={stats} modelStats={selectedModelStats} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <ModelChart stats={stats} selectedModel={selectedModel} />
        <LatencyChart entries={entries} />
      </div>
      <div className="mt-6">
        <AnalysisPanel />
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
    </div>
  )
}

export default App
