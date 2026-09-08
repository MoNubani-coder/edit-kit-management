'use client'

import { LoaderCircle, Save } from 'lucide-react'
import { useActionState, useId } from 'react'

import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDateTime } from '@/lib/datetime'
import { cn } from '@/lib/utils/cn'
import { CHECKLIST_STATUS_LABELS, CHECKLIST_STATUSES } from '@/lib/validation/handover'
import { type BookingFormState, prepareChecklistFormAction } from '@/server/actions/bookings.actions'
import type { BookingChecklistItemRow } from '@/server/dal/handover.dal'

/**
 * Answering the handover checks while the booking is being prepared. The same
 * three answers the handover uses - pass, fail, not applicable - with a note
 * per check, so what the engineer found is on the record before the kit is
 * even set aside.
 */

const SEGMENT = 'flex-1 cursor-pointer select-none rounded-md border px-3 py-2.5 text-center text-sm font-medium transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-foreground'

export function PrepareChecklistForm({ bookingId, items, disabled, timeZone }: { bookingId: string; items: BookingChecklistItemRow[]; disabled: boolean; timeZone: string }) {
  const [state, formAction, pending] = useActionState<BookingFormState, FormData>(prepareChecklistFormAction, null)
  const id = useId()

  return (
    <form action={formAction} noValidate className="space-y-5">
      <input type="hidden" name="id" value={bookingId} />
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}

      <ol className="divide-y divide-line rounded-lg border border-line">
        {items.map((item, index) => (
          <li key={item.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_21rem_minmax(0,14rem)]">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                <span className="font-mono text-xs text-subtle">{String(index + 1).padStart(2, '0')}</span>
                {item.label}
                {item.isRequired ? <Badge tone="blue">Required</Badge> : <Badge tone="neutral">Optional</Badge>}
              </p>
              {item.description ? <p className="mt-0.5 text-xs text-muted">{item.description}</p> : null}
              {item.preparedAt ? (
                <p className="mt-0.5 text-[11px] text-subtle">
                  Answered {formatDateTime(item.preparedAt, timeZone)}
                  {item.preparedByName ? ` by ${item.preparedByName}` : ''}
                </p>
              ) : null}
            </div>
            <fieldset className="flex gap-2" aria-label={`Result for ${item.label}`}>
              {CHECKLIST_STATUSES.map((option) => (
                <label
                  key={option}
                  className={cn(
                    SEGMENT,
                    option === 'FAIL' ? 'has-[:checked]:border-rose-400 has-[:checked]:bg-rose-50 has-[:checked]:text-rose-800 dark:has-[:checked]:bg-rose-400/10 dark:has-[:checked]:text-rose-200' : '',
                    'border-line-strong text-muted',
                    disabled && 'cursor-default opacity-70',
                  )}
                >
                  <input type="radio" name={`check.${item.id}.status`} value={option} defaultChecked={item.preparedStatus === option} disabled={disabled} className="sr-only" />
                  {CHECKLIST_STATUS_LABELS[option]}
                </label>
              ))}
            </fieldset>
            <div>
              <label className="sr-only" htmlFor={`${id}-note-${item.id}`}>
                Notes for {item.label}
              </label>
              <Input id={`${id}-note-${item.id}`} name={`check.${item.id}.notes`} defaultValue={item.preparedNotes ?? ''} maxLength={500} placeholder="Notes (optional)" disabled={disabled} className="h-11" />
            </div>
          </li>
        ))}
      </ol>

      {!disabled ? (
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Save aria-hidden className="h-4 w-4" />}
          Save checklist
        </Button>
      ) : null}
    </form>
  )
}
