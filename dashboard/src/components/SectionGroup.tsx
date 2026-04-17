import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

interface SectionGroupProps {
  title: string
  badge?: string
  defaultExpanded?: boolean
  children: ReactNode
}

export function SectionGroup({ title, badge, defaultExpanded = true, children }: SectionGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className="section-group">
      <div className="section-group-header" onClick={() => setExpanded((v) => !v)}>
        <div className={`section-group-toggle ${expanded ? 'expanded' : ''}`}>
          <ChevronRight size={10} />
        </div>
        <span className="section-group-title">{title}</span>
        {badge && <span className="section-group-badge">{badge}</span>}
      </div>
      <div className={`section-group-body ${expanded ? '' : 'collapsed'}`}>
        {children}
      </div>
    </div>
  )
}
