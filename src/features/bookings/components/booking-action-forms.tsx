'use client'

import { LoaderCircle } from 'lucide-react'
import { useActionState, useId } from 'react'

import { ConfirmSubmitButton } from '@/components/common/confirm-submit-button'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import {
  type BookingFormState,
  cancelBookingFormAction,
  markReadyFormAction,
  reserveBookingFormAction,
  returnToDraftFormAction,
  revertReadyFormAction,
} from '@/server/actions/bookings.actions'

function Failure({ state }: { state: BookingFormState }) {
  if (!state || state.ok) return null
  return (
    <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-300">
      {state.message}
    </p>
  )
}

type Transition = 'reserve' | 'draft' | 'ready' | 'revert'

const TRANSITIONS: Record<Transition, { label: string; message: string; variant: 'primary' | 'secondary' | 'ghost' }> = {
  reserve: { label: 'Reserve kit', message: 'Reserve the kit for this booking? The readiness and the free window are checked first.', variant: 'primary' },
  draft: { label: 'Release to draft', message: 'Release the reservation? The kit becomes bookable for this window by others; the booking stays as a draft.', variant: 'ghost' },
  ready: { label: 'Mark ready for handover', message: 'Set the kit aside for handover? Its readiness is re-checked and its contents are frozen until the handover or a revert.', variant: 'primary' },
  revert: { label: 'Back to reserved', message: 'Undo the handover preparation? The kit goes back on the shelf as reserved.', variant: 'ghost' },
}

const ACTIONS = {
  reserve: reserveBookingFormAction,
  draft: returnToDraftFormAction,
  ready: markReadyFormAction,
  revert: revertReadyFormAction,
}

/** One explicit lifecycle step; the server decides whether it is allowed. */
export function TransitionForm({ bookingId, transition }: { bookingId: string; transition: Transition }) {
  const [state, formAction] = useActionState<BookingFormState, FormData>(ACTIONS[transition], null)
  const config = TRANSITIONS[transition]
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={bookingId} />
      <ConfirmSubmitButton variant={config.variant} size="sm" message={config.message}>
        {config.label}
      </ConfirmSubmitButton>
      <Failure state={state} />
    </form>
  )
}

/** Cancellation needs a reason; the row and its history are kept. */
export function CancelBookingForm({ bookingId, bookingNumber }: { bookingId: string; bookingNumber: string }) {
  const [state, formAction, pending] = useActionState<BookingFormState, FormData>(cancelBookingFormAction, null)
  const id = useId()
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {}

  return (
    <form action={formAction} noValidate className="space-y-3">
      <input type="hidden" name="id" value={bookingId} />
      <FormField label="Cancellation reason" htmlFor={`${id}-reason`} error={errors.reason} required>
        <Input id={`${id}-reason`} name="reason" maxLength={500} required placeholder="e.g. Shoot postponed by the client" invalid={Boolean(errors.reason)} />
      </FormField>
      <Button
        type="submit"
        variant="danger"
        size="sm"
        disabled={pending}
        aria-busy={pending}
        onClick={(event) => {
          if (!window.confirm(`Cancel ${bookingNumber}? The kit is released for this window and the booking stays on record as cancelled.`)) event.preventDefault()
        }}
      >
        {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : null}
        Cancel booking
      </Button>
      {state && !state.ok && !errors.reason ? <Failure state={state} /> : null}
    </form>
  )
}
