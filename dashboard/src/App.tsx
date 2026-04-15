import { useEffect, useState } from 'react'
import { StatsCards } from './components/StatsCards'
import { RequestTable } from './components/RequestTable'
import { ModelChart } from './components/ModelChart'
import { LatencyChart } from './components/LatencyChart'
import { fetchRecent, fetchStats, type LogEntry, type Stats } from './hooks/useApi'

function App() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const [e, s] = await Promise.all([fetchRecent(100), fetchStats()])
        setEntries(e)
        setStats(s)
      } catch {
        // backend not available yet
      }
    }
    load()
    const interval = setInterval(load, 10000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="min-h-screen bg-background p-6">
      <h1 className="text-2xl font-bold mb-6">LLM Router Dashboard</h1>
      <StatsCards stats={stats} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <ModelChart stats={stats} />
        <LatencyChart entries={entries} />
      </div>
      <div className="mt-6">
        <h2 className="text-lg font-semibold mb-3">Recent Requests</h2>
        <RequestTable entries={entries} />
      </div>
    </div>
  )
}

export default App
