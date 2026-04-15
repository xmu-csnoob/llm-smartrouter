import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
    return new Date(ts).toLocaleTimeString()
  } catch {
    return ts
  }
}

function statusBadge(status: number): string {
  if (status === 200) return 'gs-badge gs-badge-success'
  if (status >= 400 && status < 500) return 'gs-badge gs-badge-warning'
  return 'gs-badge gs-badge-error'
}

export function RequestTable({ entries, total, offset, limit, onPageChange }: Props) {
  const { t } = useI18n()

  if (entries.length === 0 && total === 0) {
    return (
      <div className="gs-empty-state">
        {t('table.noRequests')}
      </div>
    )
  }

  const currentPage = Math.floor(offset / limit) + 1
  const totalPages = Math.ceil(total / limit)

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('table.time')}</TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('table.model')}</TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('table.tier')}</TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('table.rule')}</TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">{t('table.latency')}</TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">{t('table.ttft')}</TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('table.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.request_id}>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {formatTime(entry.timestamp)}
              </TableCell>
              <TableCell className="font-mono text-xs">{entry.routed_model}</TableCell>
              <TableCell>
                <span className="font-mono text-xs text-muted-foreground">
                  {entry.routed_tier}
                </span>
              </TableCell>
              <TableCell>
                <span className="text-xs text-muted-foreground">{entry.matched_rule}</span>
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {entry.latency_ms != null ? `${entry.latency_ms}` : '—'}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {entry.ttft_ms != null ? `${entry.ttft_ms}` : '—'}
              </TableCell>
              <TableCell>
                <span className={statusBadge(entry.status)}>
                  {entry.status}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {total > limit && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
          <button
            onClick={() => onPageChange(offset - limit)}
            disabled={currentPage === 1}
            className="px-2.5 py-1 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← {t('table.previous')}
          </button>
          <span className="text-xs text-muted-foreground">
            {t('table.pageInfo', { current: currentPage, total: totalPages })}
          </span>
          <button
            onClick={() => onPageChange(offset + limit)}
            disabled={currentPage >= totalPages}
            className="px-2.5 py-1 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('table.next')} →
          </button>
        </div>
      )}
    </div>
  )
}
