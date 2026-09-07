'use client'

import { CheckCheck, LoaderCircle, PlayCircle } from 'lucide-react'
import { useActionState, useId, useState } from 'react'

import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { completeHandoverFormAction, type HandoverFormState, startHandoverFormAction } from '@/server/actions/handover.actions'

/** Opens the handover: snapshots the kit's contents, software and checklist. */
export function StartHandoverForm({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState<HandoverFormState, FormData>(startHandoverFormAction, null)
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="bookingId" value={bookingId} />
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
        {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <PlayCircle aria-hidden className="h-4 w-4" />}
        Start handover
      </Button>
    </form>
  )
}

/**
 * The final step. Disabled until the server says every check is in place; the
 * server checks everything again inside the completing transaction anyway.
 */
export function CompleteHandoverForm({ bookingId, bookingNumber, editorName, kitCode, ready }: { bookingId: string; bookingNumber: string; editorName: string; kitCode: string; ready: boolean }) {
  const [state, formAction, pending] = useActionState<HandoverFormState, FormData>(completeHandoverFormAction, null)
  const [confirmed, setConfirmed] = useState(false)
  const id = useId()

  return (
    <form action={formAction} noValidate className="space-y-4">
      <input type="hidden" name="bookingId" value={bookingId} />
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
      <label className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${ready ? 'border-line-strong text-foreground' : 'border-line text-muted'}`}>
        <input id={`${id}-confirm`} type="checkbox" name="confirm" value="true" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={!ready || pending} className="mt-0.5 h-5 w-5 rounded border-line-strong accent-[var(--accent)]" />
        <span>
          I confirm that kit <span className="font-mono font-semibold">{kitCode}</span> and the equipment recorded above have been handed to <span className="font-semibold">{editorName}</span> under booking{' '}
          <span className="font-mono font-semibold">{bookingNumber}</span>.
        </span>
      </label>
      <Button type="submit" size="lg" disabled={!ready || !confirmed || pending} aria-busy={pending} className="w-full sm:w-auto">
        {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <CheckCheck aria-hidden className="h-4 w-4" />}
        Complete handover
      </Button>
      <p className="text-xs text-muted">Sets the collection time to now, marks the booking checked out and the kit and its equipment as out. Cannot be undone from here.</p>
    </form>
  )
}
