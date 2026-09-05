import { CalendarRange } from 'lucide-react'

import { EmptyState } from '@/components/common/empty-state'
import { BookingStatusBadge } from '@/components/common/status-badge'
import { Badge } from '@/components/ui/badge'
import { describeDue, formatDate, formatDateTime } from '@/lib/datetime'
import type { DashboardMyBookings } from '@/server/services/dashboard.service'

import { BookingsTable } from './bookings-table'
import { SectionCard } from './section-card'

/**
 * What an internal editor sees: their current booking, its return, and their
 * history. The data arrived already scoped to them by the DAL.
 */
export function EditorDashboard({
  mine,
  timeZone,
  now,
}: {
  mine: DashboardMyBookings
  timeZone: string
  now: Date
}) {
  const current = mine.current
  const isOut = current?.status === 'CHECKED_OUT' || current?.status === 'OVERDUE'
  const due = current ? describeDue(current.expectedReturnDate, now, timeZone) : null

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Current booking" description="The booking in your name that is live right now.">
          {current ? (
            <dl className="grid gap-5 px-5 py-5 text-sm sm:grid-cols-2">
              <Field label="Booking">
                <span className="font-mono text-accent-foreground">{current.bookingNumber}</span>
              </Field>
              <Field label="Status">
                <BookingStatusBadge status={current.status} />
              </Field>
              <Field label="Kit">
                <span className="font-medium">{current.kitCode}</span> · {current.kitName}
              </Field>
              <Field label="Period">
                {formatDate(current.bookingStart, timeZone)} – {formatDate(current.bookingEnd, timeZone)}
              </Field>
              <Field label={isOut ? 'Collected' : 'Collection'} wide>
                {formatDateTime(current.collectionDate ?? current.bookingStart, timeZone)}
              </Field>
            </dl>
          ) : (
            <EmptyState
              compact
              icon={CalendarRange}
              title="No live booking"
              description="When a kit is booked in your name it will appear here."
            />
          )}
        </SectionCard>

        <SectionCard title="Upcoming return" description="When the kit you hold is expected back.">
          {current && due ? (
            <div className="px-5 py-5">
              <p className="font-display text-2xl font-semibold tracking-tight text-foreground">
                {formatDateTime(current.expectedReturnDate, timeZone)}
              </p>
              <div className="mt-2">
                <Badge tone={due.tone} dot>
                  {due.label}
                </Badge>
              </div>
              <p className="mt-4 text-sm text-muted">
                Return {current.kitCode} to the Engineering store with every accessory; an engineer will
                inspect it with you.
              </p>
            </div>
          ) : (
            <EmptyState compact icon={CalendarRange} title="Nothing to return" description="You have no kit checked out." />
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Your booking history"
        description="Most recent first."
        action={{ href: '/bookings', label: 'View all bookings' }}
        count={mine.history.length}
      >
        <BookingsTable rows={mine.history} variant="history" timeZone={timeZone} now={now} />
      </SectionCard>
    </div>
  )
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{label}</dt>
      <dd className="mt-1 text-foreground">{children}</dd>
    </div>
  )
}
