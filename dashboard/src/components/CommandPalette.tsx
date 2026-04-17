import { useState, useEffect, useRef } from 'react'
import { useI18n } from '@/i18n'
import { LayoutDashboard, Database, Globe, Archive, ChevronRight } from 'lucide-react'

interface Command {
  id: string
  label: string
  icon: React.ReactNode
  action: () => void
  keywords: string[]
}

interface Props {
  onClose: () => void
  models: Record<string, unknown>
  onNav: (nav: string) => void
  onLocaleToggle: () => void
  onArchive: () => void
  locale: string
}

export function CommandPalette({ onClose, models, onNav, onLocaleToggle, onArchive, locale }: Props) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const baseCommands: Command[] = [
    { id: 'nav-overview', label: t('app.overview'), icon: <LayoutDashboard size={14} />, action: () => onNav('overview'), keywords: ['home', 'main'] },
    { id: 'nav-logs', label: t('app.allRequests'), icon: <Database size={14} />, action: () => onNav('logs'), keywords: ['requests', 'all'] },
    { id: 'nav-shadow', label: t('stats.shadowPolicy'), icon: <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>SP</span>, action: () => onNav('shadow-policy'), keywords: ['shadow', 'policy'] },
    { id: 'nav-analysis', label: t('analysis.title'), icon: <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>AI</span>, action: () => onNav('analysis'), keywords: ['analysis', 'ai'] },
    { id: 'locale', label: locale === 'en' ? '切换中文' : 'Switch to English', icon: <Globe size={14} />, action: onLocaleToggle, keywords: ['language', '语言', '中文', 'english'] },
    { id: 'refresh', label: t('stats.clearLogs'), icon: <Archive size={14} />, action: onArchive, keywords: ['archive', 'clear', 'log'] },
  ]

  const modelCommands: Command[] = Object.keys(models).map((m) => ({
    id: `model-${m}`,
    label: `${m}`,
    icon: <ChevronRight size={14} />,
    action: () => { onNav('logs'); /* model select handled separately */ },
    keywords: [m],
  }))

  const allCommands = [...baseCommands, ...modelCommands]

  const filtered = query.trim()
    ? allCommands.filter(
        (c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.keywords.some((k) => k.toLowerCase().includes(query.toLowerCase()))
      )
    : allCommands.slice(0, 8)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => { setSelected(0) }, [query])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
      if (e.key === 'Enter' && filtered[selected]) { filtered[selected].action(); onClose() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [filtered, selected, onClose])

  // scroll selected into view
  useEffect(() => {
    const el = listRef.current?.children[selected] as HTMLElement
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div className="cp-overlay" onClick={onClose}>
      <div className="cp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cp-search-row">
          <input
            ref={inputRef}
            className="cp-input"
            placeholder='Search commands...'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="cp-list" ref={listRef}>
          {filtered.length === 0 && (
            <div className="cp-empty">No commands found</div>
          )}
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              className={`cp-item ${i === selected ? 'cp-item--selected' : ''}`}
              onClick={() => { cmd.action(); onClose() }}
              onMouseEnter={() => setSelected(i)}
            >
              <span className="cp-icon">{cmd.icon}</span>
              <span className="cp-label">{cmd.label}</span>
              {cmd.id.startsWith('model-') && (
                <span className="cp-badge">model</span>
              )}
            </div>
          ))}
        </div>
        <div className="cp-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
