'use client'

import { CheckCheck, LoaderCircle, PlayCircle, RotateCcw, UserRound, XCircle } from 'lucide-react'
import { useActionState, useId, useState } from 'react'

import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  assignIssueFormAction,
  closeIssueFormAction,
  type IssueFormState,
  investigateIssueFormAction,
  reopenIssueFormAction,
  resolveIssueFormAction,
} from '@/server/actions/issues.actions'
import type { AssigneeOption } from '@/server/dal/issues.dal'

/**
 * Working an issue: pick it up, say what was done, close it, or reopen it when
 * the fault comes back.
 *
 * Each action is its own small form, so the page never asks for information
 * that the current step does not need. Every one of them re-checks the
 * transition on the server: these buttons are a convenience, not the rule.
 */

function Busy({ pending, children, icon: Icon }: { pending: boolean; children: React.ReactNode; icon: typeof PlayCircle }) {
  return (
    <>
      {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Icon aria-hidden className="h-4 w-4" />}
      {children}
    </>
  )
}

export function InvestigateForm({ issueId }: { issueId: string }) {
  const [state, formAction, pending] = useActionState<IssueFormState, FormData>(investigateIssueFormAction, null)
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="issueId" value={issueId} />
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
        <Busy pending={pending} icon={PlayCircle}>
          I am looking at this
        </Busy>
      </Button>
      <p className="text-xs text-muted">Marks it as being investigated and puts your name on it if nobody else has it.</p>
    </form>
  )
}

export function ResolveForm({ issueId }: { issueId: string }) {
  const [state, formAction, pending] = useActionState<IssueFormState, FormData>(resolveIssueFormAction, null)
  const id = useId()
  return (
    <form action={formAction} noValidate className="space-y-3">
      <input type="hidden" name="issueId" value={issueId} />
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
      <FormField label="What was done about it" htmlFor={`${id}-resolution`} error={state && !state.ok ? state.fieldErrors?.resolution : undefined}>
        <Textarea id={`${id}-resolution`} name="resolution" rows={3} maxLength={2000} placeholder="Replaced the adapter from spares; the laptop itself is fine." />
      </FormField>
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
        <Busy pending={pending} icon={CheckCheck}>
          Mark resolved
        </Busy>
      </Button>
    </form>
  )
}

export function CloseForm({ issueId, needsReason }: { issueId: string; needsReason: boolean }) {
  const [state, formAction, pending] = useActionState<IssueFormState, FormData>(closeIssueFormAction, null)
  const id = useId()
  return (
    <form action={formAction} noValidate className="space-y-3">
      <input type="hidden" name="issueId" value={issueId} />
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
      {needsReason ? (
        <FormField
          label="Why is it being closed"
          htmlFor={`${id}-resolution`}
          hint="Closing something that was never fixed needs a reason on the record."
          error={state && !state.ok ? state.fieldErrors?.resolution : undefined}
        >
          <Textarea id={`${id}-resolution`} name="resolution" rows={2} maxLength={2000} placeholder="Reported in error - the cable was in the other case." />
        </FormField>
      ) : null}
      <Button type="submit" variant={needsReason ? 'secondary' : 'primary'} size="lg" disabled={pending} aria-busy={pending}>
        <Busy pending={pending} icon={XCircle}>
          {needsReason ? 'Close without a fix' : 'Close issue'}
        </Busy>
      </Button>
    </form>
  )
}

export function ReopenForm({ issueId }: { issueId: string }) {
  const [state, formAction, pending] = useActionState<IssueFormState, FormData>(reopenIssueFormAction, null)
  const [open, setOpen] = useState(false)
  const id = useId()

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden className="h-4 w-4" />
        Reopen
      </Button>
    )
  }

  return (
    <form action={formAction} noValidate className="space-y-3">
      <input type="hidden" name="issueId" value={issueId} />
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
      <FormField label="Why reopen it" htmlFor={`${id}-reason`} error={state && !state.ok ? state.fieldErrors?.reason : undefined}>
        <Textarea id={`${id}-reason`} name="reason" rows={2} maxLength={500} placeholder="The same fault came back on the next hand-out." />
      </FormField>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          <Busy pending={pending} icon={RotateCcw}>
            Reopen issue
          </Busy>
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function AssignForm({ issueId, assignees, current }: { issueId: string; assignees: AssigneeOption[]; current: string | null }) {
  const [state, formAction, pending] = useActionState<IssueFormState, FormData>(assignIssueFormAction, null)
  const id = useId()
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="issueId" value={issueId} />
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
      <FormField label="Assigned to" htmlFor={`${id}-assignee`}>
        <div className="flex items-center gap-2">
          <Select id={`${id}-assignee`} name="assignedToId" defaultValue={current ?? ''} className="h-11">
            <option value="">Nobody yet</option>
            {assignees.map((assignee) => (
              <option key={assignee.id} value={assignee.id}>
                {assignee.name}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary" size="lg" disabled={pending} aria-busy={pending}>
            <Busy pending={pending} icon={UserRound}>
              Save
            </Busy>
          </Button>
        </div>
      </FormField>
    </form>
  )
}
