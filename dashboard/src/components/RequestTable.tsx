import { useI18n } from '@/i18n'
import type { LogEntry } from '@/hooks/useApi'

interface Props {
  entries: LogEntry[]
  total: number
  offset: number
  limit: number
  onPageChange: (newOffset: number) => void
}

function formatTime(ts: string) {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return ts
  }
}

function StatusBadge({ status }: { status: number }) {
  const cls =
    status === 200
      ? 'gs-badge gs-badge-success'
      : status >= 400 && status < 500
      ? 'gs-badge gs-badge-warning'
      : 'gs-badge gs-badge-error'
  return <span className={cls}>{status}</span>
}

export function RequestTable({ entries, total, offset, limit, onPageChange }: Props) {
  const { t } = useI18n()

  if (entries.length === 0 && total === 0) {
    return (
      <div className="gs-empty-state" style={{ margin: '1rem' }}>
        {t('table.noRequests')}
      </div>
    )
  }

  const currentPage = Math.floor(offset / limit) + 1
  const totalPages = Math.ceil(total / limit)

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('table.time')}</th>
              <th>{t('table.model')}</th>
              <th>{t('table.tier')}</th>
              <th>{t('table.rule')}</th>
              <th>{t('table.intent')}</th>
              <th>{t('table.request')}</th>
              <th style={{ textAlign: 'right' }}>{t('table.latency')}</th>
              <th style={{ textAlign: 'right' }}>{t('table.ttft')}</th>
              <th>{t('table.status')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.request_id}>
                {/* Time */}
                <td className="cell-mono" style={{ color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>
                  {formatTime(entry.timestamp)}
                </td>

                {/* Model */}
                <td>
                  <span className="cell-model">{entry.routed_model}</span>
                </td>

                {/* Tier */}
                <td>
                  <div className="flex flex-col gap-0.5">
                    <span className="gs-badge gs-badge-tier" style={{ alignSelf: 'flex-start' }}>
                      {entry.routed_tier}
                    </span>
                    {entry.selected_tier !== entry.routed_tier && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        ← {entry.selected_tier}
                      </span>
                    )}
                  </div>
                </td>

                {/* Rule */}
                <td>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {entry.matched_rule}
                    </span>
                    {entry.is_fallback && (
                      <span className="gs-badge gs-badge-warning" style={{ alignSelf: 'flex-start', fontSize: '9px' }}>
                        FALLBACK
                      </span>
                    )}
                  </div>
                </td>

                {/* Intent + Difficulty */}
                <td>
                  {entry.semantic_features?.intent ? (
                    <div className="intent-badge">
                      <span className="intent-name">{entry.semantic_features.intent}</span>
                      <span
                        className="difficulty-tag"
                        data-difficulty={entry.semantic_features.difficulty}
                      >
                        {entry.semantic_features.difficulty}
                      </span>
                    </div>
                  ) : entry.task_type ? (
                    <span className="gs-badge gs-badge-neutral" style={{ alignSelf: 'flex-start' }}>
                      {entry.task_type}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--muted-foreground)' }}>—</span>
                  )}
                </td>

                {/* Request preview */}
                <td className="cell-preview">
                  {entry.request_preview ? (
                    <span title={entry.request_preview}>{entry.request_preview}</span>
                  ) : (
                    <span style={{ color: 'var(--muted-foreground)' }}>—</span>
                  )}
                </td>

                {/* Latency */}
                <td style={{ textAlign: 'right' }}>
                  <span className="cell-mono" style={{ color: entry.latency_ms && entry.latency_ms > 5000 ? 'hsl(0 72% 50%)' : 'var(--foreground)' }}>
                    {entry.latency_ms != null ? `${entry.latency_ms}` : '—'}
                    <span style={{ fontSize: '9px', color: 'var(--muted-foreground)' }}>ms</span>
                  </span>
                </td>

                {/* TTFT */}
                <td style={{ textAlign: 'right' }}>
                  <span className="cell-mono" style={{ color: 'var(--muted-foreground)' }}>
                    {entry.ttft_ms != null ? `${entry.ttft_ms}` : '—'}
                    <span style={{ fontSize: '9px' }}>ms</span>
                  </span>
                </td>

                {/* Status */}
                <td>
                  <StatusBadge status={entry.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > limit && (
        <div className="table-pagination">
          <button
            onClick={() => onPageChange(Math.max(0, offset - limit))}
            disabled={currentPage === 1}
            className="pagination-btn"
          >
            ← {t('table.previous')}
          </button>
          <span className="pagination-info">
            {t('table.pageInfo', { current: currentPage, total: totalPages })}
            {' · '}
            {total.toLocaleString()} total
          </span>
          <button
            onClick={() => onPageChange(offset + limit)}
            disabled={currentPage >= totalPages}
            className="pagination-btn"
          >
            {t('table.next')} →
          </button>
        </div>
      )}
    </div>
  )
}
