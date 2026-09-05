import { formatDate, formatTime, humanDuration } from '@/lib/datetime'
import { cn } from '@/lib/utils/cn'

interface Cell {
  label: string
  date: Date | null
  emphasis?: 'default' | 'attention'
  hint?: string
}

function ScheduleCell({ cell, timeZone }: { cell: Cell; timeZone: string }) {
  return (
    <div className="theme-transition bg-panel px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{cell.label}</p>
      {cell.date ? (
        <>
          <p className={cn('mt-1 font-display text-lg font-semibold tabular-nums', cell.emphasis === 'attention' ? 'text-rose-700 dark:text-rose-300' : 'text-foreground')}>
            {formatDate(cell.date, timeZone)}
          </p>
          <p className="text-sm tabular-nums text-muted">{formatTime(cell.date, timeZone)}</p>
        </>
      ) : (
        <p className="mt-1 font-display text-lg font-semibold text-subtle">—</p>
      )}
      {cell.hint ? <p className="mt-1 text-xs text-muted">{cell.hint}</p> : null}
    </div>
  )
}

/**
 * The booking period as one instrument strip: start, end, collection,
 * expected return and (once back) actual return, hairline-separated.
 */
export function ScheduleBlock({
  bookingStart,
  bookingEnd,
  collectionDate,
  expectedReturnDate,
  actualReturnDate,
  overdue = false,
  timeZone,
}: {
  bookingStart: Date
  bookingEnd: Date
  collectionDate: Date | null
  expectedReturnDate: Date
  actualReturnDate?: Date | null
  overdue?: boolean
  timeZone: string
}) {
  const cells: Cell[] = [
    { label: 'Booking start', date: bookingStart },
    { label: 'Booking end', date: bookingEnd, hint: `${humanDuration(bookingEnd.getTime() - bookingStart.getTime())} in total` },
    { label: 'Collection', date: collectionDate, hint: collectionDate ? undefined : 'At booking start' },
    { label: 'Expected return', date: expectedReturnDate, emphasis: overdue ? 'attention' : 'default', hint: overdue ? 'Overdue' : undefined },
  ]
  if (actualReturnDate) cells.push({ label: 'Returned', date: actualReturnDate })

  return (
    <div className={cn('grid gap-px overflow-hidden rounded-panel border border-line bg-line', cells.length === 5 ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4')}>
      {cells.map((cell) => (
        <ScheduleCell key={cell.label} cell={cell} timeZone={timeZone} />
      ))}
    </div>
  )
}
