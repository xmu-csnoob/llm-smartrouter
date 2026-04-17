import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
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
import { RoutingMethodQualityPanel } from './components/RoutingMethodQualityPanel'
import { RecursiveDepthMonitor } from './components/RecursiveDepthMonitor'
import { TierFloorBreachPanel } from './components/TierFloorBreachPanel'
import { SemanticSignalBarStrip } from './components/SemanticSignalBarStrip'
import { ModelErrorFingerprint } from './components/ModelErrorFingerprint'
import { IntentTokenMatrix } from './components/IntentTokenMatrix'
import { RecentActivityStrip } from './components/RecentActivityStrip'
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
import { RequestComplexityScore } from './components/RequestComplexityScore'
import { TokenSaturationPanel } from './components/TokenSaturationPanel'
import { TierEfficiencyMatrix } from './components/TierEfficiencyMatrix'
import { CostPerOutcomePanel } from './components/CostPerOutcomePanel'
import { StreamingIncidentDetector } from './components/StreamingIncidentDetector'
import { OutputTruncationRiskAdvisor } from './components/OutputTruncationRiskAdvisor'
import { RoutingRegressionDetector } from './components/RoutingRegressionDetector'
import { LatencyJitterDetector } from './components/LatencyJitterDetector'
import { TokenEstimateDriftAnalyzer } from './components/TokenEstimateDriftAnalyzer'
import { ProviderRateLimitTracker } from './components/ProviderRateLimitTracker'
import { AmbientStatusBeaconStrip } from './components/AmbientStatusBeaconStrip'
import { AlertCorrelationMatrix } from './components/AlertCorrelationMatrix'
import { IntentDifficultyCorrelationMatrix } from './components/IntentDifficultyCorrelationMatrix'
import { MLFeatureAttributionMatrix } from './components/MLFeatureAttributionMatrix'
import { RoutingRuleLeaderboard } from './components/RoutingRuleLeaderboard'
import { TierRoutingFlowDiagram } from './components/TierRoutingFlowDiagram'
import { ErrorMessageCluster } from './components/ErrorMessageCluster'
import { IntentFlowMonitor } from './components/IntentFlowMonitor'
import { RoutingEntropyPanel } from './components/RoutingEntropyPanel'
import { fetchRecent, fetchStats, archiveLogs, type LogEntry, type Stats } from './hooks/useApi'
import { ShadowPolicyPanel } from './components/ShadowPolicyPanel'
import { FallbackChainExplorer } from './components/FallbackChainExplorer'
import { DifficultyHeatmapPanel } from './components/DifficultyHeatmapPanel'
import { useI18n } from './i18n'
import { LayoutDashboard, Database, Archive, Globe, Radio } from 'lucide-react'
import { GSPanel } from './components/GSPanel'
import { CommandPalette } from './components/CommandPalette'
import { SectionGroup } from './components/SectionGroup'

// ── shallowEqual for React.memo custom comparators ──
function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false
  const keysA = Object.keys(a as object)
  const keysB = Object.keys(b as object)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false
  }
  return true
}

// ── Memoized analysis components ──
const MemoAlertCorrelationMatrix = React.memo(AlertCorrelationMatrix, shallowEqual)
const MemoIntentFlowMonitor = React.memo(IntentFlowMonitor, shallowEqual)
const MemoTierConfusionMatrix = React.memo(TierConfusionMatrix, shallowEqual)
const MemoLatencyJitterDetector = React.memo(LatencyJitterDetector, shallowEqual)
const MemoTrafficHeatmap = React.memo(TrafficHeatmap, shallowEqual)
const MemoHourlyIntentComposition = React.memo(HourlyIntentComposition, shallowEqual)
const MemoRoutingHealthBoard = React.memo(RoutingHealthBoard, shallowEqual)
const MemoRoutingRegressionDetector = React.memo(RoutingRegressionDetector, shallowEqual)
const MemoTokenEstimateDriftAnalyzer = React.memo(TokenEstimateDriftAnalyzer, shallowEqual)
const MemoTierRoutingComparison = React.memo(TierRoutingComparison, shallowEqual)
const MemoShadowDiscrepancyFeed = React.memo(ShadowDiscrepancyFeed, shallowEqual)
const MemoRoutingMethodQualityPanel = React.memo(RoutingMethodQualityPanel, shallowEqual)
const MemoTierLoadBalancer = React.memo(TierLoadBalancer, shallowEqual)
const MemoCostPerOutcomePanel = React.memo(CostPerOutcomePanel, shallowEqual)
const MemoTokenConsumptionPanel = React.memo(TokenConsumptionPanel, shallowEqual)
const MemoTokenSaturationPanel = React.memo(TokenSaturationPanel, shallowEqual)
const MemoStatusCodeDistribution = React.memo(StatusCodeDistribution, shallowEqual)
const MemoProviderHealthPanel = React.memo(ProviderHealthPanel, shallowEqual)
const MemoTTFTSpikeDetector = React.memo(TTFTSpikeDetector, shallowEqual)
const MemoStreamingThroughputGauge = React.memo(StreamingThroughputGauge, shallowEqual)
const MemoIntentLatencyBreakdown = React.memo(IntentLatencyBreakdown, shallowEqual)
const MemoDifficultyHeatmapPanel = React.memo(DifficultyHeatmapPanel, shallowEqual)
const MemoRequestComplexityScore = React.memo(RequestComplexityScore, shallowEqual)
const MemoOutcomeHeatmap = React.memo(OutcomeHeatmap, shallowEqual)
const MemoSemanticSignalBarStrip = React.memo(SemanticSignalBarStrip, shallowEqual)
const MemoTokenEstimateHistogram = React.memo(TokenEstimateHistogram, shallowEqual)
const MemoTierHealthTimeline = React.memo(TierHealthTimeline, shallowEqual)
const MemoTierRadar = React.memo(TierRadar, shallowEqual)
const MemoTierEfficiencyMatrix = React.memo(TierEfficiencyMatrix, shallowEqual)
const MemoIntentTokenMatrix = React.memo(IntentTokenMatrix, shallowEqual)
const MemoModelErrorFingerprint = React.memo(ModelErrorFingerprint, shallowEqual)
const MemoIntentDriftTicker = React.memo(IntentDriftTicker, shallowEqual)
const MemoTierCapacityThermometer = React.memo(TierCapacityThermometer, shallowEqual)
const MemoCostAttributionMeter = React.memo(CostAttributionMeter, shallowEqual)
const MemoModelHealthLeaderboard = React.memo(ModelHealthLeaderboard, shallowEqual)
const MemoFallbackCascadeDiagram = React.memo(FallbackCascadeDiagram, shallowEqual)
const MemoRoutingAmbiguityIndicator = React.memo(RoutingAmbiguityIndicator, shallowEqual)
const MemoRoutingErrorHotspotTable = React.memo(RoutingErrorHotspotTable, shallowEqual)
const MemoRoutingConfidenceTimeline = React.memo(RoutingConfidenceTimeline, shallowEqual)
const MemoQualityGuardMonitor = React.memo(QualityGuardMonitor, shallowEqual)
const MemoTierSelectionStability = React.memo(TierSelectionStability, shallowEqual)
const MemoModelRoutingDelta = React.memo(ModelRoutingDelta, shallowEqual)
const MemoConversationLengthPanel = React.memo(ConversationLengthPanel, shallowEqual)
const MemoTierConstraintMonitor = React.memo(TierConstraintMonitor, shallowEqual)
const MemoErrorPatternPanel = React.memo(ErrorPatternPanel, shallowEqual)
const MemoStreamingIncidentDetector = React.memo(StreamingIncidentDetector, shallowEqual)
const MemoOutputTruncationRiskAdvisor = React.memo(OutputTruncationRiskAdvisor, shallowEqual)
const MemoProviderRateLimitTracker = React.memo(ProviderRateLimitTracker, shallowEqual)
const MemoIntentDifficultyCorrelationMatrix = React.memo(IntentDifficultyCorrelationMatrix, shallowEqual)
const MemoMLFeatureAttributionMatrix = React.memo(MLFeatureAttributionMatrix, shallowEqual)
const MemoRoutingRuleLeaderboard = React.memo(RoutingRuleLeaderboard, shallowEqual)
const MemoErrorMessageCluster = React.memo(ErrorMessageCluster, shallowEqual)
const MemoRoutingEntropyPanel = React.memo(RoutingEntropyPanel, shallowEqual)
const MemoFallbackChainExplorer = React.memo(FallbackChainExplorer, shallowEqual)
const MemoRoutingMethodDistribution = React.memo(RoutingMethodDistribution, shallowEqual)
const MemoRecursiveDepthMonitor = React.memo(RecursiveDepthMonitor, shallowEqual)
const MemoTierFloorBreachPanel = React.memo(TierFloorBreachPanel, shallowEqual)
const MemoTierRoutingFlowDiagram = React.memo(TierRoutingFlowDiagram, shallowEqual)
const MemoRecentFallbackFeed = React.memo(RecentFallbackFeed, shallowEqual)
const MemoErrorBurstDetector = React.memo(ErrorBurstDetector, shallowEqual)

function Clock() {
  const timeRef = useRef<HTMLSpanElement>(null)
  const dateRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const pad = (n: number) => String(n).padStart(2, '0')
    const update = () => {
      const now = new Date()
      if (dateRef.current) dateRef.current.textContent = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
      if (timeRef.current) timeRef.current.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.375rem 0.625rem', fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted-foreground)' }}>
      <Radio size={8} style={{ color: 'var(--primary)', animation: 'pulse-dot 2.5s ease-in-out infinite' }} />
      <span ref={dateRef} />
      <span ref={timeRef} style={{ color: 'var(--primary)', marginLeft: '0.25rem' }} />
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

  // Grouped entry data — prevent allEntries prop changes from propagating to every child
  const overviewEntries = useMemo(() => allEntries.slice(0, 5), [allEntries])
  const tableEntries = useMemo(() => allEntries, [allEntries])

  // Load stats — staggered start at 0ms
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

  // Load all logs — staggered start at 3300ms
  useEffect(() => {
    const load = async () => {
      try {
        const offset = (currentAllPage - 1) * pageSize
        const response = await fetchRecent(offset, pageSize, null)
        setAllEntries(response.entries)
        setTotalAllEntries(response.total)
      } catch {}
    }
    const id = setTimeout(load, 3300)
    const interval = setInterval(load, 10000)
    return () => { clearTimeout(id); clearInterval(interval) }
  }, [currentAllPage])

  // Load model-specific logs — staggered start at 6600ms
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
    const id = setTimeout(load, 6600)
    const interval = setInterval(load, 10000)
    return () => { clearTimeout(id); clearInterval(interval) }
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

  const refreshAll = useCallback(async () => {
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
  }, [currentAllPage])

  // Debounced version for manual refresh
  const debouncedRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleDebouncedRefresh = useCallback(() => {
    if (debouncedRefreshRef.current) clearTimeout(debouncedRefreshRef.current)
    debouncedRefreshRef.current = setTimeout(() => refreshAll(), 300)
  }, [refreshAll])

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
                <button onClick={handleDebouncedRefresh} style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 600, borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--muted-foreground)', cursor: 'pointer', transition: 'all 150ms', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <span style={{ fontSize: '0.875rem' }}>↻</span> Refresh
                </button>
              </div>
            </header>
            <StatsCards stats={stats} onRefresh={handleDebouncedRefresh} />
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
                <button onClick={handleDebouncedRefresh} style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 600, borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--muted-foreground)', cursor: 'pointer', transition: 'all 150ms', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <span style={{ fontSize: '0.875rem' }}>↻</span> Refresh
                </button>
              </div>
            </header>
            <GSPanel panelId="analysis-full" title={t('analysis.title')} fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel} style={{ flex: 1 }}>
              <AnalysisPanel />
            </GSPanel>

            {/* ── Section 1: ALERTS & ANOMALIES ── */}
            <SectionGroup title="Alerts & Anomalies" badge="5 panels" defaultExpanded={true}>
              <GSPanel panelId="routing-regression" title="Routing Regression" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <MemoRoutingRegressionDetector entries={allEntries} />
              </GSPanel>
              <GSPanel panelId="alert-correlation" title="Alert Correlation" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <MemoAlertCorrelationMatrix entries={allEntries} />
              </GSPanel>
              <MemoErrorBurstDetector entries={allEntries} />
              <MemoLatencyJitterDetector entries={allEntries} />
              <MemoTokenEstimateDriftAnalyzer entries={allEntries} />
            </SectionGroup>

            {/* ── Section 2: ROUTING INTELLIGENCE ── */}
            <SectionGroup title="Routing Intelligence" badge="5 panels" defaultExpanded={true}>
              <GSPanel panelId="tier-confusion" title="Tier Confusion Matrix" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <MemoTierConfusionMatrix entries={allEntries} />
              </GSPanel>
              <GSPanel panelId="tier-routing-comp" title="Tier Routing Comparison" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <MemoTierRoutingComparison entries={allEntries} />
              </GSPanel>
              <GSPanel panelId="health-board" title="Routing Health" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <MemoRoutingHealthBoard stats={stats} />
              </GSPanel>
              <GSPanel panelId="shadow-discrepancy" title="Shadow Discrepancy Feed" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <MemoShadowDiscrepancyFeed entries={allEntries} />
              </GSPanel>
              <MemoRoutingMethodQualityPanel entries={allEntries} />
            </SectionGroup>

            {/* ── Section 3: TRAFFIC & EFFICIENCY ── */}
            <SectionGroup title="Traffic & Efficiency" badge="10 panels" defaultExpanded={false}>
              <GSPanel panelId="traffic-heatmap" title="Traffic Heatmap" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <MemoTrafficHeatmap entries={allEntries} />
              </GSPanel>
              <GSPanel panelId="tier-traffic" title="Tier Traffic Flow" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <TierTrafficFlow stats={stats} />
              </GSPanel>
              <MemoTierLoadBalancer entries={allEntries} />
              <MemoCostPerOutcomePanel entries={allEntries} />
              <MemoTokenConsumptionPanel entries={allEntries} />
              <MemoTokenSaturationPanel entries={allEntries} />
              <MemoStatusCodeDistribution entries={allEntries} />
              <MemoProviderHealthPanel entries={allEntries} />
              <MemoTTFTSpikeDetector entries={allEntries} />
              <MemoStreamingThroughputGauge entries={allEntries} />
            </SectionGroup>

            {/* ── Section 4: INTENT & QUALITY ── */}
            <SectionGroup title="Intent & Quality" badge="12 panels" defaultExpanded={false}>
              <GSPanel panelId="intent-flow" title="Intent Flow Monitor" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <MemoIntentFlowMonitor entries={allEntries} />
              </GSPanel>
              <MemoIntentLatencyBreakdown stats={stats} />
              <MemoDifficultyHeatmapPanel entries={allEntries} />
              <MemoRequestComplexityScore entries={allEntries} />
              <MemoOutcomeHeatmap entries={allEntries} />
              <MemoSemanticSignalBarStrip entries={allEntries} />
              <MemoTokenEstimateHistogram entries={allEntries} />
              <MemoTierHealthTimeline entries={allEntries} />
              <MemoTierRadar entries={allEntries} />
              <MemoTierEfficiencyMatrix entries={allEntries} />
              <MemoIntentTokenMatrix entries={allEntries} />
              <MemoModelErrorFingerprint entries={allEntries} />
            </SectionGroup>

            {/* ── Section 5: OPERATIONAL METRICS ── */}
            <SectionGroup title="Operational Metrics" badge="26 panels" defaultExpanded={false}>
              <MemoIntentDriftTicker stats={stats} />
              <MemoTierCapacityThermometer stats={stats} />
              <MemoCostAttributionMeter stats={stats} />
              <MemoModelHealthLeaderboard stats={stats} />
              <MemoFallbackCascadeDiagram entries={allEntries} />
              <MemoRoutingAmbiguityIndicator entries={allEntries} />
              <MemoRoutingErrorHotspotTable entries={allEntries} />
              <MemoHourlyIntentComposition entries={allEntries} />
              <MemoRecentFallbackFeed entries={allEntries} />
              <MemoRoutingConfidenceTimeline entries={allEntries} />
              <MemoQualityGuardMonitor entries={allEntries} />
              <MemoTierSelectionStability entries={allEntries} />
              <MemoModelRoutingDelta entries={allEntries} />
              <MemoConversationLengthPanel entries={allEntries} />
              <MemoTierConstraintMonitor entries={allEntries} />
              <MemoErrorPatternPanel entries={allEntries} />
              <MemoStreamingIncidentDetector entries={allEntries} />
              <MemoOutputTruncationRiskAdvisor entries={allEntries} />
              <MemoProviderRateLimitTracker entries={allEntries} />
              <MemoIntentDifficultyCorrelationMatrix entries={allEntries} />
              <MemoMLFeatureAttributionMatrix entries={allEntries} />
              <MemoRoutingRuleLeaderboard entries={allEntries} />
              <MemoErrorMessageCluster entries={allEntries} />
              <MemoRoutingEntropyPanel entries={allEntries} />
              <MemoFallbackChainExplorer entries={allEntries} />
              <MemoRoutingMethodDistribution entries={allEntries} />
              <MemoRecursiveDepthMonitor entries={allEntries} />
              <MemoTierFloorBreachPanel entries={allEntries} />
              <GSPanel panelId="tier-routing-flow" title="Tier Routing Flow" fullscreenPanel={fullscreenPanel} onFullscreen={setFullscreenPanel}>
                <MemoTierRoutingFlowDiagram entries={allEntries} />
              </GSPanel>
              <MemoTierRoutingComparison entries={allEntries} />
            </SectionGroup>
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
                <button onClick={handleDebouncedRefresh} style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 600, borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--muted-foreground)', cursor: 'pointer', transition: 'all 150ms', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <span style={{ fontSize: '0.875rem' }}>↻</span> Refresh
                </button>
              </div>
            </header>

            <div className="app-content">
              {nav === 'overview' && <AmbientStatusBeaconStrip entries={overviewEntries} />}
              {/* Stats Row */}
              <StatsCards stats={stats} onRefresh={handleDebouncedRefresh} />

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

              {/* Recent Activity Strip — compact feed, replaces live ticker */}
              {nav === 'overview' && <RecentActivityStrip entries={allEntries} />}

              {/* All Requests Table */}
              {nav === 'overview' ? (
                <div className="gs-panel request-table-panel">
                  <div className="gs-panel-header">
                    <span className="gs-eyebrow">{t('app.recentRequests')}</span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {Math.min(5, allEntries.length)} of {totalAllEntries.toLocaleString()} recent
                    </span>
                  </div>
                  <RequestTable
                    entries={overviewEntries}
                    total={5}
                    offset={0}
                    limit={5}
                    onPageChange={() => {}}
                    onRowClick={setSelectedEntry}
                  />
                </div>
              ) : (
                <div className="gs-panel request-table-panel">
                  <div className="gs-panel-header">
                    <span className="gs-eyebrow">{t('app.allRequests')}</span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {totalAllEntries.toLocaleString()} total
                    </span>
                  </div>
                  <RequestTable
                    entries={tableEntries}
                    total={totalAllEntries}
                    offset={(currentAllPage - 1) * pageSize}
                    limit={pageSize}
                    onPageChange={handleAllPageChange}
                    onRowClick={setSelectedEntry}
                  />
                </div>
              )}
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
