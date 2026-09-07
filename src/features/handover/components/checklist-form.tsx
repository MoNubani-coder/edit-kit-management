'use client'

import { LoaderCircle, Save } from 'lucide-react'
import { useActionState, useId } from 'react'

import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { CHECKLIST_STATUS_LABELS, CHECKLIST_STATUSES, SOFTWARE_STATUS_LABELS, SOFTWARE_STATUSES } from '@/lib/validation/handover'
import { type HandoverFormState, saveChecklistFormAction } from '@/server/actions/handover.actions'
import type { HandoverChecklistLine, HandoverSoftwareLine } from '@/server/dal/handover.dal'
import { cn } from '@/lib/utils/cn'

/**
 * Step 4: the booking's own checklist (copied from the template when the
 * handover started) and the kit's software list. Required checks must pass or
 * be marked not applicable; required applications must be installed.
 */

const SEGMENT = 'flex-1 cursor-pointer select-none rounded-md border px-3 py-2.5 text-center text-sm font-medium transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-foreground'

export function ChecklistForm({
  bookingId,
  checklist,
  software,
  templateName,
  disabled,
}: {
  bookingId: string
  checklist: HandoverChecklistLine[]
  software: HandoverSoftwareLine[]
  templateName: string | null
  disabled: boolean
}) {
  const [state, formAction, pending] = useActionState<HandoverFormState, FormData>(saveChecklistFormAction, null)
  const id = useId()

  return (
    <form action={formAction} noValidate className="space-y-6">
      <input type="hidden" name="bookingId" value={bookingId} />
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}

      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Handover checks{templateName ? <span className="font-normal text-muted"> · {templateName}</span> : null}</h3>
          <span className="text-xs text-muted">{checklist.filter((item) => item.result).length} of {checklist.length} answered</span>
        </div>
        {checklist.length === 0 ? (
          <p className="text-sm text-muted">No checklist template was available when the handover started.</p>
        ) : (
          <ol className="divide-y divide-line rounded-lg border border-line">
            {checklist.map((item, index) => (
              <li key={item.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_21rem_minmax(0,14rem)]">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    <span className="font-mono text-xs text-subtle">{String(index + 1).padStart(2, '0')}</span>
                    {item.label}
                    {item.isRequired ? <Badge tone="blue">Required</Badge> : <Badge tone="neutral">Optional</Badge>}
                  </p>
                  {item.description ? <p className="mt-0.5 text-xs text-muted">{item.description}</p> : null}
                </div>
                <fieldset className="flex gap-2" aria-label={`Result for ${item.label}`}>
                  {CHECKLIST_STATUSES.map((option) => (
                    <label key={option} className={cn(SEGMENT, option === 'FAIL' ? 'has-[:checked]:border-rose-400 has-[:checked]:bg-rose-50 has-[:checked]:text-rose-800 dark:has-[:checked]:bg-rose-400/10 dark:has-[:checked]:text-rose-200' : '', 'border-line-strong text-muted', disabled && 'cursor-default opacity-70')}>
                      <input type="radio" name={`check.${item.id}.status`} value={option} defaultChecked={item.result?.status === option} disabled={disabled} className="sr-only" />
                      {CHECKLIST_STATUS_LABELS[option]}
                    </label>
                  ))}
                </fieldset>
                <div>
                  <label className="sr-only" htmlFor={`${id}-note-${item.id}`}>
                    Notes for {item.label}
                  </label>
                  <Input id={`${id}-note-${item.id}`} name={`check.${item.id}.notes`} defaultValue={item.result?.notes ?? ''} maxLength={500} placeholder="Notes (optional)" disabled={disabled} className="h-11" />
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          Software on the workstation <span className="font-normal text-muted">· {software.length} {software.length === 1 ? 'application' : 'applications'}</span>
        </h3>
        {software.length === 0 ? (
          <p className="text-sm text-muted">This kit lists no software to verify.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {software.map((check) => (
              <li key={check.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_12rem_10rem_minmax(0,12rem)]">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    {check.nameSnapshot}
                    {check.versionSnapshot ? <span className="font-mono text-xs text-muted">{check.versionSnapshot}</span> : null}
                    {check.isRequired ? <Badge tone="blue">Required</Badge> : <Badge tone="neutral">Optional</Badge>}
                  </p>
                  {check.vendorSnapshot ? <p className="text-xs text-muted">{check.vendorSnapshot}</p> : null}
                </div>
                <div>
                  <label className="sr-only" htmlFor={`${id}-sw-${check.id}`}>
                    Status of {check.nameSnapshot}
                  </label>
                  <Select id={`${id}-sw-${check.id}`} name={`software.${check.id}.status`} defaultValue={check.status} disabled={disabled} className="h-11">
                    {SOFTWARE_STATUSES.map((option) => (
                      <option key={option} value={option}>
                        {SOFTWARE_STATUS_LABELS[option]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="sr-only" htmlFor={`${id}-swv-${check.id}`}>
                    Installed version of {check.nameSnapshot}
                  </label>
                  <Input id={`${id}-swv-${check.id}`} name={`software.${check.id}.installedVersion`} defaultValue={check.installedVersion ?? ''} maxLength={60} placeholder="Installed version" disabled={disabled} className="h-11 font-mono" />
                </div>
                <div>
                  <label className="sr-only" htmlFor={`${id}-swn-${check.id}`}>
                    Notes for {check.nameSnapshot}
                  </label>
                  <Input id={`${id}-swn-${check.id}`} name={`software.${check.id}.notes`} defaultValue={check.notes ?? ''} maxLength={500} placeholder="Notes (optional)" disabled={disabled} className="h-11" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!disabled ? (
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Save aria-hidden className="h-4 w-4" />}
          Save checklist and software
        </Button>
      ) : null}
    </form>
  )
}
