'use client'

import { CalendarCheck, LoaderCircle, Save } from 'lucide-react'
import Link from 'next/link'
import { useActionState, useId } from 'react'

import { Alert } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { EditScope } from '@/lib/booking-rules'
import { type BookingFormState, createBookingFormAction, updateBookingFormAction } from '@/server/actions/bookings.actions'
import type { EngineerOption } from '@/server/dal/bookings.dal'

/**
 * Sections 3 and 4 of the booking form - schedule and review - posting to the
 * Server Action with the editor and kit chosen in sections 1 and 2 as hidden
 * fields. Dates are wall-clock values in the business time zone; the server
 * converts and validates them, and the database constraints have the last word.
 */

export interface BookingFormValues {
  id?: string
  editorId: string
  kitId: string
  engineerId: string
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
  engineers,
  scope = 'full',
  summary,
  timeZone,
  cancelHref,
  ready,
}: {
  mode: 'create' | 'edit'
  values: BookingFormValues
  engineers: EngineerOption[]
  /** Edit only: how much of the booking may change in its current status. */
  scope?: EditScope
  /** What is being booked, for the review line. */
  summary: { editor: string; kit: string }
  timeZone: string
  cancelHref: string
  /** Create only: whether the chosen kit and editor allow "Reserve now". */
  ready: boolean
}) {
  const [state, formAction, pending] = useActionState<BookingFormState, FormData>(
    mode === 'create' ? createBookingFormAction : updateBookingFormAction,
    null,
  )
  const id = useId()
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {}
  const locked = scope === 'restricted'

  return (
    <form action={formAction} noValidate className="space-y-6">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <input type="hidden" name="editorId" value={values.editorId} />
      <input type="hidden" name="kitId" value={values.kitId} />
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
      {errors.editorId ? <Alert variant="error">{errors.editorId}</Alert> : null}
      {errors.kitId ? <Alert variant="error">{errors.kitId}</Alert> : null}

      <section className="theme-transition rounded-panel border border-line bg-panel">
        <header className="border-b border-line bg-panel-header px-5 py-3">
          <h2 className="font-display text-[15px] font-semibold text-foreground">
            <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft font-mono text-xs text-accent-foreground">3</span>
            Schedule
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Times are {timeZone} wall-clock. {locked ? 'The kit is set aside for handover, so the schedule is locked; revert to reserved to change it.' : 'Collection defaults to the booking start and the expected return to the booking end.'}
          </p>
        </header>
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
        <header className="border-b border-line bg-panel-header px-5 py-3">
          <h2 className="font-display text-[15px] font-semibold text-foreground">
            <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft font-mono text-xs text-accent-foreground">4</span>
            Review
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            <span className="font-medium text-foreground">{summary.editor}</span> receives <span className="font-mono text-foreground">{summary.kit}</span>.
          </p>
        </header>
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <FormField label="Responsible engineer" htmlFor={`${id}-engineer`} error={errors.engineerId} required hint="Who prepares and hands over the kit.">
            <Select id={`${id}-engineer`} name="engineerId" defaultValue={values.engineerId} required invalid={Boolean(errors.engineerId)}>
              <option value="">Choose an engineer…</option>
              {engineers.map((engineer) => (
                <option key={engineer.id} value={engineer.id}>
                  {engineer.fullName}
                  {engineer.staffId ? ` · ${engineer.staffId}` : ''}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Purpose" htmlFor={`${id}-purpose`} error={errors.purpose} hint="Programme, project or job reference.">
            <Input id={`${id}-purpose`} name="purpose" defaultValue={values.purpose} maxLength={300} placeholder="e.g. Documentary rough cut, Studio 2" />
          </FormField>
          <FormField label="Notes" htmlFor={`${id}-notes`} error={errors.notes} className="md:col-span-2">
            <Textarea id={`${id}-notes`} name="notes" defaultValue={values.notes} maxLength={2000} placeholder="Anything the engineer should know before the handover." />
          </FormField>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
          {mode === 'create' ? (
            <>
              <Button type="submit" name="intent" value="reserve" disabled={pending || !ready} aria-busy={pending} title={ready ? undefined : 'The kit is not ready or the editor cannot be booked'}>
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
          {mode === 'create' ? <p className="text-xs text-muted">A draft holds nothing; reserving checks the kit’s readiness and the free window and then holds the kit.</p> : null}
        </div>
      </section>
    </form>
  )
}
