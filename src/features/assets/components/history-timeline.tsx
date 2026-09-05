import {
  Activity,
  Boxes,
  Cable,
  ClipboardCheck,
  type LucideIcon,
  PackagePlus,
  PackageX,
  RefreshCw,
  TriangleAlert,
  Undo2,
  Wrench,
} from 'lucide-react'
import Link from 'next/link'

import { EmptyState } from '@/components/common/empty-state'
import { formatDateTime, formatRelative } from '@/lib/datetime'
import type { AssetHistoryEvent, AssetHistoryKind } from '@/server/dal/assets.dal'
import { cn } from '@/lib/utils/cn'

const ICONS: Record<AssetHistoryKind, LucideIcon> = {
  created: PackagePlus,
  status: RefreshCw,
  kit: Boxes,
  handover: ClipboardCheck,
  return: Undo2,
  issue: TriangleAlert,
  maintenance: Wrench,
  accessory: Cable,
  update: Activity,
  removed: PackageX,
}

const TONES: Partial<Record<AssetHistoryKind, string>> = {
  issue: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300',
  removed: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-400/40 dark:bg-rose-400/10 dark:text-rose-300',
}

/** The unified chronological trail, newest first. */
export function HistoryTimeline({ events, timeZone, now }: { events: AssetHistoryEvent[]; timeZone: string; now: Date }) {
  return (
    <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
      <header className="border-b border-line bg-panel-header px-5 py-3">
        <h3 className="font-display text-[15px] font-semibold text-foreground">History</h3>
        <p className="mt-0.5 text-xs text-muted">Status changes, kit membership, handovers and returns, issues, maintenance and edits in one trail.</p>
      </header>
      {events.length === 0 ? (
        <EmptyState compact icon={Activity} title="No history yet" description="Events will accumulate here as the equipment is used." />
      ) : (
        <ol className="relative px-5 py-4">
          <span aria-hidden className="absolute bottom-6 left-[2.15rem] top-6 w-px bg-line" />
          {events.map((event, index) => {
            const Icon = ICONS[event.kind]
            return (
              <li key={event.id} className="relative flex gap-4 py-2.5">
                <div
                  className={cn(
                    'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
                    TONES[event.kind] ?? (index === 0 ? 'border-accent bg-accent-soft text-accent-foreground' : 'border-line bg-panel text-subtle'),
                  )}
                >
                  <Icon aria-hidden className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">
                    {event.title}
                    {event.reference?.href ? (
                      <>
                        {' '}
                        <Link href={event.reference.href} className="font-mono text-xs text-accent-foreground hover:underline">
                          {event.reference.label}
                        </Link>
                      </>
                    ) : null}
                  </p>
                  {event.detail ? <p className="mt-0.5 text-xs text-muted">{event.detail}</p> : null}
                  <p className="mt-0.5 text-xs text-subtle">
                    {event.actorName ? <span>{event.actorName} · </span> : null}
                    <time dateTime={event.at.toISOString()} title={formatRelative(event.at, now)}>
                      {formatDateTime(event.at, timeZone)}
                    </time>
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
