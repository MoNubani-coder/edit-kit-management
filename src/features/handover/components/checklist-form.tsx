'use client'

import { LoaderCircle, Pencil, Save } from 'lucide-react'
import { useActionState, useId, useState } from 'react'

import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDateTime } from '@/lib/datetime'
import { cn } from '@/lib/utils/cn'
import { CHECKLIST_STATUS_LABELS, CHECKLIST_STATUSES } from '@/lib/validation/handover'
import { type HandoverFormState, saveChecklistFormAction } from '@/server/actions/handover.actions'
import type { HandoverChecklistLine } from '@/server/dal/handover.dal'

/**
 * Step 2 of the handover: a review of the checklist that was prepared on the
 * booking before the kit was set aside.
 *
 * The answers arrive already carried into this handover, so the default view is
 * read-only: the engineer reads them through and moves on. "Amend" opens the
 * same controls the preparation used, for the case where something changed
 * between preparing the kit and handing it over. Software is no longer part of
 * this step: it does not gate a handover.
 */

const SEGMENT = 'flex-1 cursor-pointer select-none rounded-md border px-3 py-2.5 text-center text-sm font-medium transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-foreground'

const ANSWER_TONE: Record<string, 'green' | 'red' | 'neutral'> = { PASS: 'green', FAIL: 'red', NOT_APPLICABLE: 'neutral' }

export function ChecklistForm({
  bookingId,
  checklist,
  preparedAt,
  timeZone,
  disabled,
}: {
  bookingId: string
  checklist: HandoverChecklistLine[]
  /** When the booking's checklist was finished during preparation, if it was. */
  preparedAt: Date | null
  timeZone: string
  disabled: boolean
}) {
  const [state, formAction, pending] = useActionState<HandoverFormState, FormData>(saveChecklistFormAction, null)
  const [amending, setAmending] = useState(false)
  const id = useId()

  const answered = checklist.filter((item) => item.result).length
  const unanswered = checklist.filter((item) => item.isRequired && !item.result).length
  // Nothing prepared and nothing answered: there is nothing to review yet, so
  // the controls open straight away rather than behind an "Amend" button.
  const editing = !disabled && (amending || answered === 0)

  if (checklist.length === 0) {
    return <p className="text-sm text-muted">This booking has no checklist. The handover can proceed without checks.</p>
  }

  return (
    <form action={formAction} noValidate className="space-y-5">
      <input type="hidden" name="bookingId" value={bookingId} />
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-muted">
          {answered} of {checklist.length} answered
          {preparedAt ? <> · prepared {formatDateTime(preparedAt, timeZone)}</> : null}
          {unanswered > 0 ? <span className="ml-2 text-amber-800 dark:text-amber-300">{unanswered} required {unanswered === 1 ? 'check' : 'checks'} still unanswered</span> : null}
        </p>
        {!disabled && !editing ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setAmending(true)}>
            <Pencil aria-hidden className="h-4 w-4" />
            Amend answers
          </Button>
        ) : null}
      </div>

      <ol className="divide-y divide-line rounded-lg border border-line">
        {checklist.map((item, index) => (
          <li key={item.id} className={cn('grid gap-3 p-4', editing ? 'lg:grid-cols-[minmax(0,1fr)_21rem_minmax(0,14rem)]' : 'lg:grid-cols-[minmax(0,1fr)_10rem_minmax(0,18rem)]')}>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                <span className="font-mono text-xs text-subtle">{String(index + 1).padStart(2, '0')}</span>
                {item.label}
                {item.isRequired ? <Badge tone="blue">Required</Badge> : <Badge tone="neutral">Optional</Badge>}
              </p>
              {item.description ? <p className="mt-0.5 text-xs text-muted">{item.description}</p> : null}
              {item.prepared?.at ? (
                <p className="mt-0.5 text-[11px] text-subtle">
                  Prepared {formatDateTime(item.prepared.at, timeZone)}
                  {item.prepared.byName ? ` by ${item.prepared.byName}` : ''}
                </p>
              ) : null}
            </div>

            {editing ? (
              <>
                <fieldset className="flex gap-2" aria-label={`Result for ${item.label}`}>
                  {CHECKLIST_STATUSES.map((option) => (
                    <label key={option} className={cn(SEGMENT, option === 'FAIL' ? 'has-[:checked]:border-rose-400 has-[:checked]:bg-rose-50 has-[:checked]:text-rose-800 dark:has-[:checked]:bg-rose-400/10 dark:has-[:checked]:text-rose-200' : '', 'border-line-strong text-muted')}>
                      <input type="radio" name={`check.${item.id}.status`} value={option} defaultChecked={item.result?.status === option} className="sr-only" />
                      {CHECKLIST_STATUS_LABELS[option]}
                    </label>
                  ))}
                </fieldset>
                <div>
                  <label className="sr-only" htmlFor={`${id}-note-${item.id}`}>
                    Notes for {item.label}
                  </label>
                  <Input id={`${id}-note-${item.id}`} name={`check.${item.id}.notes`} defaultValue={item.result?.notes ?? ''} maxLength={500} placeholder="Notes (optional)" className="h-11" />
                </div>
              </>
            ) : (
              <>
                <div>
                  {item.result ? (
                    <Badge tone={ANSWER_TONE[item.result.status] ?? 'neutral'} dot>
                      {CHECKLIST_STATUS_LABELS[item.result.status]}
                    </Badge>
                  ) : (
                    <Badge tone="amber" dot>
                      Not answered
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted">{item.result?.notes ?? <span className="text-subtle">—</span>}</p>
              </>
            )}
          </li>
        ))}
      </ol>

      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
            {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Save aria-hidden className="h-4 w-4" />}
            Save checklist
          </Button>
          {answered > 0 ? (
            <Button type="button" variant="ghost" size="lg" onClick={() => setAmending(false)} disabled={pending}>
              Keep as prepared
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}
