import {
  Activity,
  AppWindow,
  Boxes,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  type LucideIcon,
  PackageMinus,
  PackagePlus,
  PackageX,
  RefreshCw,
  TriangleAlert,
  Undo2,
} from 'lucide-react'

import { Timeline, type TimelineEvent, type TimelineTone } from '@/components/common/timeline'
import type { KitHistoryEvent, KitHistoryKind } from '@/server/dal/kits.dal'

const ICONS: Record<KitHistoryKind, LucideIcon> = {
  created: Boxes,
  update: Activity,
  status: RefreshCw,
  'member-added': PackagePlus,
  'member-removed': PackageMinus,
  software: AppWindow,
  checklist: ClipboardList,
  booking: CalendarRange,
  handover: ClipboardCheck,
  return: Undo2,
  issue: TriangleAlert,
  removed: PackageX,
}

const TONES: Partial<Record<KitHistoryKind, TimelineTone>> = {
  issue: 'warning',
  removed: 'danger',
}

/** Kit history as a timeline: creation, contents, configuration, bookings, issues. */
export function KitHistory({ events, timeZone, now }: { events: KitHistoryEvent[]; timeZone: string; now: Date }) {
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
      title="History"
      description="Creation, equipment added and removed, software and checklist changes, status changes, bookings, handovers, returns and issues in one trail."
      events={items}
      timeZone={timeZone}
      now={now}
      emptyDescription="Events will accumulate here as the kit is configured and issued."
    />
  )
}
