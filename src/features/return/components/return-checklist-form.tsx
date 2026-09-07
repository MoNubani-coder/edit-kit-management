'use client'

import { LoaderCircle, Save } from 'lucide-react'
import { useActionState, useId } from 'react'

import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { CHECKLIST_STATUS_LABELS, CHECKLIST_STATUSES } from '@/lib/validation/handover'
import { type ReturnFormState, saveReturnChecklistFormAction } from '@/server/actions/return.actions'
import type { ReturnChecklistLine } from '@/server/dal/return.dal'

/**
 * The booking's own return-phase checks - copied from the template when the
 * handover started, so they are the checks that applied to this booking rather
 * than whatever the template says today.
 */
export function ReturnChecklistForm({ bookingId, checklist, disabled }: { bookingId: string; checklist: ReturnChecklistLine[]; disabled: boolean }) {
  const [state, formAction, pending] = useActionState<ReturnFormState, FormData>(saveReturnChecklistFormAction, null)
  const id = useId()

  if (checklist.length === 0) {
    return <p className="text-sm text-muted">This booking has no return-phase checks. Nothing to answer here.</p>
  }

  return (
    <form action={formAction} noValidate className="space-y-5">
      <input type="hidden" name="bookingId" value={bookingId} />
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}

      <ul className="divide-y divide-line rounded-lg border border-line">
        {checklist.map((item) => (
          <li key={item.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_11rem_minmax(0,16rem)]">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{item.label}</span>
                {item.isRequired ? <Badge tone="blue">Required</Badge> : <Badge tone="neutral">Optional</Badge>}
                {item.phase === 'BOTH' ? <Badge tone="neutral">Both phases</Badge> : null}
              </p>
              {item.description ? <p className="mt-0.5 text-xs text-muted">{item.description}</p> : null}
            </div>
            <div>
              <label className="sr-only" htmlFor={`${id}-status-${item.id}`}>
                Result of {item.label}
              </label>
              <Select id={`${id}-status-${item.id}`} name={`check.${item.id}.status`} defaultValue={item.result?.status ?? ''} disabled={disabled} className="h-11 text-base">
                <option value="">Not answered</option>
                {CHECKLIST_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {CHECKLIST_STATUS_LABELS[option]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="sr-only" htmlFor={`${id}-notes-${item.id}`}>
                Notes for {item.label}
              </label>
              <Input id={`${id}-notes-${item.id}`} name={`check.${item.id}.notes`} defaultValue={item.result?.notes ?? ''} maxLength={500} placeholder="Notes (optional)" disabled={disabled} className="h-11" />
            </div>
          </li>
        ))}
      </ul>

      {!disabled ? (
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Save aria-hidden className="h-4 w-4" />}
          Save return checks
        </Button>
      ) : null}
    </form>
  )
}
