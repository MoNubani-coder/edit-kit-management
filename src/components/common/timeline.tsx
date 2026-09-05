import type { LucideIcon } from 'lucide-react'
import { Activity } from 'lucide-react'
import Link from 'next/link'

import { EmptyState } from '@/components/common/empty-state'
import { formatDateTime, formatRelative } from '@/lib/datetime'
import { cn } from '@/lib/utils/cn'

export type TimelineTone = 'default' | 'warning' | 'danger'

export interface TimelineEvent {
  id: string
  at: Date
  title: string
  detail: string | null
  actorName: string | null
  reference: { label: string; href: string | null } | null
  icon: LucideIcon
  tone?: TimelineTone
}

const TONES: Record<Exclude<TimelineTone, 'default'>, string> = {
  warning: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300',
  danger: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-400/40 dark:bg-rose-400/10 dark:text-rose-300',
}

/**
 * A chronological trail, newest first: one hairline down the left, an icon per
 * event, the most recent event highlighted in the accent colour. The caller
 * maps its domain events to `TimelineEvent`s; this knows nothing about kits,
 * assets or bookings.
 */
export function Timeline({
  title,
  description,
  events,
  timeZone,
  now,
  emptyTitle = 'No history yet',
  emptyDescription,
}: {
  title: string
  description?: string
  events: TimelineEvent[]
  timeZone: string
  now: Date
  emptyTitle?: string
  emptyDescription?: string
}) {
  return (
    <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
      <header className="border-b border-line bg-panel-header px-5 py-3">
        <h3 className="font-display text-[15px] font-semibold text-foreground">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </header>
      {events.length === 0 ? (
        <EmptyState compact icon={Activity} title={emptyTitle} description={emptyDescription} />
      ) : (
        <ol className="relative px-5 py-4">
          <span aria-hidden className="absolute bottom-6 left-[2.15rem] top-6 w-px bg-line" />
          {events.map((event, index) => {
            const Icon = event.icon
            const tone = event.tone && event.tone !== 'default' ? TONES[event.tone] : null
            return (
              <li key={event.id} className="relative flex gap-4 py-2.5">
                <div
                  className={cn(
                    'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
                    tone ?? (index === 0 ? 'border-accent bg-accent-soft text-accent-foreground' : 'border-line bg-panel text-subtle'),
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
