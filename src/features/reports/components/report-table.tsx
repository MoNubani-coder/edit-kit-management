import Link from 'next/link'
import { FileSpreadsheet, TableProperties } from 'lucide-react'

import { EmptyState } from '@/components/common/empty-state'
import { Pagination } from '@/components/common/pagination'
import { BookingStatusBadge, humanizeStatus, IssueSeverityBadge, KitStatusBadge } from '@/components/common/status-badge'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { cn } from '@/lib/utils/cn'
import type { ReportQuery } from '@/server/reports/filters'
import { reportHref } from '@/server/reports/filters'
import type { CellValue, ColumnDef, ReportResult, ReportRow } from '@/server/reports/types'

const TH = 'whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-3 py-2.5 align-middle'

const LINK_BASE: Record<NonNullable<ColumnDef['linkTo']>, string> = {
  booking: '/bookings',
  kit: '/kits',
  asset: '/assets',
  issue: '/issues',
  editor: '/editors',
}

/** One cell, rendered by the column's declared kind rather than by guesswork. */
function Cell({ value, column, timeZone, row }: { value: CellValue | undefined; column: ColumnDef; timeZone: string; row: ReportRow }) {
  if (value === null || value === undefined || value === '') return <span className="text-subtle">—</span>

  if (value instanceof Date) {
    return <span className="whitespace-nowrap tabular-nums">{column.kind === 'date' ? formatDate(value, timeZone) : formatDateTime(value, timeZone)}</span>
  }

  if (typeof value === 'boolean') {
    return value ? <Badge tone="amber">Yes</Badge> : <span className="text-subtle">No</span>
  }

  if (typeof value === 'number') {
    return <span className="tabular-nums">{value.toLocaleString('en-GB')}</span>
  }

  if (column.kind === 'severity') return <IssueSeverityBadge severity={value as never} />

  if (column.kind === 'status') {
    // Booking and kit statuses have their own badges; anything else is a word.
    if (['DRAFT', 'RESERVED', 'READY_FOR_HANDOVER', 'CHECKED_OUT', 'OVERDUE', 'RETURN_INSPECTION', 'COMPLETED', 'CANCELLED'].includes(value)) {
      return <BookingStatusBadge status={value as never} />
    }
    if (['AVAILABLE', 'MAINTENANCE', 'DAMAGED', 'RETIRED', 'MISSING'].includes(value)) return <KitStatusBadge status={value as never} />
    return <span className="capitalize">{humanizeStatus(value)}</span>
  }

  const text = column.kind === 'code' ? <span className="font-mono text-[12px]">{value}</span> : <span>{value}</span>

  if (column.linkTo && row.id) {
    return (
      <Link href={`${LINK_BASE[column.linkTo]}/${row.id}`} className="font-medium text-accent-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
        {text}
      </Link>
    )
  }
  return text
}

/**
 * The HTML renderer over the report shape (AD-5).
 *
 * It knows nothing about any particular report: the columns tell it what to
 * draw and how, so a new report needs no changes here, and the CSV export of
 * the same page carries exactly the same columns.
 */
export function ReportTable({
  reportId,
  result,
  query,
  timeZone,
  csvHref,
}: {
  reportId: string
  result: ReportResult
  query: ReportQuery
  timeZone: string
  csvHref: string
}) {
  return (
    <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel-header px-5 py-3">
        <p className="flex items-center gap-2 text-sm text-foreground">
          <TableProperties aria-hidden className="h-4 w-4 text-accent-foreground" />
          {result.summary}
        </p>
        <Link href={csvHref} prefetch={false} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          <FileSpreadsheet aria-hidden className="h-4 w-4" />
          Export CSV
        </Link>
      </header>

      {result.rows.length === 0 ? (
        <EmptyState icon={TableProperties} title="Nothing to show" description="No records match the filters. Widen the dates or clear the filters." action={{ href: `/reports/${reportId}`, label: 'Clear filters' }} />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-panel-header/60">
                {result.columns.map((column) => (
                  <th key={column.key} scope="col" className={cn(TH, column.numeric && 'text-right', column.secondary && 'hidden lg:table-cell')}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, index) => (
                <tr key={`${row.id ?? 'row'}:${index}`} className="border-t border-line transition-colors hover:bg-panel-header">
                  {result.columns.map((column) => (
                    <td key={column.key} className={cn(TD, column.numeric && 'text-right', column.secondary && 'hidden lg:table-cell')}>
                      <Cell value={row[column.key]} column={column} timeZone={timeZone} row={row} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
        hrefFor={(page) => reportHref(reportId, query, { page })}
      />
    </div>
  )
}
