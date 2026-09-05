import { CalendarRange } from 'lucide-react'

import { EmptyState } from '@/components/common/empty-state'
import { BookingStatusBadge } from '@/components/common/status-badge'
import { Badge } from '@/components/ui/badge'
import { describeDue, formatDate, formatTime, humanDuration } from '@/lib/datetime'
import type { DashboardBookingRow } from '@/server/dal/dashboard.dal'

/**
 * Booking rows in the four dashboard flavours. Columns after "Kit" depend on
 * the variant; everything else is shared so the tables read alike.
 */

export type BookingsTableVariant = 'today' | 'upcoming' | 'overdue' | 'history' | 'list'

const EMPTY: Record<BookingsTableVariant, { title: string; description: string }> = {
  today: { title: 'No collections or returns today', description: 'Bookings starting or due back today will appear here.' },
  upcoming: { title: 'Nothing due back', description: 'Kits currently out will be listed here with their return dates.' },
  overdue: { title: 'Nothing overdue', description: 'Every checked-out kit is within its expected return.' },
  history: { title: 'No bookings yet', description: 'Your bookings will appear here once one is made in your name.' },
  list: { title: 'No bookings match', description: 'Try another filter or search term, or clear them to see everything you have access to.' },
}

const TH = 'px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-5 py-3 align-middle'

function DateCell({ date, timeZone }: { date: Date | null; timeZone: string }) {
  if (!date) return <span className="text-subtle">—</span>
  return (
    <span className="whitespace-nowrap tabular-nums text-foreground">
      {formatDate(date, timeZone)}
      <span className="text-subtle"> · {formatTime(date, timeZone)}</span>
    </span>
  )
}

export function BookingsTable({
  rows,
  variant,
  timeZone,
  now,
  emptyAction,
}: {
  rows: DashboardBookingRow[]
  variant: BookingsTableVariant
  timeZone: string
  now: Date
  emptyAction?: { href: string; label: string }
}) {
  if (rows.length === 0) {
    const copy = EMPTY[variant]
    return <EmptyState compact icon={CalendarRange} title={copy.title} description={copy.description} action={emptyAction} />
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr>
            <th scope="col" className={TH}>Booking</th>
            <th scope="col" className={TH}>Editor</th>
            <th scope="col" className={TH}>Kit</th>
            {variant === 'today' ? (
              <>
                <th scope="col" className={TH}>Collection</th>
                <th scope="col" className={TH}>Expected return</th>
              </>
            ) : null}
            {variant === 'upcoming' ? (
              <>
                <th scope="col" className={TH}>Expected return</th>
                <th scope="col" className={TH}>Due</th>
              </>
            ) : null}
            {variant === 'overdue' ? (
              <>
                <th scope="col" className={TH}>Expected return</th>
                <th scope="col" className={TH}>Overdue by</th>
              </>
            ) : null}
            {variant === 'history' ? (
              <>
                <th scope="col" className={TH}>Period</th>
                <th scope="col" className={TH}>Return</th>
              </>
            ) : null}
            {variant === 'list' ? (
              <>
                <th scope="col" className={TH}>Start</th>
                <th scope="col" className={TH}>Expected return</th>
              </>
            ) : null}
            <th scope="col" className={TH}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const due = variant === 'upcoming' ? describeDue(row.expectedReturnDate, now, timeZone) : null
            return (
              <tr key={row.id} className="border-t border-line transition-colors hover:bg-panel-header">
                <td className={`${TD} font-mono text-xs font-medium text-accent-foreground`}>{row.bookingNumber}</td>
                <td className={`${TD} text-foreground`}>{row.editorName}</td>
                <td className={`${TD} text-foreground`}>
                  <span className="font-medium">{row.kitCode}</span>
                  <span className="hidden text-muted xl:inline"> · {row.kitName}</span>
                </td>

                {variant === 'today' ? (
                  <>
                    <td className={TD}>
                      <DateCell date={row.collectionDate ?? row.bookingStart} timeZone={timeZone} />
                    </td>
                    <td className={TD}>
                      <DateCell date={row.expectedReturnDate} timeZone={timeZone} />
                    </td>
                  </>
                ) : null}

                {variant === 'upcoming' && due ? (
                  <>
                    <td className={TD}>
                      <DateCell date={row.expectedReturnDate} timeZone={timeZone} />
                    </td>
                    <td className={TD}>
                      <Badge tone={due.tone}>{due.label}</Badge>
                    </td>
                  </>
                ) : null}

                {variant === 'overdue' ? (
                  <>
                    <td className={TD}>
                      <DateCell date={row.expectedReturnDate} timeZone={timeZone} />
                    </td>
                    <td className={`${TD} font-medium text-amber-700 dark:text-amber-300`}>
                      {humanDuration(now.getTime() - row.expectedReturnDate.getTime())}
                    </td>
                  </>
                ) : null}

                {variant === 'history' ? (
                  <>
                    <td className={`${TD} whitespace-nowrap text-foreground`}>
                      {formatDate(row.bookingStart, timeZone)} – {formatDate(row.bookingEnd, timeZone)}
                    </td>
                    <td className={TD}>
                      <DateCell date={row.actualReturnDate ?? row.expectedReturnDate} timeZone={timeZone} />
                    </td>
                  </>
                ) : null}

                {variant === 'list' ? (
                  <>
                    <td className={TD}>
                      <DateCell date={row.collectionDate ?? row.bookingStart} timeZone={timeZone} />
                    </td>
                    <td className={TD}>
                      <DateCell date={row.expectedReturnDate} timeZone={timeZone} />
                    </td>
                  </>
                ) : null}

                <td className={TD}>
                  <BookingStatusBadge status={row.status} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
