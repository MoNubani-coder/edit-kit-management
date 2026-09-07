import { Camera, ShieldCheck } from 'lucide-react'
import Link from 'next/link'

import { EmptyState } from '@/components/common/empty-state'
import { Pagination } from '@/components/common/pagination'
import { IssueSeverityBadge, IssueStatusBadge } from '@/components/common/status-badge'
import { formatDate } from '@/lib/datetime'
import { cn } from '@/lib/utils/cn'
import { ISSUE_TYPE_LABELS, type IssueListParams, type IssueSortKey, type IssueTypeValue } from '@/lib/validation/issues'
import type { IssueListResult } from '@/server/dal/issues.dal'

import { issuesHref } from '../hrefs'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-middle'
const Empty = () => <span className="text-subtle">—</span>

function SortHeader({ label, sortKey, params, className }: { label: string; sortKey: IssueSortKey; params: IssueListParams; className?: string }) {
  const active = params.sort === sortKey
  const next = active && params.dir === 'desc' ? 'asc' : 'desc'
  return (
    <th scope="col" className={cn(TH, className)} aria-sort={active ? (params.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Link href={issuesHref(params, { sort: sortKey, dir: next, page: 1 })} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        {active ? <span aria-hidden>{params.dir === 'asc' ? '↑' : '↓'}</span> : null}
      </Link>
    </th>
  )
}

/**
 * The issue list: what is wrong, with what, how badly, and who is on it.
 *
 * Ordered by severity or age as asked; the equipment column is the one most
 * people scan for, so it sits next to the title rather than at the end.
 */
export function IssuesTable({
  result,
  params,
  timeZone,
  filtered,
  canReport,
}: {
  result: IssueListResult
  params: IssueListParams
  timeZone: string
  filtered: boolean
  canReport: boolean
}) {
  return (
    <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
      {result.rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={filtered ? 'Nothing matches' : 'No issues'}
          description={
            filtered
              ? 'Try another filter or search. Closed issues are kept for good under All.'
              : 'Missing or damaged equipment recorded during a return appears here automatically.'
          }
          action={filtered ? { href: '/issues', label: 'Clear filters' } : canReport ? { href: '/issues/new', label: 'Report an issue' } : undefined}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-panel-header/60">
                <SortHeader label="Issue" sortKey="issueNumber" params={params} />
                <th scope="col" className={TH}>
                  Problem
                </th>
                <th scope="col" className={TH}>
                  Equipment
                </th>
                <SortHeader label="Severity" sortKey="severity" params={params} />
                <SortHeader label="Status" sortKey="status" params={params} />
                <th scope="col" className={cn(TH, 'hidden lg:table-cell')}>
                  Assigned to
                </th>
                <SortHeader label="Reported" sortKey="reportedAt" params={params} className="hidden md:table-cell" />
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id} className="border-t border-line transition-colors hover:bg-panel-header">
                  <td className={TD}>
                    <Link
                      href={`/issues/${row.id}`}
                      className="font-mono text-xs font-semibold text-accent-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    >
                      {row.issueNumber}
                    </Link>
                    {row.photoCount > 0 ? (
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-subtle">
                        <Camera aria-hidden className="h-3 w-3" />
                        {row.photoCount}
                      </span>
                    ) : null}
                  </td>
                  <td className={`${TD} max-w-[22rem]`}>
                    <Link href={`/issues/${row.id}`} className="block truncate font-medium text-foreground hover:underline">
                      {row.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted">
                      {ISSUE_TYPE_LABELS[row.type as IssueTypeValue]}
                      {row.bookingNumber ? <span className="font-mono"> · {row.bookingNumber}</span> : null}
                    </p>
                  </td>
                  <td className={TD}>
                    {row.assetCode ? (
                      <span className="block">
                        <span className="block font-mono text-xs font-semibold text-accent-foreground">{row.assetCode}</span>
                        {row.assetName ? <span className="block max-w-[14rem] truncate text-xs text-muted">{row.assetName}</span> : null}
                      </span>
                    ) : row.kitCode ? (
                      <span className="font-mono text-xs text-foreground">{row.kitCode}</span>
                    ) : (
                      <Empty />
                    )}
                  </td>
                  <td className={TD}>
                    <IssueSeverityBadge severity={row.severity} />
                  </td>
                  <td className={TD}>
                    <IssueStatusBadge status={row.status} />
                  </td>
                  <td className={`${TD} hidden text-foreground lg:table-cell`}>{row.assignedToName ?? <Empty />}</td>
                  <td className={`${TD} hidden whitespace-nowrap tabular-nums text-muted md:table-cell`}>{formatDate(row.reportedAt, timeZone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} hrefFor={(page) => issuesHref(params, { page })} />
    </div>
  )
}
