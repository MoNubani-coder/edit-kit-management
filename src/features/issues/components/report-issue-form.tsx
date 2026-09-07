'use client'

import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { useActionState, useId } from 'react'

import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ISSUE_SEVERITIES, ISSUE_SEVERITY_LABELS, ISSUE_TYPE_LABELS, ISSUE_TYPES } from '@/lib/validation/issues'
import { createIssueFormAction, type IssueFormState } from '@/server/actions/issues.actions'
import type { AssigneeOption } from '@/server/dal/issues.dal'

/**
 * Reporting a problem by hand.
 *
 * Most issues are raised by a return, which already knows the asset, the kit
 * and the booking. This form is for the rest: something noticed on the shelf,
 * or a fault that turns up between hand-outs. What it is about is pre-filled
 * when the report was started from an equipment or kit page.
 */
export function ReportIssueForm({
  target,
  assignees,
  cancelHref,
}: {
  target: { assetId?: string; assetLabel?: string; kitId?: string; kitLabel?: string; bookingId?: string; bookingLabel?: string }
  assignees: AssigneeOption[]
  cancelHref: string
}) {
  const [state, formAction, pending] = useActionState<IssueFormState, FormData>(createIssueFormAction, null)
  const id = useId()
  const errors = state && !state.ok ? state.fieldErrors : undefined
  const linked = [target.assetLabel, target.kitLabel, target.bookingLabel].filter(Boolean)

  return (
    <form action={formAction} noValidate className="space-y-6">
      {target.assetId ? <input type="hidden" name="assetId" value={target.assetId} /> : null}
      {target.kitId ? <input type="hidden" name="kitId" value={target.kitId} /> : null}
      {target.bookingId ? <input type="hidden" name="bookingId" value={target.bookingId} /> : null}

      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}

      {linked.length > 0 ? (
        <div className="rounded-lg border border-line bg-panel-header/50 px-4 py-3 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">About</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-foreground">
            {linked.map((label) => (
              <Badge key={label} tone="blue">
                {label}
              </Badge>
            ))}
          </p>
        </div>
      ) : (
        <Alert variant="info" title="Not linked to equipment">
          This will be recorded on its own. To attach it to a specific item, start the report from that equipment or kit page.
        </Alert>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="What kind of problem" htmlFor={`${id}-type`} error={errors?.type}>
          <Select id={`${id}-type`} name="type" defaultValue="DAMAGED" className="h-11">
            {ISSUE_TYPES.map((type) => (
              <option key={type} value={type}>
                {ISSUE_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="How serious" htmlFor={`${id}-severity`} hint="High or critical if a kit cannot go out because of it." error={errors?.severity}>
          <Select id={`${id}-severity`} name="severity" defaultValue="MEDIUM" className="h-11">
            {ISSUE_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {ISSUE_SEVERITY_LABELS[severity]}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <FormField label="Short title" htmlFor={`${id}-title`} error={errors?.title}>
        <Input id={`${id}-title`} name="title" maxLength={200} placeholder="Screen has a cracked corner" className="h-11" />
      </FormField>

      <FormField label="What is wrong" htmlFor={`${id}-description`} hint="What you saw, and anything that would help whoever picks it up." error={errors?.description}>
        <Textarea id={`${id}-description`} name="description" rows={5} maxLength={4000} placeholder="Noticed while packing the case: bottom-left corner of the panel is cracked, display still works." />
      </FormField>

      <FormField label="Assign to (optional)" htmlFor={`${id}-assignee`} error={errors?.assignedToId}>
        <Select id={`${id}-assignee`} name="assignedToId" defaultValue="" className="h-11">
          <option value="">Nobody yet</option>
          {assignees.map((assignee) => (
            <option key={assignee.id} value={assignee.id}>
              {assignee.name}
            </option>
          ))}
        </Select>
      </FormField>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <TriangleAlert aria-hidden className="h-4 w-4" />}
          Report issue
        </Button>
        <a href={cancelHref} className="text-sm text-muted hover:text-foreground hover:underline">
          Cancel
        </a>
        <p className="w-full text-xs text-muted">Photos can be added once it is reported.</p>
      </div>
    </form>
  )
}
