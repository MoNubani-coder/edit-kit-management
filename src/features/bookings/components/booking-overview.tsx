import { Boxes, ClipboardCheck, FileText, PackageCheck, Pencil, UserRound } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { BookingStatusBadge, KitStatusBadge } from '@/components/common/status-badge'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { KitAvailabilityBadge } from '@/features/kits/components/availability-badge'
import { HandoverSummaryPanel } from '@/features/handover/components/handover-summary'
import { PhotoStrip } from '@/features/photos/components/photo-strip'
import { ReturnSummaryPanel } from '@/features/return/components/return-summary'
import { AvailabilityNotice } from '@/features/kits/components/availability-notice'
import { requesterOf } from '@/lib/booking-requester'
import { BOOKING_STATUS_LABELS } from '@/lib/booking-rules'
import { formatDateTime } from '@/lib/datetime'
import type { BookingWorkspace } from '@/server/services/bookings.service'

import { CancelBookingForm, TransitionForm } from './booking-action-forms'
import { BookingTimeBadge } from './booking-time-badge'
import { ScheduleBlock } from './schedule-block'

function Panel({ title, icon: Icon, action, children }: { title: string; icon?: typeof Boxes; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="theme-transition rounded-panel border border-line bg-panel">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-panel-header px-5 py-3">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold text-foreground">
          {Icon ? <Icon aria-hidden className="h-4 w-4 text-accent-foreground" /> : null}
          {title}
        </h2>
        {action}
      </header>
      <div className="px-5 py-4 text-sm">{children}</div>
    </section>
  )
}

function Field({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{label}</dt>
      <dd className={mono ? 'mt-1 font-mono text-[13px] text-foreground' : 'mt-1 text-foreground'}>{children}</dd>
    </div>
  )
}

const Empty = () => <span className="text-subtle">—</span>

const NEXT_STEP: Record<string, string> = {
  DRAFT: 'A draft holds nothing. Reserve the kit to hold it for this window.',
  RESERVED: 'The kit is held for this window. Mark it ready once it has been prepared for the editor.',
  READY_FOR_HANDOVER: 'The kit is set aside. Open the handover to verify the equipment, collect both signatures and hand it over.',
  CHECKED_OUT: 'The kit is out with the editor. Open the return when it comes back to account for every item.',
  OVERDUE: 'The kit is out and past its expected return. Open the return as soon as it is back.',
  RETURN_INSPECTION: 'The kit is back and being checked against what went out. Finish the return to close the booking.',
  COMPLETED: 'The booking is complete. The handover and return documents are frozen.',
  CANCELLED: 'The booking was cancelled; the kit was released for this window.',
}

/** The Overview tab: who, what, when, where it stands, and what can happen next. */
export function BookingOverview({ workspace, timeZone, now }: { workspace: BookingWorkspace; timeZone: string; now: Date }) {
  const { booking, time, readiness, kitNow, canReadKit, canReadEditor } = workspace
  const editor = booking.editor
  const requester = requesterOf(booking)
  const kit = booking.kit
  const anyAction =
    workspace.canReserve ||
    workspace.canReturnToDraft ||
    workspace.canMarkReady ||
    workspace.canRevertReady ||
    workspace.canCancel ||
    workspace.canUpdate ||
    workspace.canHandover ||
    workspace.canReturn

  return (
    <div className="space-y-6">
      {booking.status === 'CANCELLED' ? (
        <Alert variant="warning" title={`Cancelled${booking.cancelledAt ? ` on ${formatDateTime(booking.cancelledAt, timeZone)}` : ''}`}>
          {booking.cancelReason ?? 'No reason recorded.'}
        </Alert>
      ) : null}
      {time.overdue ? (
        <Alert variant="error" title="Overdue">
          The kit was expected back on {formatDateTime(booking.expectedReturnDate, timeZone)} and has not been returned.
        </Alert>
      ) : null}
      {editor && !editor.isActive && booking.status !== 'CANCELLED' && booking.status !== 'COMPLETED' ? (
        <Alert variant="warning" title="Directory entry inactive">
          {editor.fullName} has been deactivated in the editor directory. This booking stays valid; the name recorded on it does not change.
        </Alert>
      ) : null}

      <ScheduleBlock
        bookingStart={booking.bookingStart}
        bookingEnd={booking.bookingEnd}
        collectionDate={booking.collectionDate}
        expectedReturnDate={booking.expectedReturnDate}
        actualReturnDate={booking.actualReturnDate}
        overdue={time.overdue}
        timeZone={timeZone}
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel
          title="Requester"
          icon={UserRound}
          action={
            canReadEditor && editor ? (
              <Link href={`/editors/${editor.id}`} className="text-sm font-medium text-accent-foreground hover:underline">
                Directory entry
              </Link>
            ) : null
          }
        >
          <dl className="grid gap-4">
            <Field label="Name">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{requester.name}</span>
                {requester.isExternal !== null ? <Badge tone={requester.isExternal ? 'neutral' : 'blue'}>{requester.isExternal ? 'External' : 'Internal'}</Badge> : null}
                {editor && !editor.isActive ? <Badge tone="neutral">Inactive</Badge> : null}
              </span>
            </Field>
            <Field label="Staff ID" mono>
              {requester.staffId ?? <Empty />}
            </Field>
            <Field label="Mobile">{requester.mobile ?? <Empty />}</Field>
            <Field label="Project">{requester.projectName ?? <Empty />}</Field>
            <Field label="Work order" mono>
              {requester.workOrder ?? <Empty />}
            </Field>
            {editor ? <Field label={editor.isExternal ? 'Company' : 'Department'}>{(editor.isExternal ? editor.company : editor.department) ?? <Empty />}</Field> : null}
          </dl>
        </Panel>

        <Panel
          title="Kit"
          icon={Boxes}
          action={
            canReadKit ? (
              <Link href={`/kits/${kit.id}`} className="text-sm font-medium text-accent-foreground hover:underline">
                Open
              </Link>
            ) : null
          }
        >
          <dl className="grid gap-4">
            <Field label="Kit">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-accent-foreground">{kit.kitCode}</span>
                <span className="font-medium">{kit.name}</span>
              </span>
            </Field>
            <Field label="Kit state">
              <span className="flex flex-wrap items-center gap-2">
                <KitStatusBadge status={kit.status as never} />
                {kitNow ? <KitAvailabilityBadge availability={kitNow} /> : null}
              </span>
            </Field>
            <Field label="Readiness for this booking">
              {readiness ? (
                readiness.available ? (
                  <span className="text-emerald-700 dark:text-emerald-300">
                    All {readiness.requiredCount} required {readiness.requiredCount === 1 ? 'item is' : 'items are'} available
                    {readiness.warningCount > 0 ? `; ${readiness.warningCount} optional ${readiness.warningCount === 1 ? 'item needs' : 'items need'} attention` : ''}.
                  </span>
                ) : (
                  <span className="text-amber-800 dark:text-amber-300">
                    {readiness.blockingCount} {readiness.blockingCount === 1 ? 'item blocks' : 'items block'} the handover. See the Equipment tab.
                  </span>
                )
              ) : (
                <Empty />
              )}
            </Field>
            <Field label="Barcode" mono>
              {kit.admBarcode ?? <Empty />}
            </Field>
          </dl>
        </Panel>

        <Panel title="Operational status">
          <dl className="grid gap-4">
            <Field label="Booking state">
              <span className="flex flex-wrap items-center gap-2">
                <BookingStatusBadge status={booking.status} />
                <BookingTimeBadge status={booking.status} expectedReturnDate={booking.expectedReturnDate} overdue={time.overdue} dueSoon={time.dueSoon} now={now} timeZone={timeZone} />
              </span>
              <span className="mt-1 block text-xs text-muted">{NEXT_STEP[booking.status]}</span>
            </Field>
            <Field label="Prepared by">
              {booking.createdBy.name}
              <span className="ml-2 text-xs text-muted">from the signed-in account</span>
            </Field>
            {booking.engineer ? (
              <Field label="Assigned engineer">
                {booking.engineer.fullName}
                {booking.engineer.staffId ? <span className="ml-2 font-mono text-xs text-muted">{booking.engineer.staffId}</span> : null}
              </Field>
            ) : null}
            <Field label="Purpose">{booking.purpose ?? <Empty />}</Field>
            <Field label="Handover checklist">
              {workspace.checklist.handoverCount === 0 ? (
                'No checks on this booking'
              ) : workspace.checklist.complete ? (
                <span className="text-emerald-700 dark:text-emerald-300">Complete · {workspace.checklist.passed} of {workspace.checklist.required} required checks passed</span>
              ) : (
                <span className="text-amber-800 dark:text-amber-300">
                  {workspace.checklist.outstanding.length} of {workspace.checklist.required} required {workspace.checklist.outstanding.length === 1 ? 'check' : 'checks'} outstanding · see the Checklist tab
                </span>
              )}
              <span className="block text-xs text-muted">{booking.checklistTemplate?.name ?? 'System default'}</span>
            </Field>
            <Field label="Created">{formatDateTime(booking.createdAt, timeZone)}</Field>
          </dl>
        </Panel>
      </div>

      {workspace.returnInspection ? (
        <ReturnSummaryPanel
          summary={workspace.returnInspection}
          expectedReturnDate={booking.expectedReturnDate}
          actualReturnDate={booking.actualReturnDate}
          timeZone={timeZone}
          canReadIssues={workspace.canReadIssues}
        />
      ) : null}

      {workspace.handover ? <HandoverSummaryPanel summary={workspace.handover} collectionDate={booking.collectionDate} timeZone={timeZone} /> : null}

      {workspace.documents.length > 0 ? (
        <section className="theme-transition rounded-panel border border-line bg-panel">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel-header px-5 py-3">
            <div>
              <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold text-foreground">
                <FileText aria-hidden className="h-4 w-4 text-accent-foreground" />
                Signed documents
              </h2>
              <p className="mt-0.5 text-xs text-muted">Frozen when each inspection completed. Later changes to the kit or its equipment cannot alter them.</p>
            </div>
          </header>
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            {workspace.documents.includes('handover') ? (
              <>
                <Link href={`/bookings/${booking.id}/document/handover`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                  Handover record
                </Link>
                <Link href={`/api/documents/handover/${booking.id}`} prefetch={false} className="text-sm text-accent-foreground hover:underline">
                  PDF
                </Link>
              </>
            ) : null}
            {workspace.documents.includes('return') ? (
              <>
                <Link href={`/bookings/${booking.id}/document/return`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                  Return record
                </Link>
                <Link href={`/api/documents/return/${booking.id}`} prefetch={false} className="text-sm text-accent-foreground hover:underline">
                  PDF
                </Link>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {workspace.photos.length > 0 ? <PhotoStrip photos={workspace.photos} timeZone={timeZone} /> : null}

      {readiness && !readiness.available && booking.status !== 'CANCELLED' && booking.status !== 'COMPLETED' && booking.status !== 'CHECKED_OUT' ? <AvailabilityNotice availability={readiness} /> : null}

      {booking.notes ? (
        <Panel title="Notes">
          <p className="whitespace-pre-line text-foreground">{booking.notes}</p>
        </Panel>
      ) : null}

      {anyAction ? (
        <section className="theme-transition rounded-panel border border-accent/40 bg-panel">
          <header className="border-b border-line bg-panel-header px-5 py-3">
            <h2 className="font-display text-[15px] font-semibold text-foreground">Actions</h2>
            <p className="mt-0.5 text-xs text-muted">Each step is checked by the server: readiness, the free window and the booking’s state. Status is never set by hand.</p>
          </header>
          <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex flex-wrap items-start gap-3">
              {workspace.canHandover ? (
                <Link href={`/bookings/${booking.id}/handover`} className={buttonVariants({ variant: 'primary', size: 'sm' })}>
                  <ClipboardCheck aria-hidden className="h-4 w-4" />
                  {workspace.handover ? 'Continue handover' : 'Start handover'}
                </Link>
              ) : null}
              {workspace.canReturn ? (
                <Link href={`/bookings/${booking.id}/return`} className={buttonVariants({ variant: 'primary', size: 'sm' })}>
                  <PackageCheck aria-hidden className="h-4 w-4" />
                  {workspace.returnInspection ? 'Continue return' : 'Start return inspection'}
                </Link>
              ) : null}
              {workspace.canReserve ? <TransitionForm bookingId={booking.id} transition="reserve" /> : null}
              {workspace.canMarkReady ? <TransitionForm bookingId={booking.id} transition="ready" /> : null}
              {workspace.canRevertReady ? <TransitionForm bookingId={booking.id} transition="revert" /> : null}
              {workspace.canReturnToDraft ? <TransitionForm bookingId={booking.id} transition="draft" /> : null}
              {workspace.canUpdate ? (
                <Link href={`/bookings/${booking.id}/edit`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                  <Pencil aria-hidden className="h-4 w-4" />
                  {workspace.editScope === 'restricted' ? 'Edit engineer and notes' : 'Edit booking'}
                </Link>
              ) : null}
              {booking.status === 'READY_FOR_HANDOVER' && !workspace.canHandover ? <p className="w-full text-xs text-muted">The handover is performed by an engineer or administrator.</p> : null}
              {(booking.status === 'CHECKED_OUT' || booking.status === 'OVERDUE' || booking.status === 'RETURN_INSPECTION') && !workspace.canReturn ? (
                <p className="w-full text-xs text-muted">The return inspection is performed by an engineer or administrator.</p>
              ) : null}
            </div>
            {workspace.canCancel ? (
              <div className="rounded-lg border border-line bg-panel-header/50 p-4">
                <CancelBookingForm bookingId={booking.id} bookingNumber={booking.bookingNumber} />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {!anyAction && booking.status !== 'CANCELLED' && booking.status !== 'COMPLETED' ? (
        <p className="text-xs text-muted">{BOOKING_STATUS_LABELS[booking.status]} bookings are managed by the handover and return workflows.</p>
      ) : null}
    </div>
  )
}
