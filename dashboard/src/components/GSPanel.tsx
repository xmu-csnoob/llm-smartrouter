import type { ReactNode } from 'react'
import { Maximize2 } from 'lucide-react'

interface Props {
  panelId: string
  title: ReactNode
  children: ReactNode
  fullscreenPanel: string | null
  onFullscreen: (id: string | null) => void
  className?: string
  style?: React.CSSProperties
}

export function GSPanel({ panelId, title, children, fullscreenPanel, onFullscreen, className = '', style }: Props) {
  const isFullscreen = fullscreenPanel === panelId

  if (isFullscreen) {
    return (
      <div className="gs-panel-overlay" onClick={() => onFullscreen(null)}>
        <div
          className={`gs-panel gs-panel--fullscreen ${className}`}
          style={style}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="gs-panel-header">
            <span className="gs-eyebrow">{title}</span>
            <button
              className="panel-fullscreen-btn"
              onClick={() => onFullscreen(null)}
              title="Exit fullscreen (ESC)"
            >
              <Maximize2 size={10} />
            </button>
          </div>
          <div className="gs-panel-body">{children}</div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`gs-panel ${className}`}
      style={style}
      onDoubleClick={() => onFullscreen(panelId)}
    >
      <div className="gs-panel-header">
        <span className="gs-eyebrow">{title}</span>
        <button
          className="panel-fullscreen-btn"
          onClick={(e) => { e.stopPropagation(); onFullscreen(panelId) }}
          title="Fullscreen"
        >
          <Maximize2 size={10} />
        </button>
      </div>
      <div className="gs-panel-body">{children}</div>
    </div>
  )
}
