'use client'

import { CheckCheck, LoaderCircle, PackageCheck } from 'lucide-react'
import { useActionState, useId, useState } from 'react'

import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { completeReturnFormAction, type ReturnFormState, startReturnFormAction } from '@/server/actions/return.actions'

/** Opens the return: copies the handover document into a return document. */
export function StartReturnForm({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState<ReturnFormState, FormData>(startReturnFormAction, null)
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="bookingId" value={bookingId} />
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
        {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <PackageCheck aria-hidden className="h-4 w-4" />}
        Start return inspection
      </Button>
    </form>
  )
}

/**
 * The final step. Disabled until the server says everything handed over has an
 * answer and the engineer has signed; the server checks it all again inside the
 * completing transaction anyway.
 */
export function CompleteReturnForm({
  bookingId,
  bookingNumber,
  kitCode,
  problemCount,
  ready,
  receivedBy,
  returnedByDefault,
}: {
  bookingId: string
  bookingNumber: string
  kitCode: string
  problemCount: number
  ready: boolean
  /** The signed-in engineer. Displayed, never posted: the server records the actor. */
  receivedBy: string
  /** Pre-fills "who returned it" with the person the booking was for. */
  returnedByDefault: string
}) {
  const [state, formAction, pending] = useActionState<ReturnFormState, FormData>(completeReturnFormAction, null)
  const [confirmed, setConfirmed] = useState(false)
  const id = useId()
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {}

  return (
    <form action={formAction} noValidate className="space-y-4">
      <input type="hidden" name="bookingId" value={bookingId} />
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}

      <div className="grid gap-4 rounded-lg border border-line bg-panel-header p-4 sm:grid-cols-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">Received by</p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">{receivedBy}</p>
          <p className="text-xs text-muted">Engineer / Technician, from your signed-in account</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">Return date</p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">Set by the server</p>
          <p className="text-xs text-muted">Stamped the moment you complete</p>
        </div>
        <FormField label="Staff who returned the kit" htmlFor={`${id}-returned-by`} error={errors.returnedByName} required hint="Whoever physically brought it back; they need no account.">
          <Input id={`${id}-returned-by`} name="returnedByName" defaultValue={returnedByDefault} maxLength={120} required autoComplete="off" invalid={Boolean(errors.returnedByName)} />
        </FormField>
      </div>
      <label className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${ready ? 'border-line-strong text-foreground' : 'border-line text-muted'}`}>
        <input
          id={`${id}-confirm`}
          type="checkbox"
          name="confirm"
          value="true"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={!ready || pending}
          className="mt-0.5 h-5 w-5 rounded border-line-strong accent-[var(--accent)]"
        />
        <span>
          I confirm that kit <span className="font-mono font-semibold">{kitCode}</span> has been received back under booking <span className="font-mono font-semibold">{bookingNumber}</span> and that the
          conditions recorded above are what I found.
        </span>
      </label>
      <Button type="submit" size="lg" disabled={!ready || !confirmed || pending} aria-busy={pending} className="w-full sm:w-auto">
        {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <CheckCheck aria-hidden className="h-4 w-4" />}
        Complete return
      </Button>
      <p className="text-xs text-muted">
        Sets the actual return time to now, completes the booking, puts each item back to the status its condition implies and re-evaluates the kit.
        {problemCount > 0 ? ` Raises ${problemCount} ${problemCount === 1 ? 'issue' : 'issues'} for the problems recorded.` : ''} Cannot be undone from here.
      </p>
    </form>
  )
}
