import { History } from 'lucide-react'

import { formatDateTime } from '@/lib/datetime'
import type { IssueActivityEvent } from '@/server/dal/issues.dal'

/**
 * What has happened to this issue, newest first: raised, picked up, resolved,
 * closed, reopened. Sentences from the audit log, never the payloads.
 */
export function IssueActivity({ events, timeZone }: { events: IssueActivityEvent[]; timeZone: string }) {
  return (
    <section className="theme-transition rounded-panel border border-line bg-panel">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-panel-header px-5 py-3">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold text-foreground">
          <History aria-hidden className="h-4 w-4 text-accent-foreground" />
          History
        </h2>
        <span className="text-xs text-muted">{events.length === 0 ? 'Nothing yet' : `${events.length} ${events.length === 1 ? 'entry' : 'entries'}`}</span>
      </header>
      {events.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">No recorded history for this issue.</p>
      ) : (
        <ol className="divide-y divide-line">
          {events.map((event) => (
            <li key={event.id} className="px-5 py-3">
              <p className="text-sm text-foreground">{event.title}</p>
              <p className="mt-0.5 text-xs text-muted">
                {formatDateTime(event.at, timeZone)} · {event.actorName}
                {event.detail ? ` · ${event.detail}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
