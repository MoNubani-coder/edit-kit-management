import { ArrowDown, ArrowUp, ArrowUpDown, CalendarRange } from 'lucide-react'
import Link from 'next/link'

import { EmptyState } from '@/components/common/empty-state'
import { Pagination } from '@/components/common/pagination'
import { BookingStatusBadge } from '@/components/common/status-badge'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatTime } from '@/lib/datetime'
import type { BookingListParams, BookingSortKey } from '@/lib/validation/bookings'
import { cn } from '@/lib/utils/cn'
import type { BookingListPage } from '@/server/services/bookings.service'

import { bookingsHref } from '../hrefs'
import { BookingTimeBadge } from './booking-time-badge'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-top'

function SortHeader({ label, sortKey, params, className }: { label: string; sortKey: BookingSortKey; params: BookingListParams; className?: string }) {
  const active = params.sort === sortKey
  const nextDir = active && params.dir === 'asc' ? 'desc' : 'asc'
  const Icon = active ? (params.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <th scope="col" className={cn(TH, className)} aria-sort={active ? (params.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Link
        href={bookingsHref(params, { sort: sortKey, dir: nextDir })}
        className={cn('inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', active && 'text-accent-foreground')}
      >
        {label}
        <Icon aria-hidden className="h-3 w-3" />
      </Link>
    </th>
  )
}

function When({ date, timeZone }: { date: Date | null; timeZone: string }) {
  if (!date) return <span className="text-subtle">—</span>
  return (
    <span className="whitespace-nowrap tabular-nums text-foreground">
      {formatDate(date, timeZone)}
      <span className="block text-xs text-subtle">{formatTime(date, timeZone)}</span>
    </span>
  )
}

export function BookingsTable({
  page,
  params,
  timeZone,
  now,
}: {
  page: BookingListPage
  params: BookingListParams
  timeZone: string
  now: Date
}) {
  const { result, seesAll, canCreate } = page
  const filtered = Boolean(params.q || params.filter !== 'all')

  return (
    <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
      {result.rows.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title={filtered ? 'No bookings match' : seesAll ? 'No bookings yet' : 'No bookings in your name yet'}
          description={
            filtered
              ? 'Try another tab or search term.'
              : canCreate
                ? 'Create the first booking: choose the editor, the kit and the dates, then reserve.'
                : 'Bookings will appear here once a kit has been reserved.'
          }
          action={filtered ? { href: '/bookings', label: 'Clear filters' } : canCreate ? { href: '/bookings/new', label: 'New booking' } : undefined}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <SortHeader label="Booking" sortKey="bookingNumber" params={params} />
                <th scope="col" className={TH}>Editor</th>
                <th scope="col" className={TH}>Kit</th>
                <SortHeader label="Start" sortKey="bookingStart" params={params} />
                <th scope="col" className={cn(TH, 'hidden xl:table-cell')}>End</th>
                <th scope="col" className={cn(TH, 'hidden lg:table-cell')}>Collection</th>
                <SortHeader label="Expected return" sortKey="expectedReturnDate" params={params} />
                <th scope="col" className={cn(TH, 'hidden xl:table-cell')}>Returned</th>
                <SortHeader label="Status" sortKey="status" params={params} />
                <th scope="col" className={cn(TH, 'hidden lg:table-cell')}>Engineer</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id} className={cn('border-t border-line transition-colors hover:bg-panel-header', row.overdue && 'bg-rose-50/40 dark:bg-rose-400/5')}>
                  <td className={TD}>
                    <Link href={`/bookings/${row.id}`} className="font-mono text-xs font-semibold text-accent-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                      {row.bookingNumber}
                    </Link>
                  </td>
                  <td className={`${TD} max-w-[16rem]`}>
                    <p className="truncate font-medium text-foreground">{row.editor.fullName}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <Badge tone={row.editor.isExternal ? 'neutral' : 'blue'}>{row.editor.isExternal ? 'External' : 'Internal'}</Badge>
                      {row.editor.staffId ? <span className="font-mono">{row.editor.staffId}</span> : null}
                    </p>
                  </td>
                  <td className={`${TD} max-w-[16rem]`}>
                    <p className="font-mono text-xs font-semibold text-foreground">{row.kit.kitCode}</p>
                    <p className="truncate text-xs text-muted">{row.kit.name}</p>
                  </td>
                  <td className={TD}>
                    <When date={row.bookingStart} timeZone={timeZone} />
                  </td>
                  <td className={`${TD} hidden xl:table-cell`}>
                    <When date={row.bookingEnd} timeZone={timeZone} />
                  </td>
                  <td className={`${TD} hidden lg:table-cell`}>
                    <When date={row.collectionDate} timeZone={timeZone} />
                  </td>
                  <td className={TD}>
                    <When date={row.expectedReturnDate} timeZone={timeZone} />
                    <div className="mt-1">
                      <BookingTimeBadge status={row.status} expectedReturnDate={row.expectedReturnDate} overdue={row.overdue} dueSoon={row.dueSoon} now={now} timeZone={timeZone} />
                    </div>
                  </td>
                  <td className={`${TD} hidden xl:table-cell`}>
                    <When date={row.actualReturnDate} timeZone={timeZone} />
                  </td>
                  <td className={TD}>
                    <BookingStatusBadge status={row.status} />
                  </td>
                  <td className={`${TD} hidden text-foreground lg:table-cell`}>{row.engineer.fullName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} hrefFor={(next) => bookingsHref(params, { page: next })} />
    </div>
  )
}
