import { useEffect, useState } from 'react'
import { StatsCards } from './components/StatsCards'
import { RequestTable } from './components/RequestTable'
import { ModelChart } from './components/ModelChart'
import { LatencyChart } from './components/LatencyChart'
import { AnalysisPanel } from './components/AnalysisPanel'
import { fetchRecent, fetchStats, type LogEntry, type Stats } from './hooks/useApi'

function App() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [totalEntries, setTotalEntries] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 20

  const loadEntries = async (page: number) => {
    try {
      const offset = (page - 1) * pageSize
      const response = await fetchRecent(offset, pageSize)
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
  }, [currentPage])

  const handlePageChange = (newOffset: number) => {
    const newPage = Math.floor(newOffset / pageSize) + 1
    setCurrentPage(newPage)
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <h1 className="text-2xl font-bold mb-6">LLM Router Dashboard</h1>
      <StatsCards stats={stats} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <ModelChart stats={stats} />
        <LatencyChart entries={entries} />
      </div>
      <div className="mt-6">
        <AnalysisPanel />
      </div>
      <div className="mt-6">
        <h2 className="text-lg font-semibold mb-3">Recent Requests</h2>
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
