'use client'

import { CalendarCheck, LoaderCircle, Save } from 'lucide-react'
import Link from 'next/link'
import { useActionState, useId } from 'react'

import { Alert } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { EditScope } from '@/lib/booking-rules'
import { type BookingFormState, createBookingFormAction, updateBookingFormAction } from '@/server/actions/bookings.actions'

/**
 * The booking form: who the kit is for, when, and why - posting to the Server
 * Action with the kit chosen in the picker above as a hidden field.
 *
 * The requester is typed here and becomes the booking's own record; it never
 * changes because a directory entry was edited later. "Prepared by" is the
 * signed-in account and is shown, not posted: the server takes it from the
 * session, so nothing in this form can name somebody else as the preparer.
 * Editing requires a reason, which the audit trail shows.
 */

/** A numbered section header, matching the kit picker's above the form. */
function Step({ number, title, hint }: { number: number; title: string; hint: string }) {
  return (
    <header className="border-b border-line bg-panel-header px-5 py-3">
      <h2 className="font-display text-[15px] font-semibold text-foreground">
        <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft font-mono text-xs text-accent-foreground">{number}</span>
        {title}
      </h2>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </header>
  )
}

export interface BookingFormValues {
  id?: string
  kitId: string
  /** Legacy: a directory profile already on the booking. Kept so an old booking can be edited without losing it. */
  editorId?: string
  requesterName: string
  requesterStaffId: string
  requesterMobile: string
  projectName: string
  workOrder: string
  bookingStart: string
  bookingEnd: string
  collectionDate: string
  expectedReturnDate: string
  purpose: string
  notes: string
}

export function BookingForm({
  mode,
  values,
  scope = 'full',
  kitLabel,
  preparedBy,
  timeZone,
  cancelHref,
  ready,
}: {
  mode: 'create' | 'edit'
  values: BookingFormValues
  /** Edit only: how much of the booking may change in its current status. */
  scope?: EditScope
  /** What is being booked, for the review line. */
  kitLabel: string
  /** The signed-in account, shown as the preparer. Never posted. */
  preparedBy: string
  timeZone: string
  cancelHref: string
  /** Create only: whether the chosen kit allows "Reserve now". */
  ready: boolean
}) {
  const [state, formAction, pending] = useActionState<BookingFormState, FormData>(mode === 'create' ? createBookingFormAction : updateBookingFormAction, null)
  const id = useId()
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {}
  const locked = scope === 'restricted'

  return (
    <form action={formAction} noValidate className="space-y-6">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <input type="hidden" name="kitId" value={values.kitId} />
      {values.editorId ? <input type="hidden" name="editorId" value={values.editorId} /> : null}
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
      {errors.kitId ? <Alert variant="error">{errors.kitId}</Alert> : null}
      {errors.editorId ? <Alert variant="error">{errors.editorId}</Alert> : null}

      <section className="theme-transition rounded-panel border border-line bg-panel">
        <Step number={2} title="Who is it for" hint="Typed here and kept on the booking as its own record. A staff ID is optional for external staff." />
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <FormField label="Name" htmlFor={`${id}-requester`} error={errors.requesterName} required>
            <Input id={`${id}-requester`} name="requesterName" defaultValue={values.requesterName} maxLength={120} required autoComplete="off" invalid={Boolean(errors.requesterName)} placeholder="Full name of the person receiving the kit" />
          </FormField>
          <FormField label="Staff ID" htmlFor={`${id}-staff`} error={errors.requesterStaffId} hint="Optional for external staff.">
            <Input id={`${id}-staff`} name="requesterStaffId" defaultValue={values.requesterStaffId} maxLength={40} className="font-mono" autoComplete="off" invalid={Boolean(errors.requesterStaffId)} />
          </FormField>
          <FormField label="Mobile number" htmlFor={`${id}-mobile`} error={errors.requesterMobile} required>
            <Input id={`${id}-mobile`} name="requesterMobile" defaultValue={values.requesterMobile} maxLength={40} required inputMode="tel" autoComplete="off" invalid={Boolean(errors.requesterMobile)} placeholder="+971 5x xxx xxxx" />
          </FormField>
          <FormField label="Project name" htmlFor={`${id}-project`} error={errors.projectName} required>
            <Input id={`${id}-project`} name="projectName" defaultValue={values.projectName} maxLength={200} required autoComplete="off" invalid={Boolean(errors.projectName)} />
          </FormField>
          <FormField label="Work order" htmlFor={`${id}-wo`} error={errors.workOrder} required className="md:col-span-2">
            <Input id={`${id}-wo`} name="workOrder" defaultValue={values.workOrder} maxLength={80} required className="font-mono" autoComplete="off" invalid={Boolean(errors.workOrder)} />
          </FormField>
        </div>
      </section>

      <section className="theme-transition rounded-panel border border-line bg-panel">
        <Step
          number={3}
          title="Schedule"
          hint={`Times are ${timeZone} wall-clock. ${locked ? 'The kit is set aside for handover, so the schedule is locked; revert to reserved to change it.' : 'Collection defaults to the booking start and the expected return to the booking end.'}`}
        />
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <FormField label="Booking start" htmlFor={`${id}-start`} error={errors.bookingStart} required>
            <Input id={`${id}-start`} name="bookingStart" type="datetime-local" step={900} defaultValue={values.bookingStart} readOnly={locked} required invalid={Boolean(errors.bookingStart)} />
          </FormField>
          <FormField label="Booking end" htmlFor={`${id}-end`} error={errors.bookingEnd} required>
            <Input id={`${id}-end`} name="bookingEnd" type="datetime-local" step={900} defaultValue={values.bookingEnd} readOnly={locked} required invalid={Boolean(errors.bookingEnd)} />
          </FormField>
          <FormField label="Collection" htmlFor={`${id}-collection`} error={errors.collectionDate} hint="Optional; up to 24 hours before the booking starts.">
            <Input id={`${id}-collection`} name="collectionDate" type="datetime-local" step={900} defaultValue={values.collectionDate} readOnly={locked} invalid={Boolean(errors.collectionDate)} />
          </FormField>
          <FormField label="Expected return" htmlFor={`${id}-return`} error={errors.expectedReturnDate} hint="Optional; not later than the booking end.">
            <Input id={`${id}-return`} name="expectedReturnDate" type="datetime-local" step={900} defaultValue={values.expectedReturnDate} readOnly={locked} invalid={Boolean(errors.expectedReturnDate)} />
          </FormField>
        </div>
      </section>

      <section className="theme-transition rounded-panel border border-line bg-panel">
        <Step number={4} title="Review" hint={`${values.requesterName || 'The requester'} receives ${kitLabel}.`} />
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <div className="rounded-lg border border-line bg-panel-header px-4 py-3 md:col-span-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">Prepared by</p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">
              {preparedBy} <span className="font-normal text-muted">· Engineer / Technician</span>
            </p>
            <p className="mt-0.5 text-xs text-muted">Taken from your signed-in account when the booking is saved. It cannot be typed or changed here.</p>
          </div>
          <FormField label="Purpose" htmlFor={`${id}-purpose`} error={errors.purpose} hint="Programme, project or job reference.">
            <Input id={`${id}-purpose`} name="purpose" defaultValue={values.purpose} maxLength={300} placeholder="e.g. Documentary rough cut, Studio 2" />
          </FormField>
          <FormField label="Notes" htmlFor={`${id}-notes`} error={errors.notes}>
            <Textarea id={`${id}-notes`} name="notes" defaultValue={values.notes} maxLength={2000} placeholder="Anything the engineer should know before the handover." />
          </FormField>
          {mode === 'edit' ? (
            <FormField label="Reason for change" htmlFor={`${id}-reason`} error={errors.reason} required className="md:col-span-2" hint="Recorded in the booking's history with what changed.">
              <Input id={`${id}-reason`} name="reason" maxLength={500} required invalid={Boolean(errors.reason)} placeholder="e.g. Shoot moved to Thursday at the client's request" />
            </FormField>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
          {mode === 'create' ? (
            <>
              <Button type="submit" name="intent" value="reserve" disabled={pending || !ready} aria-busy={pending} title={ready ? undefined : 'The kit is not ready to be reserved'}>
                {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <CalendarCheck aria-hidden className="h-4 w-4" />}
                Reserve kit
              </Button>
              <Button type="submit" name="intent" value="draft" variant="secondary" disabled={pending} aria-busy={pending}>
                <Save aria-hidden className="h-4 w-4" />
                Save as draft
              </Button>
            </>
          ) : (
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Save aria-hidden className="h-4 w-4" />}
              Save changes
            </Button>
          )}
          <Link href={cancelHref} className={buttonVariants({ variant: 'ghost' })}>
            Cancel
          </Link>
          {mode === 'create' ? <p className="text-xs text-muted">A draft holds nothing; reserving checks the kit’s readiness and the free window and then holds the kit. The checklist is prepared next.</p> : null}
        </div>
      </section>
    </form>
  )
}
