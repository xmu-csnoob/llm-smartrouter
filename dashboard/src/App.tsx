import { useEffect, useState } from 'react'
import { StatsCards } from './components/StatsCards'
import { ModelChart } from './components/ModelChart'
import { LatencyChart } from './components/LatencyChart'
import { AnalysisPanel } from './components/AnalysisPanel'
import { RequestTable } from './components/RequestTable'
import { KeyStatsTable } from './components/KeyStatsTable'
import { fetchRecent, fetchStats, archiveLogs, fetchKeyStats, type LogEntry, type Stats, type KeyStatsResponse } from './hooks/useApi'
import { useI18n } from './i18n'
import { LayoutDashboard, Database, Archive, Globe, Key } from 'lucide-react'

type NavView = 'overview' | 'logs' | 'keys'

function App() {
  const { t, locale, setLocale } = useI18n()
  const [nav, setNav] = useState<NavView>('overview')
  const [stats, setStats] = useState<Stats | null>(null)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [keyStats, setKeyStats] = useState<KeyStatsResponse | null>(null)

  // All logs (for overview & logs tab)
  const [allEntries, setAllEntries] = useState<LogEntry[]>([])
  const [totalAllEntries, setTotalAllEntries] = useState(0)
  const [currentAllPage, setCurrentAllPage] = useState(1)

  // Model-specific logs
  const [modelEntries, setModelEntries] = useState<LogEntry[]>([])
  const [totalModelEntries, setTotalModelEntries] = useState(0)
  const [currentModelPage, setCurrentModelPage] = useState(1)
  const pageSize = 25

  const selectedModelStats = selectedModel && stats?.models[selectedModel]
    ? stats.models[selectedModel]
    : null

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

  // Load all logs
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

  // Load model-specific logs
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

  // Load key stats
  useEffect(() => {
    const load = async () => {
      try {
        const ks = await fetchKeyStats()
        setKeyStats(ks)
      } catch {}
    }
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [])

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

  const refreshAll = async () => {
    try {
      const s = await fetchStats()
      setStats(s)
    } catch {}
    try {
      const offset = (currentAllPage - 1) * pageSize
      const response = await fetchRecent(offset, pageSize, null)
      setAllEntries(response.entries)
      setTotalAllEntries(response.total)
    } catch {}
  }

  const handleArchive = async () => {
    if (!window.confirm(t('stats.clearLogsConfirm'))) return
    try {
      const result = await archiveLogs()
      if (result.total_archived > 0) {
        await refreshAll()
      }
    } catch {}
  }

  return (
    <div className="app-shell">
      {/* ── Sidebar ── */}
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xs font-mono">LR</span>
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight leading-none">LLM Router</div>
              <div className="text-[10px] text-muted-foreground font-mono mt-0.5">v2.0</div>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`sidebar-nav-item ${nav === 'overview' && !selectedModel ? 'active' : ''}`}
            onClick={() => { setNav('overview'); handleBack(); }}
          >
            <LayoutDashboard className="nav-icon" size={16} />
            {t('app.overview')}
          </button>
          <button
            className={`sidebar-nav-item ${nav === 'logs' ? 'active' : ''}`}
            onClick={() => { setNav('logs'); handleBack(); }}
          >
            <Database className="nav-icon" size={16} />
            {t('app.allRequests')}
          </button>
          <button
            className={`sidebar-nav-item ${nav === 'keys' ? 'active' : ''}`}
            onClick={() => { setNav('keys'); handleBack(); }}
          >
            <Key className="nav-icon" size={16} />
            {t('app.apiKeys')}
          </button>
          <button
            className="sidebar-nav-item"
            onClick={handleArchive}
          >
            <Archive className="nav-icon" size={16} />
            {t('stats.clearLogs')}
          </button>
        </nav>

        <div className="sidebar-footer">
          <button
            onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}
            className="lang-toggle"
          >
            <Globe size={12} style={{ display: 'inline', marginRight: '4px' }} />
            {locale === 'en' ? '中文' : 'EN'}
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="app-main">
        {selectedModel ? (
          /* ── Model Detail View ── */
          <div className="app-content">
            <div className="model-detail-header">
              <button className="back-btn" onClick={handleBack}>
                ← {t('app.overview')}
              </button>
              <span className="model-name-badge">{selectedModel}</span>
            </div>

            {selectedModelStats && (
              <div className="model-stats-row">
                <div className="model-mini-stat">
                  <span>Requests:</span>
                  <strong>{selectedModelStats.count.toLocaleString()}</strong>
                </div>
                <div className="model-mini-stat">
                  <span>Avg Latency:</span>
                  <strong>{selectedModelStats.avg_latency_ms}ms</strong>
                </div>
                {selectedModelStats.avg_ttft_ms != null && (
                  <div className="model-mini-stat">
                    <span>Avg TTFT:</span>
                    <strong>{selectedModelStats.avg_ttft_ms}ms</strong>
                  </div>
                )}
                <div className="model-mini-stat">
                  <span>Errors:</span>
                  <strong>{selectedModelStats.errors}</strong>
                </div>
              </div>
            )}

            <div className="gs-panel">
              <div className="gs-panel-header">
                <span className="gs-eyebrow">{t('chart.latencyTrend')}</span>
              </div>
              <div className="gs-panel-body latency-chart-container">
                <LatencyChart entries={modelEntries} />
              </div>
            </div>

            <div className="gs-panel request-table-panel">
              <div className="gs-panel-header">
                <span className="gs-eyebrow">{t('app.recentRequests')}</span>
              </div>
              <RequestTable
                entries={modelEntries}
                total={totalModelEntries}
                offset={(currentModelPage - 1) * pageSize}
                limit={pageSize}
                onPageChange={handleModelPageChange}
              />
            </div>
          </div>
        ) : (
          /* ── Overview / Logs View ── */
          <>
            <header className="app-header">
              <div className="flex items-center gap-3">
                {nav !== 'overview' && (
                  <button className="back-btn" onClick={() => setNav('overview')}>
                    ← {t('app.overview')}
                  </button>
                )}
                <h1 className="text-lg font-semibold tracking-tight">
                  {nav === 'overview' ? t('app.title') : nav === 'logs' ? t('app.allRequests') : nav === 'keys' ? t('app.apiKeys') : t('app.title')}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={refreshAll}
                  className="px-2.5 py-1 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
                >
                  ↻ Refresh
                </button>
              </div>
            </header>

            <div className="app-content">
              {nav === 'keys' ? (
                /* ── API Keys View ── */
                <div className="gs-panel">
                  <div className="gs-panel-header">
                    <span className="gs-eyebrow">{t('app.apiKeys')}</span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {keyStats ? `${Object.keys(keyStats.keys).length} keys` : '...'}
                    </span>
                  </div>
                  <div className="gs-panel-body">
                    {keyStats && (
                      <KeyStatsTable
                        keys={keyStats.keys}
                        onKeyClick={() => { setNav('logs'); /* TODO: filter RequestTable by selected key once fetchRecent supports ?key= filter */ }}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {/* Stats Row */}
                  <StatsCards stats={stats} onRefresh={refreshAll} />

                  {nav === 'overview' ? (
                    /* ── Overview: 3-column middle grid ── */
                    <div className="middle-grid">
                      {/* Model Distribution */}
                      <div className="gs-panel distribution-panel">
                        <div className="gs-panel-header">
                          <span className="gs-eyebrow">{t('chart.modelDistribution')}</span>
                        </div>
                        <div className="gs-panel-body">
                          <ModelChart stats={stats} onSliceClick={handleModelSelect} />
                        </div>
                      </div>

                      {/* Latency Trend */}
                      <div className="gs-panel">
                        <div className="gs-panel-header">
                          <span className="gs-eyebrow">{t('chart.latencyTrend')}</span>
                        </div>
                        <div className="gs-panel-body latency-chart-container">
                          <LatencyChart entries={allEntries} />
                        </div>
                      </div>

                      {/* Analysis Panel */}
                      <div className="gs-panel">
                        <div className="gs-panel-header">
                          <span className="gs-eyebrow">{t('analysis.title')}</span>
                        </div>
                        <div className="gs-panel-body">
                          <AnalysisPanel />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* All Requests Table */}
                  <div className="gs-panel request-table-panel">
                    <div className="gs-panel-header">
                      <span className="gs-eyebrow">
                        {nav === 'overview' ? t('app.recentRequests') : t('app.allRequests')}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {totalAllEntries.toLocaleString()} total
                      </span>
                    </div>
                    <RequestTable
                      entries={allEntries}
                      total={totalAllEntries}
                      offset={(currentAllPage - 1) * pageSize}
                      limit={pageSize}
                      onPageChange={handleAllPageChange}
                    />
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default App
