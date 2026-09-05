import { Activity, Ban, CalendarPlus, ClipboardCheck, type LucideIcon, RefreshCw, Undo2 } from 'lucide-react'

import { Timeline, type TimelineEvent, type TimelineTone } from '@/components/common/timeline'
import type { BookingActivityEvent, BookingActivityKind } from '@/server/dal/bookings.dal'

const ICONS: Record<BookingActivityKind, LucideIcon> = {
  created: CalendarPlus,
  update: Activity,
  status: RefreshCw,
  cancelled: Ban,
  handover: ClipboardCheck,
  return: Undo2,
  other: Activity,
}

const TONES: Partial<Record<BookingActivityKind, TimelineTone>> = { cancelled: 'danger' }

/** The booking's story, newest first: created, reserved, changed, made ready, cancelled … */
export function BookingActivity({ events, timeZone, now }: { events: BookingActivityEvent[]; timeZone: string; now: Date }) {
  const items: TimelineEvent[] = events.map((event) => ({
    id: event.id,
    at: event.at,
    title: event.title,
    detail: event.detail,
    actorName: event.actorName,
    reference: null,
    icon: ICONS[event.kind],
    tone: TONES[event.kind],
  }))
  return (
    <Timeline
      title="Activity"
      description="Every change to this booking, with who made it. Handover and return events join this trail in later phases."
      events={items}
      timeZone={timeZone}
      now={now}
      emptyDescription="Events will accumulate here as the booking progresses."
    />
  )
}
