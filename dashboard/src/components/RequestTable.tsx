import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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

function statusVariant(status: number) {
  if (status === 200) return 'default' as const
  if (status >= 400 && status < 500) return 'outline' as const
  return 'destructive' as const
}

function tierColor(tier: string) {
  switch (tier) {
    case 'tier1': return 'default' as const
    case 'tier2': return 'secondary' as const
    default: return 'outline' as const
  }
}

export function RequestTable({ entries, total, offset, limit, onPageChange }: Props) {
  if (entries.length === 0 && total === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No requests logged yet
      </div>
    )
  }

  const currentPage = Math.floor(offset / limit) + 1
  const totalPages = Math.ceil(total / limit)

  return (
    <div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead className="text-right">Latency</TableHead>
              <TableHead className="text-right">TTFT</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.request_id}>
                <TableCell className="font-mono text-xs">
                  {formatTime(entry.timestamp)}
                </TableCell>
                <TableCell className="font-medium">{entry.routed_model}</TableCell>
                <TableCell>
                  <Badge variant={tierColor(entry.routed_tier)}>{entry.routed_tier}</Badge>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">{entry.matched_rule}</span>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {entry.latency_ms != null ? `${entry.latency_ms}ms` : '—'}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {entry.ttft_ms != null ? `${entry.ttft_ms}ms` : '—'}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(entry.status)}>{entry.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {total > limit && (
        <div className="flex items-center justify-between mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(offset - limit)}
            disabled={currentPage === 1}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(offset + limit)}
            disabled={currentPage >= totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
