import { ArrowDown, ArrowUp, ArrowUpDown, Users } from 'lucide-react'
import Link from 'next/link'

import { EmptyState } from '@/components/common/empty-state'
import { Pagination } from '@/components/common/pagination'
import { BookingStatusBadge } from '@/components/common/status-badge'
import { formatDate, formatDateTime } from '@/lib/datetime'
import type { EditorListParams, EditorSortKey } from '@/lib/validation/editors'
import { cn } from '@/lib/utils/cn'
import type { EditorListResult } from '@/server/dal/editors.dal'

import { editorsHref } from '../hrefs'
import { EditorActiveBadge, EditorTypeBadge } from './editor-badges'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-middle'

function SortHeader({ label, sortKey, params, className }: { label: string; sortKey: EditorSortKey; params: EditorListParams; className?: string }) {
  const active = params.sort === sortKey
  const nextDir = active && params.dir === 'asc' ? 'desc' : 'asc'
  const Icon = active ? (params.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <th scope="col" className={cn(TH, className)} aria-sort={active ? (params.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Link
        href={editorsHref(params, { sort: sortKey, dir: nextDir })}
        className={cn('inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', active && 'text-accent-foreground')}
      >
        {label}
        <Icon aria-hidden className="h-3 w-3" />
      </Link>
    </th>
  )
}

const Empty = () => <span className="text-subtle">—</span>

export function EditorsTable({ result, params, timeZone, canManage }: { result: EditorListResult; params: EditorListParams; timeZone: string; canManage: boolean }) {
  const filtered = Boolean(params.q || params.view !== 'all')

  return (
    <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
      {result.rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={filtered ? 'No editors match' : 'No editors yet'}
          description={filtered ? 'Try another search term or another tab.' : canManage ? 'Add the first editor to start issuing kits.' : 'Editors will appear here once they have been added.'}
          action={filtered ? { href: '/editors', label: 'Clear filters' } : canManage ? { href: '/editors/new', label: 'New editor' } : undefined}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <SortHeader label="Editor" sortKey="fullName" params={params} />
                <SortHeader label="Staff ID" sortKey="staffId" params={params} />
                <th scope="col" className={TH}>Type</th>
                <th scope="col" className={cn(TH, 'hidden lg:table-cell')}>Contact</th>
                <th scope="col" className={cn(TH, 'hidden xl:table-cell')}>Email</th>
                <th scope="col" className={cn(TH, 'hidden lg:table-cell')}>Account</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={cn(TH, 'text-right')}>Active bookings</th>
                <th scope="col" className={cn(TH, 'hidden md:table-cell')}>Last booking</th>
                <SortHeader label="Updated" sortKey="updatedAt" params={params} className="hidden 2xl:table-cell" />
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id} className="border-t border-line transition-colors hover:bg-panel-header">
                  <td className={`${TD} max-w-[18rem]`}>
                    <Link href={`/editors/${row.id}`} className="block truncate font-medium text-foreground hover:underline">
                      {row.fullName}
                    </Link>
                    <p className="truncate text-xs text-muted">{row.isExternal ? row.company ?? 'External' : row.department ?? 'Internal'}</p>
                  </td>
                  <td className={`${TD} font-mono text-xs text-accent-foreground`}>{row.staffId ?? <Empty />}</td>
                  <td className={TD}>
                    <EditorTypeBadge isExternal={row.isExternal} />
                  </td>
                  <td className={`${TD} hidden whitespace-nowrap text-foreground lg:table-cell`}>{row.contactNumber ?? <Empty />}</td>
                  <td className={`${TD} hidden max-w-[14rem] truncate text-foreground xl:table-cell`}>{row.email ?? <Empty />}</td>
                  <td className={`${TD} hidden lg:table-cell`}>
                    {row.linkedUser ? (
                      <span className="text-foreground">
                        {row.linkedUser.name}
                        {row.linkedUser.status !== 'ACTIVE' ? <span className="ml-1 text-xs text-muted">({row.linkedUser.status.toLowerCase()})</span> : null}
                      </span>
                    ) : (
                      <span className="text-subtle">{row.isExternal ? 'No account' : 'Not linked'}</span>
                    )}
                  </td>
                  <td className={TD}>
                    <EditorActiveBadge isActive={row.isActive} />
                  </td>
                  <td className={`${TD} text-right tabular-nums text-foreground`}>
                    {row.activeBookingCount}
                    <span className="block text-[11px] text-subtle">{row.totalBookingCount} total</span>
                  </td>
                  <td className={`${TD} hidden md:table-cell`}>
                    {row.lastBooking ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-foreground">{row.lastBooking.kitCode}</span>
                        <span className="text-muted">{formatDate(row.lastBooking.bookingStart, timeZone)}</span>
                        <BookingStatusBadge status={row.lastBooking.status} />
                      </span>
                    ) : (
                      <span className="text-subtle">No bookings</span>
                    )}
                  </td>
                  <td className={`${TD} hidden whitespace-nowrap tabular-nums text-muted 2xl:table-cell`}>{formatDateTime(row.updatedAt, timeZone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} hrefFor={(page) => editorsHref(params, { page })} />
    </div>
  )
}
