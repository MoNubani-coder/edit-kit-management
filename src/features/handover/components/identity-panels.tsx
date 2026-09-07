import { Boxes, CalendarRange, UserRound } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { BookingStatusBadge, KitStatusBadge } from '@/components/common/status-badge'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatTime } from '@/lib/datetime'
import { SUITCASE_STATUS_LABELS } from '@/lib/validation/kits'
import type { HandoverBooking } from '@/server/dal/handover.dal'

function Panel({ title, icon: Icon, action, children }: { title: string; icon: typeof Boxes; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="theme-transition rounded-panel border border-line bg-panel">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-panel-header px-5 py-3">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold text-foreground">
          <Icon aria-hidden className="h-4 w-4 text-accent-foreground" />
          {title}
        </h2>
        {action}
      </header>
      <dl className="grid gap-3 px-5 py-4 text-sm">{children}</dl>
    </section>
  )
}

function Field({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{label}</dt>
      <dd className={mono ? 'mt-0.5 font-mono text-[13px] text-foreground' : 'mt-0.5 text-foreground'}>{children}</dd>
    </div>
  )
}

const Empty = () => <span className="text-subtle">—</span>

/** Who, what and when - the identities the engineer checks out loud before anything is verified. */
export function IdentityPanels({ booking, timeZone, canReadEditor, canReadKit }: { booking: HandoverBooking; timeZone: string; canReadEditor: boolean; canReadKit: boolean }) {
  const editor = booking.editor
  const kit = booking.kit
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Panel title="Booking" icon={CalendarRange} action={<Link href={`/bookings/${booking.id}`} className="text-sm font-medium text-accent-foreground hover:underline">Open</Link>}>
        <Field label="Number" mono>
          {booking.bookingNumber}
        </Field>
        <Field label="Status">
          <BookingStatusBadge status={booking.status} />
        </Field>
        <Field label="Booking window">
          {formatDate(booking.bookingStart, timeZone)} {formatTime(booking.bookingStart, timeZone)} <span className="text-subtle">→</span> {formatDate(booking.bookingEnd, timeZone)} {formatTime(booking.bookingEnd, timeZone)}
        </Field>
        <Field label="Expected return">
          {formatDate(booking.expectedReturnDate, timeZone)} {formatTime(booking.expectedReturnDate, timeZone)}
        </Field>
        <Field label="Assigned engineer">
          {booking.engineer.fullName}
          {booking.engineer.staffId ? <span className="ml-2 font-mono text-xs text-muted">{booking.engineer.staffId}</span> : null}
        </Field>
        {booking.purpose ? <Field label="Purpose">{booking.purpose}</Field> : null}
      </Panel>

      <Panel title="Editor" icon={UserRound} action={canReadEditor ? <Link href={`/editors/${editor.id}`} className="text-sm font-medium text-accent-foreground hover:underline">Open</Link> : null}>
        <Field label="Name">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{editor.fullName}</span>
            <Badge tone={editor.isExternal ? 'neutral' : 'blue'}>{editor.isExternal ? 'External' : 'Internal'}</Badge>
            {!editor.isActive ? <Badge tone="amber">Inactive</Badge> : null}
          </span>
        </Field>
        <Field label="Staff ID" mono>
          {editor.staffId ?? <Empty />}
        </Field>
        <Field label="Mobile / contact">{editor.contactNumber ?? <Empty />}</Field>
        <Field label="Email">{editor.email ?? <Empty />}</Field>
        <Field label={editor.isExternal ? 'Company' : 'Department'}>{(editor.isExternal ? editor.company : editor.department) ?? <Empty />}</Field>
        {editor.isExternal ? <p className="text-xs text-muted">Signs in person on this device. No application account is involved.</p> : null}
      </Panel>

      <Panel title="Kit" icon={Boxes} action={canReadKit ? <Link href={`/kits/${kit.id}`} className="text-sm font-medium text-accent-foreground hover:underline">Open</Link> : null}>
        <Field label="Kit">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-accent-foreground">{kit.kitCode}</span>
            <span className="font-medium">{kit.name}</span>
          </span>
        </Field>
        <Field label="Kit status">
          <KitStatusBadge status={kit.status} />
        </Field>
        <Field label="Barcode" mono>
          {kit.admBarcode ?? <Empty />}
        </Field>
        <Field label="Case on record">{SUITCASE_STATUS_LABELS[kit.suitcaseStatus]}</Field>
      </Panel>
    </div>
  )
}
