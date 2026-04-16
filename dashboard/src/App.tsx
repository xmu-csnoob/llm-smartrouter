import { useEffect, useState } from 'react'
import { StatsCards } from './components/StatsCards'
import { ModelChart } from './components/ModelChart'
import { LatencyChart } from './components/LatencyChart'
import { AnalysisPanel } from './components/AnalysisPanel'
import { RequestTable } from './components/RequestTable'
import { TierTrafficFlow } from './components/TierTrafficFlow'
import { RoutingHealthBoard } from './components/RoutingHealthBoard'
import { RoutingDecisionDrawer } from './components/RoutingDecisionDrawer'
import { TierConfusionMatrix } from './components/TierConfusionMatrix'
import { ErrorBurstDetector } from './components/ErrorBurstDetector'
import { TokenEstimateHistogram } from './components/TokenEstimateHistogram'
import { TierHealthTimeline } from './components/TierHealthTimeline'
import { TrafficHeatmap } from './components/TrafficHeatmap'
import { TierRadar } from './components/TierRadar'
import { ShadowDiscrepancyFeed } from './components/ShadowDiscrepancyFeed'
import { IntentDriftTicker } from './components/IntentDriftTicker'
import { TierCapacityThermometer } from './components/TierCapacityThermometer'
import { CostAttributionMeter } from './components/CostAttributionMeter'
import { ModelHealthLeaderboard } from './components/ModelHealthLeaderboard'
import { IntentLatencyBreakdown } from './components/IntentLatencyBreakdown'
import { FallbackCascadeDiagram } from './components/FallbackCascadeDiagram'
import { RoutingAmbiguityIndicator } from './components/RoutingAmbiguityIndicator'
import { TierRoutingComparison } from './components/TierRoutingComparison'
import { RoutingErrorHotspotTable } from './components/RoutingErrorHotspotTable'
import { HourlyIntentComposition } from './components/HourlyIntentComposition'
import { RecentFallbackFeed } from './components/RecentFallbackFeed'
import { RoutingMethodDistribution } from './components/RoutingMethodDistribution'
import { ModelErrorFingerprint } from './components/ModelErrorFingerprint'
import { IntentTokenMatrix } from './components/IntentTokenMatrix'
import { RequestStreamLiveTicker } from './components/RequestStreamLiveTicker'
import { RoutingConfidenceTimeline } from './components/RoutingConfidenceTimeline'
import { OutcomeHeatmap } from './components/OutcomeHeatmap'
import { QualityGuardMonitor } from './components/QualityGuardMonitor'
import { TierSelectionStability } from './components/TierSelectionStability'
import { ModelRoutingDelta } from './components/ModelRoutingDelta'
import { StatusCodeDistribution } from './components/StatusCodeDistribution'
import { TokenConsumptionPanel } from './components/TokenConsumptionPanel'
import { ConversationLengthPanel } from './components/ConversationLengthPanel'
import { TierConstraintMonitor } from './components/TierConstraintMonitor'
import { TierLoadBalancer } from './components/TierLoadBalancer'
import { ErrorPatternPanel } from './components/ErrorPatternPanel'
import { ProviderHealthPanel } from './components/ProviderHealthPanel'
import { TTFTSpikeDetector } from './components/TTFTSpikeDetector'
import { StreamingThroughputGauge } from './components/StreamingThroughputGauge'
import { ModelWarmthIndicator } from './components/ModelWarmthIndicator'
import { RequestComplexityScore } from './components/RequestComplexityScore'
import { TokenSaturationPanel } from './components/TokenSaturationPanel'
import { TierEfficiencyMatrix } from './components/TierEfficiencyMatrix'
import { CostPerOutcomePanel } from './components/CostPerOutcomePanel'
import { StreamingIncidentDetector } from './components/StreamingIncidentDetector'
import { OutputTruncationRiskAdvisor } from './components/OutputTruncationRiskAdvisor'
import { RoutingRegressionDetector } from './components/RoutingRegressionDetector'
import { LatencyJitterDetector } from './components/LatencyJitterDetector'
import { fetchRecent, fetchStats, archiveLogs, type LogEntry, type Stats } from './hooks/useApi'
import { ShadowPolicyPanel } from './components/ShadowPolicyPanel'
import { useI18n } from './i18n'
import { LayoutDashboard, Database, Archive, Globe, Radio } from 'lucide-react'
import { GSPanel } from './components/GSPanel'
import { CommandPalette } from './components/CommandPalette'

function Clock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.375rem 0.625rem', fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted-foreground)' }}>
      <Radio size={8} style={{ color: 'var(--primary)', animation: 'pulse-dot 2.5s ease-in-out infinite' }} />
      <span>{time.getFullYear()}-{pad(time.getMonth()+1)}-{pad(time.getDate())}</span>
      <span style={{ color: 'var(--primary)', marginLeft: '0.25rem' }}>{pad(time.getHours())}:{pad(time.getMinutes())}:{pad(time.getSeconds())}</span>
    </div>
  )
}

type NavView = 'overview' | 'logs' | 'shadow-policy' | 'analysis'

function App() {
  const { t, locale, setLocale } = useI18n()
  const [nav, setNav] = useState<NavView>('overview')
  const [stats, setStats] = useState<Stats | null>(null)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [fullscreenPanel, setFullscreenPanel] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null)

  // ESC to exit fullscreen
  useEffect(() => {
    if (!fullscreenPanel) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreenPanel(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fullscreenPanel])

  // Cmd+K to open command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

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
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          models={stats?.models ?? {}}
          onNav={(nav) => { setNav(nav as NavView); handleBack() }}
          onLocaleToggle={() => setLocale(locale === 'en' ? 'zh' : 'en')}
          onArchive={handleArchive}
          locale={locale}
        />
      )}
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
            className={`sidebar-nav-item ${nav === 'logs' && !selectedModel ? 'active' : ''}`}
            onClick={() => { setNav('logs'); handleBack(); }}
          >
            <Database className="nav-icon" size={16} />
            {t('app.allRequests')}
          </button>
          <button
            className={`sidebar-nav-item ${nav === 'shadow-policy' && !selectedModel ? 'active' : ''}`}
            onClick={() => { setNav('shadow-policy'); handleBack(); }}
          >
            <span className="nav-icon" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>SP</span>
            {t('stats.shadowPolicy')}
          </button>
          <button
            className={`sidebar-nav-item ${nav === 'analysis' && !selectedModel ? 'active' : ''}`}
            onClick={() => { setNav('analysis'); handleBack(); }}
          >
            <span className="nav-icon" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>AI</span>
            {t('analysis.title')}
          </button>
          <button
            className="sidebar-nav-item"
            onClick={handleArchive}
          >
            <Archive className="nav-icon" size={16} />
            {t('stats.clearLogs')}
          </button>
        </nav>

        <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <Clock />
          <button
            onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}
            className="lang-toggle"
            style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Globe size={10} />
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
                onRowClick={setSelectedEntry}
              />
            </div>
          </div>
        ) : nav === 'shadow-policy' ? (
          /* ── Shadow Policy View ── */
          <div className="app-content">
            <header className="app-header">
              <div className="flex items-center gap-3">
                <button className="back-btn" onClick={() => setNav('overview')}>← {t('app.overview')}</button>
                <h1 className="text-lg font-semibold tracking-tight" style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, letterSpacing: '-0.02em' }}>{t('stats.shadowPolicy')}</h1>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={refreshAll} style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 600, borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--muted-foreground)', cursor: 'pointer', transition: 'all 150ms', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <span style={{ fontSize: '0.875rem' }}>↻</span> Refresh
                </button>
              </div>
            </header>
            <StatsCards stats={stats} onRefresh={refreshAll} />
            <GSPanel panelId="sp-full" title={t('stats.shadowPolicy')} fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel} style={{ flex: 1 }}>
              <ShadowPolicyPanel stats={stats} />
            </GSPanel>
          </div>
        ) : nav === 'analysis' ? (
          /* ── Analysis View ── */
          <div className="app-content">
            <header className="app-header">
              <div className="flex items-center gap-3">
                <button className="back-btn" onClick={() => setNav('overview')}>← {t('app.overview')}</button>
                <h1 className="text-lg font-semibold tracking-tight" style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, letterSpacing: '-0.02em' }}>{t('analysis.title')}</h1>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={refreshAll} style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 600, borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--muted-foreground)', cursor: 'pointer', transition: 'all 150ms', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <span style={{ fontSize: '0.875rem' }}>↻</span> Refresh
                </button>
              </div>
            </header>
            <GSPanel panelId="analysis-full" title={t('analysis.title')} fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel} style={{ flex: 1 }}>
              <AnalysisPanel />
            </GSPanel>
            <div className="analysis-grid">
              <IntentDriftTicker stats={stats} />
              <TierCapacityThermometer stats={stats} />
              <CostAttributionMeter stats={stats} />
              <ModelHealthLeaderboard stats={stats} />
              <IntentLatencyBreakdown stats={stats} />
              <FallbackCascadeDiagram entries={allEntries} />
              <RoutingAmbiguityIndicator entries={allEntries} />
              <TierRoutingComparison entries={allEntries} />
              <RoutingErrorHotspotTable entries={allEntries} />
              <HourlyIntentComposition entries={allEntries} />
              <RecentFallbackFeed entries={allEntries} />
              <RoutingConfidenceTimeline entries={allEntries} />
              <OutcomeHeatmap entries={allEntries} />
              <QualityGuardMonitor entries={allEntries} />
              <TierSelectionStability entries={allEntries} />
              <ModelRoutingDelta entries={allEntries} />
              <StatusCodeDistribution entries={allEntries} />
              <TokenConsumptionPanel entries={allEntries} />
              <ConversationLengthPanel entries={allEntries} />
              <TierConstraintMonitor entries={allEntries} />
              <TierLoadBalancer entries={allEntries} />
              <ErrorPatternPanel entries={allEntries} />
              <ProviderHealthPanel entries={allEntries} />
              <TTFTSpikeDetector entries={allEntries} />
              <StreamingThroughputGauge entries={allEntries} />
              <ModelWarmthIndicator entries={allEntries} />
              <RequestComplexityScore entries={allEntries} />
              <TokenSaturationPanel entries={allEntries} />
              <TierEfficiencyMatrix entries={allEntries} />
              <CostPerOutcomePanel entries={allEntries} />
              <StreamingIncidentDetector entries={allEntries} />
              <OutputTruncationRiskAdvisor entries={allEntries} />
              <RoutingRegressionDetector entries={allEntries} />
              <LatencyJitterDetector entries={allEntries} />
              <RoutingMethodDistribution entries={allEntries} />
              <ModelErrorFingerprint entries={allEntries} />
              <IntentTokenMatrix entries={allEntries} />
              <GSPanel panelId="shadow-discrepancy" title="Shadow Discrepancy Feed" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <ShadowDiscrepancyFeed entries={allEntries} />
              </GSPanel>
              <GSPanel panelId="tier-confusion" title="Tier Confusion Matrix" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <TierConfusionMatrix entries={allEntries} />
              </GSPanel>
              <GSPanel panelId="tier-traffic" title="Tier Traffic Flow" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <TierTrafficFlow stats={stats} />
              </GSPanel>
              <GSPanel panelId="error-burst" title="Error Monitor" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <ErrorBurstDetector entries={allEntries} />
              </GSPanel>
              <GSPanel panelId="health-board" title="Routing Health" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <RoutingHealthBoard stats={stats} />
              </GSPanel>
              <GSPanel panelId="token-histogram" title="Token Distribution" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <TokenEstimateHistogram entries={allEntries} />
              </GSPanel>
              <GSPanel panelId="health-timeline" title="Model Health Timeline" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <TierHealthTimeline entries={allEntries} />
              </GSPanel>
              <GSPanel panelId="traffic-heatmap" title="Traffic Heatmap" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <TrafficHeatmap entries={allEntries} />
              </GSPanel>
              <GSPanel panelId="tier-radar" title="Tier Metrics Radar" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <TierRadar entries={allEntries} />
              </GSPanel>
            </div>
          </div>
        ) : (
          /* ── Overview / Logs View ── */
          <>
            <header className="app-header">
              <div className="flex items-center gap-3">
                {nav === 'logs' && (
                  <button className="back-btn" onClick={() => setNav('overview')}>← {t('app.overview')}</button>
                )}
                <h1 className="text-lg font-semibold tracking-tight" style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, letterSpacing: '-0.02em' }}>
                  {nav === 'overview' ? t('app.title') : t('app.allRequests')}
                </h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginLeft: '0.5rem', padding: '0.2rem 0.625rem', background: 'hsl(145 65% 45% / 0.1)', border: '1px solid hsl(145 65% 45% / 0.25)', borderRadius: '4px', fontFamily: 'var(--font-mono)', fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.1em', color: 'hsl(145 65% 60%)' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'hsl(145 65% 55%)', boxShadow: '0 0 6px hsl(145 65% 55%)', animation: 'pulse-dot 2.5s ease-in-out infinite', display: 'inline-block' }} />
                  NOMINAL
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={refreshAll} style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 600, borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--muted-foreground)', cursor: 'pointer', transition: 'all 150ms', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <span style={{ fontSize: '0.875rem' }}>↻</span> Refresh
                </button>
              </div>
            </header>

            <div className="app-content">
              {/* Stats Row */}
              <StatsCards stats={stats} onRefresh={refreshAll} />

              {nav === 'overview' ? (
                /* ── Overview: 2-column clean grid ── */
                <div className="middle-grid">
                  <GSPanel panelId="model" title={t('chart.modelDistribution')} fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel} className="distribution-panel">
                    <ModelChart stats={stats} onSliceClick={handleModelSelect} />
                  </GSPanel>

                  <GSPanel panelId="latency" title={t('chart.latencyTrend')} fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                    <div className="latency-chart-container">
                      <LatencyChart entries={allEntries} />
                    </div>
                  </GSPanel>
                </div>
              ) : null}

              {/* Live request stream ticker — only in overview */}
              {nav === 'overview' && <RequestStreamLiveTicker entries={allEntries} />}

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
                  onRowClick={setSelectedEntry}
                />
              </div>
            </div>
          </>
        )}
      </main>

      <RoutingDecisionDrawer
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
      />
    </div>
  )
}

export default App
