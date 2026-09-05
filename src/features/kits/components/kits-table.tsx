import { ArrowDown, ArrowUp, ArrowUpDown, Boxes } from 'lucide-react'
import Link from 'next/link'

import { EmptyState } from '@/components/common/empty-state'
import { Pagination } from '@/components/common/pagination'
import { BookingStatusBadge, KitStatusBadge } from '@/components/common/status-badge'
import { formatDate, formatDateTime } from '@/lib/datetime'
import type { KitListParams, KitSortKey } from '@/lib/validation/kits'
import { cn } from '@/lib/utils/cn'
import type { KitListResult } from '@/server/dal/kits.dal'
import type { KitListRow } from '@/server/services/kits.service'

import { kitsHref } from '../hrefs'
import { KitAvailabilityBadge } from './availability-badge'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-middle'

function SortHeader({ label, sortKey, params, className }: { label: string; sortKey: KitSortKey; params: KitListParams; className?: string }) {
  const active = params.sort === sortKey
  const nextDir = active && params.dir === 'asc' ? 'desc' : 'asc'
  const Icon = active ? (params.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown

  return (
    <th scope="col" className={cn(TH, className)} aria-sort={active ? (params.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Link
        href={kitsHref(params, { sort: sortKey, dir: nextDir })}
        className={cn('inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', active && 'text-accent-foreground')}
      >
        {label}
        <Icon aria-hidden className="h-3 w-3" />
      </Link>
    </th>
  )
}

const Empty = () => <span className="text-subtle">—</span>

export function KitsTable({
  result,
  params,
  timeZone,
  canManage,
}: {
  result: KitListResult<KitListRow>
  params: KitListParams
  timeZone: string
  canManage: boolean
}) {
  const filtered = Boolean(params.q || params.view !== 'all')

  return (
    <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
      {result.rows.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={filtered ? 'No kits match' : 'No kits yet'}
          description={
            filtered
              ? 'Try another search term or another status tab.'
              : canManage
                ? 'Create the first kit, then add equipment to it from the inventory.'
                : 'Kits will appear here once they have been created.'
          }
          action={filtered ? { href: '/kits', label: 'Clear filters' } : canManage ? { href: '/kits/new', label: 'New kit' } : undefined}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <SortHeader label="Kit code" sortKey="kitCode" params={params} />
                <SortHeader label="Kit" sortKey="name" params={params} />
                <SortHeader label="Status" sortKey="status" params={params} />
                <th scope="col" className={cn(TH, 'text-right')}>Equipment</th>
                <th scope="col" className={TH}>Availability</th>
                <th scope="col" className={cn(TH, 'hidden lg:table-cell')}>Current editor</th>
                <th scope="col" className={cn(TH, 'hidden lg:table-cell')}>Booking</th>
                <th scope="col" className={cn(TH, 'hidden xl:table-cell')}>Expected return</th>
                <SortHeader label="Last updated" sortKey="updatedAt" params={params} className="hidden md:table-cell" />
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => {
                const booking = row.facts.liveBooking
                return (
                  <tr key={row.id} className="border-t border-line transition-colors hover:bg-panel-header">
                    <td className={TD}>
                      <Link href={`/kits/${row.id}`} className="font-mono text-xs font-semibold text-accent-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                        {row.kitCode}
                      </Link>
                      {row.admBarcode ? <p className="mt-0.5 font-mono text-[11px] text-subtle">{row.admBarcode}</p> : null}
                    </td>
                    <td className={`${TD} max-w-[18rem]`}>
                      <Link href={`/kits/${row.id}`} className="block truncate font-medium text-foreground hover:underline">
                        {row.name}
                      </Link>
                      {row.location ? <p className="truncate text-xs text-muted">{row.location}</p> : null}
                    </td>
                    <td className={TD}>
                      <KitStatusBadge status={row.status} />
                    </td>
                    <td className={`${TD} text-right tabular-nums text-foreground`}>
                      {row.availability.memberCount}
                      {row.availability.requiredCount !== row.availability.memberCount ? (
                        <span className="block text-[11px] text-subtle">{row.availability.requiredCount} required</span>
                      ) : null}
                    </td>
                    <td className={TD}>
                      <KitAvailabilityBadge availability={row.availability} />
                    </td>
                    <td className={`${TD} hidden text-foreground lg:table-cell`}>{booking ? booking.editorName : <Empty />}</td>
                    <td className={`${TD} hidden lg:table-cell`}>
                      {booking ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <Link href="/bookings" className="font-mono text-xs font-semibold text-accent-foreground hover:underline">
                            {booking.bookingNumber}
                          </Link>
                          <BookingStatusBadge status={booking.status} />
                        </span>
                      ) : (
                        <Empty />
                      )}
                    </td>
                    <td className={`${TD} hidden whitespace-nowrap tabular-nums text-foreground xl:table-cell`}>
                      {booking ? formatDate(booking.expectedReturnDate, timeZone) : <Empty />}
                    </td>
                    <td className={`${TD} hidden whitespace-nowrap tabular-nums text-muted md:table-cell`}>{formatDateTime(row.updatedAt, timeZone)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} hrefFor={(page) => kitsHref(params, { page })} />
    </div>
  )
}
