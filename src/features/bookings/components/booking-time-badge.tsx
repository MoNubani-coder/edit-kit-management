import type { BookingStatus } from '@prisma/client'

import { Badge } from '@/components/ui/badge'
import { describeDue, humanDuration } from '@/lib/datetime'

/**
 * The time dimension of a booking's state, derived by the service
 * (`bookingTimeState`) - never recomputed here: "Overdue by 3 h", "Due today,
 * 17:00", or nothing when the kit is not out.
 */
export function BookingTimeBadge({
  status,
  expectedReturnDate,
  overdue,
  dueSoon,
  now,
  timeZone,
}: {
  status: BookingStatus
  expectedReturnDate: Date
  overdue: boolean
  dueSoon: boolean
  now: Date
  timeZone: string
}) {
  if (overdue) {
    return (
      <Badge tone="red" dot>
        Overdue by {humanDuration(now.getTime() - expectedReturnDate.getTime())}
      </Badge>
    )
  }
  if (dueSoon) {
    const due = describeDue(expectedReturnDate, now, timeZone)
    return <Badge tone="amber">{due.label}</Badge>
  }
  if (status === 'CHECKED_OUT') {
    return <Badge tone="neutral">{describeDue(expectedReturnDate, now, timeZone).label}</Badge>
  }
  return null
}
