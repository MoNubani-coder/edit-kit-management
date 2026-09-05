import { CalendarRange } from 'lucide-react'
import Link from 'next/link'

import { EmptyState } from '@/components/common/empty-state'
import { Pagination } from '@/components/common/pagination'
import { BookingStatusBadge } from '@/components/common/status-badge'
import { formatDate } from '@/lib/datetime'
import type { EditorBookingsResult } from '@/server/dal/editors.dal'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-middle whitespace-nowrap'

const Empty = () => <span className="text-subtle">—</span>

/** Bookings of one editor - the live ones, or the whole history - paginated in the database. */
export function EditorBookingsTable({
  result,
  scope,
  timeZone,
  hrefFor,
}: {
  result: EditorBookingsResult
  scope: 'active' | 'history'
  timeZone: string
  hrefFor: (page: number) => string
}) {
  return (
    <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
      <header className="border-b border-line bg-panel-header px-5 py-3">
        <h3 className="font-display text-[15px] font-semibold text-foreground">{scope === 'active' ? 'Active bookings' : 'Booking history'}</h3>
        <p className="mt-0.5 text-xs text-muted">
          {scope === 'active' ? 'Reserved, ready for handover, checked out, overdue or in return inspection. Soonest first.' : 'Every booking on record, newest first.'}
        </p>
      </header>
      {result.rows.length === 0 ? (
        <EmptyState
          compact
          icon={CalendarRange}
          title={scope === 'active' ? 'No active bookings' : 'No bookings yet'}
          description={scope === 'active' ? 'Nothing is reserved for or out with this editor right now.' : 'Bookings will accumulate here as kits are issued to this editor.'}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className={TH}>Booking</th>
                <th scope="col" className={TH}>Kit</th>
                <th scope="col" className={TH}>Start</th>
                <th scope="col" className={`${TH} hidden md:table-cell`}>Collected</th>
                <th scope="col" className={TH}>Expected return</th>
                <th scope="col" className={`${TH} hidden md:table-cell`}>Returned</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={`${TH} hidden lg:table-cell`}>Engineer</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id} className="border-t border-line transition-colors hover:bg-panel-header">
                  <td className={TD}>
                    <Link href="/bookings" className="font-mono text-xs font-semibold text-accent-foreground hover:underline">
                      {row.bookingNumber}
                    </Link>
                  </td>
                  <td className={TD}>
                    <Link href={`/kits/${row.kit.id}`} className="hover:underline">
                      <span className="font-mono text-xs font-semibold text-foreground">{row.kit.kitCode}</span>
                      <span className="hidden text-muted xl:inline"> · {row.kit.name}</span>
                    </Link>
                  </td>
                  <td className={`${TD} tabular-nums text-foreground`}>{formatDate(row.bookingStart, timeZone)}</td>
                  <td className={`${TD} hidden tabular-nums text-foreground md:table-cell`}>{row.collectionDate ? formatDate(row.collectionDate, timeZone) : <Empty />}</td>
                  <td className={`${TD} tabular-nums text-foreground`}>{formatDate(row.expectedReturnDate, timeZone)}</td>
                  <td className={`${TD} hidden tabular-nums text-foreground md:table-cell`}>{row.actualReturnDate ? formatDate(row.actualReturnDate, timeZone) : <Empty />}</td>
                  <td className={TD}>
                    <BookingStatusBadge status={row.status} />
                  </td>
                  <td className={`${TD} hidden text-foreground lg:table-cell`}>{row.engineerName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} hrefFor={hrefFor} />
    </div>
  )
}
