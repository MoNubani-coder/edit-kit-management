import { Activity, CalendarRange, ClipboardCheck, Link2, type LucideIcon, ToggleLeft, Undo2, UserPlus, UserX } from 'lucide-react'

import { Timeline, type TimelineEvent, type TimelineTone } from '@/components/common/timeline'
import type { EditorActivityEvent, EditorActivityKind } from '@/server/dal/editors.dal'

const ICONS: Record<EditorActivityKind, LucideIcon> = {
  created: UserPlus,
  update: Activity,
  status: ToggleLeft,
  account: Link2,
  booking: CalendarRange,
  handover: ClipboardCheck,
  return: Undo2,
  removed: UserX,
}

const TONES: Partial<Record<EditorActivityKind, TimelineTone>> = { removed: 'danger' }

/** Profile changes and booking milestones for one editor, newest first. */
export function EditorActivity({ events, timeZone, now }: { events: EditorActivityEvent[]; timeZone: string; now: Date }) {
  const items: TimelineEvent[] = events.map((event) => ({
    id: event.id,
    at: event.at,
    title: event.title,
    detail: event.detail,
    actorName: event.actorName,
    reference: event.reference,
    icon: ICONS[event.kind],
    tone: TONES[event.kind],
  }))

  return (
    <Timeline
      title="Activity"
      description="Profile created and edited, activation changes, account links, and every booking, collection and return."
      events={items}
      timeZone={timeZone}
      now={now}
      emptyDescription="Events will accumulate here as the profile is used."
    />
  )
}
