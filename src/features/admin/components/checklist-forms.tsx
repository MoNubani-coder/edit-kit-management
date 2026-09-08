'use client'

import { LoaderCircle, Plus, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useActionState, useId } from 'react'
import { useFormStatus } from 'react-dom'

import { Alert } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { CHECKLIST_PHASE_LABELS, CHECKLIST_PHASES, type ChecklistPhaseValue } from '@/lib/validation/admin'
import {
  addItemFormAction,
  type AdminFormState,
  createTemplateFormAction,
  removeItemFormAction,
  setTemplateActiveFormAction,
  setTemplateDefaultFormAction,
  updateItemFormAction,
  updateTemplateFormAction,
} from '@/server/actions/admin.actions'

/**
 * The checklist template editor.
 *
 * A template is a list of checks with a phase: handover, return, or both. When
 * a handover starts, the booking copies the template's items, and from then on
 * the booking's copy is its own record - which is why editing a template never
 * touches a booking that has already used it, and why an item that has been
 * copied cannot be removed.
 */

function Failure({ state }: { state: AdminFormState }) {
  if (!state || state.ok) return null
  return (
    <p role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-300">
      {state.message}
    </p>
  )
}

function Submit({ children, variant = 'ghost', size = 'sm' }: { children: React.ReactNode; variant?: 'ghost' | 'primary' | 'secondary'; size?: 'sm' | 'md' }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} aria-busy={pending}>
      {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : null}
      {children}
    </Button>
  )
}

// -----------------------------------------------------------------------------
// The template itself
// -----------------------------------------------------------------------------

export interface TemplateFormValues {
  id?: string
  name: string
  description: string
}

export function ChecklistTemplateForm({ values, cancelHref }: { values: TemplateFormValues; cancelHref: string }) {
  const editing = Boolean(values.id)
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(editing ? updateTemplateFormAction : createTemplateFormAction, null)
  const id = useId()
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {}

  return (
    <form action={formAction} noValidate className="theme-transition rounded-panel border border-accent/40 bg-panel">
      <header className="border-b border-line bg-panel-header px-5 py-3">
        <h3 className="font-display text-[15px] font-semibold text-foreground">{editing ? 'Edit template' : 'New template'}</h3>
      </header>
      <div className="space-y-5 p-5">
        {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <div className="grid gap-5 md:grid-cols-2">
          <FormField label="Name" htmlFor={`${id}-name`} error={errors.name} required>
            <Input id={`${id}-name`} name="name" defaultValue={values.name} maxLength={120} required invalid={Boolean(errors.name)} />
          </FormField>
          <FormField label="Description" htmlFor={`${id}-description`} error={errors.description} hint="What this template is for, e.g. the standard MacBook kit.">
            <Input id={`${id}-description`} name="description" defaultValue={values.description} maxLength={500} />
          </FormField>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
            {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : null}
            {editing ? 'Save template' : 'Create template'}
          </Button>
          <Link href={cancelHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Cancel
          </Link>
        </div>
      </div>
    </form>
  )
}

export function TemplateActiveToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(setTemplateActiveFormAction, null)
  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="isActive" value={isActive ? 'false' : 'true'} />
      <Submit>{isActive ? 'Deactivate' : 'Activate'}</Submit>
      <Failure state={state} />
    </form>
  )
}

export function TemplateDefaultButton({ id }: { id: string }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(setTemplateDefaultFormAction, null)
  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="id" value={id} />
      <Submit>Make default</Submit>
      <Failure state={state} />
    </form>
  )
}

// -----------------------------------------------------------------------------
// The checks
// -----------------------------------------------------------------------------

export interface ItemFormValues {
  itemId?: string
  templateId: string
  label: string
  description: string
  phase: ChecklistPhaseValue
  isRequired: boolean
  sortOrder: number
}

export function ChecklistItemForm({ values, cancelHref }: { values: ItemFormValues; cancelHref: string }) {
  const editing = Boolean(values.itemId)
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(editing ? updateItemFormAction : addItemFormAction, null)
  const id = useId()
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {}

  return (
    <form action={formAction} noValidate className="theme-transition rounded-lg border border-accent/40 bg-panel-header p-4">
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
      {editing ? <input type="hidden" name="itemId" value={values.itemId} /> : <input type="hidden" name="templateId" value={values.templateId} />}

      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Check" htmlFor={`${id}-label`} error={errors.label} required className="md:col-span-2">
          <Input id={`${id}-label`} name="label" defaultValue={values.label} maxLength={200} required invalid={Boolean(errors.label)} placeholder="e.g. Battery health above 80%" />
        </FormField>
        <FormField label="Detail" htmlFor={`${id}-description`} error={errors.description} className="md:col-span-2" hint="Shown under the check on the handover form.">
          <Input id={`${id}-description`} name="description" defaultValue={values.description} maxLength={500} />
        </FormField>
        <FormField label="When it applies" htmlFor={`${id}-phase`} error={errors.phase}>
          <Select id={`${id}-phase`} name="phase" defaultValue={values.phase}>
            {CHECKLIST_PHASES.map((phase) => (
              <option key={phase} value={phase}>
                {CHECKLIST_PHASE_LABELS[phase]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Sort order" htmlFor={`${id}-sort`} error={errors.sortOrder}>
          <Input id={`${id}-sort`} name="sortOrder" type="number" inputMode="numeric" min={0} max={999} defaultValue={values.sortOrder} />
        </FormField>
      </div>

      <label className="mt-4 flex items-start gap-3 text-sm text-foreground">
        <input type="checkbox" name="isRequired" value="true" defaultChecked={values.isRequired} className="mt-0.5 h-4 w-4 rounded border-line-strong accent-[var(--accent)]" />
        <span>
          Required
          <span className="mt-0.5 block text-xs text-muted">A required check must pass, or be marked not applicable, before a handover can be completed.</span>
        </span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />}
          {editing ? 'Save check' : 'Add check'}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Cancel
        </Link>
      </div>
    </form>
  )
}

/** Removal is refused server-side once a booking has copied the check. */
export function ChecklistItemRemoveButton({ itemId, used }: { itemId: string; used: number }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(removeItemFormAction, null)

  if (used > 0) {
    return (
      <span className="text-[11px] text-subtle" title={`Used on ${used} ${used === 1 ? 'booking' : 'bookings'}; edit it instead.`}>
        In use
      </span>
    )
  }

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="itemId" value={itemId} />
      <RemoveSubmit />
      <Failure state={state} />
    </form>
  )
}

function RemoveSubmit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="ghost" size="sm" disabled={pending} aria-busy={pending} aria-label="Remove check">
      {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Trash2 aria-hidden className="h-4 w-4" />}
    </Button>
  )
}
