'use client'

import { LoaderCircle } from 'lucide-react'
import Link from 'next/link'
import { useActionState, useId, useState } from 'react'

import { Alert } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { EDITOR_TYPE_LABELS, EDITOR_TYPES, type EditorType } from '@/lib/validation/editors'
import { createEditorFormAction, type EditorFormState, updateEditorFormAction } from '@/server/actions/editors.actions'
import type { LinkableUser } from '@/server/dal/editors.dal'

/**
 * Create / edit form for an editor profile. External editors have no account;
 * internal editors may optionally be linked to one when created (later links
 * are made from the Account panel, where they are audited individually).
 */

export interface EditorFormValues {
  id?: string
  fullName: string
  staffId: string
  email: string
  contactNumber: string
  department: string
  company: string
  type: EditorType
  notes: string
}

export function EditorForm({
  mode,
  values,
  linkableUsers = [],
  cancelHref,
}: {
  mode: 'create' | 'edit'
  values: EditorFormValues
  /** Create only: accounts an internal editor may be linked to. */
  linkableUsers?: LinkableUser[]
  cancelHref: string
}) {
  const [state, formAction, pending] = useActionState<EditorFormState, FormData>(
    mode === 'create' ? createEditorFormAction : updateEditorFormAction,
    null,
  )
  const [type, setType] = useState<EditorType>(values.type)
  const id = useId()
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {}
  const external = type === 'EXTERNAL'

  return (
    <form action={formAction} noValidate className="space-y-8">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}

      <section className="theme-transition rounded-panel border border-line bg-panel">
        <header className="border-b border-line bg-panel-header px-5 py-3">
          <h2 className="font-display text-[15px] font-semibold text-foreground">Identity</h2>
          <p className="mt-0.5 text-xs text-muted">The name and staff ID are printed on every handover document the editor signs.</p>
        </header>
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <FormField label="Full name" htmlFor={`${id}-name`} error={errors.fullName} required>
            <Input id={`${id}-name`} name="fullName" defaultValue={values.fullName} maxLength={120} required invalid={Boolean(errors.fullName)} placeholder="e.g. Layla Hassan" />
          </FormField>
          <FormField label="Staff ID" htmlFor={`${id}-staff`} error={errors.staffId} hint="Unique when present, e.g. EDT-2210 or EXT-5001.">
            <Input id={`${id}-staff`} name="staffId" defaultValue={values.staffId} maxLength={32} autoComplete="off" className="font-mono uppercase" invalid={Boolean(errors.staffId)} />
          </FormField>
          <FormField label="Editor type" htmlFor={`${id}-type`} error={errors.type} required hint={external ? 'External editors sign in person on the engineer’s device and have no account.' : 'Internal editors may be linked to a user account.'}>
            <Select id={`${id}-type`} name="type" value={type} onChange={(event) => setType(event.target.value as EditorType)} invalid={Boolean(errors.type)}>
              {EDITOR_TYPES.map((option) => (
                <option key={option} value={option}>
                  {EDITOR_TYPE_LABELS[option]}
                </option>
              ))}
            </Select>
          </FormField>
          {external ? (
            <FormField label="Company" htmlFor={`${id}-company`} error={errors.company}>
              <Input id={`${id}-company`} name="company" defaultValue={values.company} maxLength={120} placeholder="e.g. Freelance / Production house" />
            </FormField>
          ) : (
            <FormField label="Department" htmlFor={`${id}-department`} error={errors.department}>
              <Input id={`${id}-department`} name="department" defaultValue={values.department} maxLength={120} placeholder="e.g. Post Production" />
            </FormField>
          )}
        </div>
      </section>

      <section className="theme-transition rounded-panel border border-line bg-panel">
        <header className="border-b border-line bg-panel-header px-5 py-3">
          <h2 className="font-display text-[15px] font-semibold text-foreground">Contact</h2>
        </header>
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <FormField label="Contact number" htmlFor={`${id}-phone`} error={errors.contactNumber}>
            <Input id={`${id}-phone`} name="contactNumber" type="tel" defaultValue={values.contactNumber} maxLength={32} autoComplete="off" invalid={Boolean(errors.contactNumber)} placeholder="+971 50 000 0000" />
          </FormField>
          <FormField label="Email" htmlFor={`${id}-email`} error={errors.email}>
            <Input id={`${id}-email`} name="email" type="email" defaultValue={values.email} maxLength={254} autoComplete="off" invalid={Boolean(errors.email)} />
          </FormField>
          <FormField label="Notes" htmlFor={`${id}-notes`} error={errors.notes} className="md:col-span-2">
            <Textarea id={`${id}-notes`} name="notes" defaultValue={values.notes} maxLength={2000} placeholder="Anything the engineer should know before a handover." />
          </FormField>
        </div>
      </section>

      {mode === 'create' && !external ? (
        <section className="theme-transition rounded-panel border border-line bg-panel">
          <header className="border-b border-line bg-panel-header px-5 py-3">
            <h2 className="font-display text-[15px] font-semibold text-foreground">Account (optional)</h2>
            <p className="mt-0.5 text-xs text-muted">Linking lets a signed-in user see their own bookings. No account is created here; choose an existing one or leave it unlinked.</p>
          </header>
          <div className="p-5">
            <FormField label="Link to user account" htmlFor={`${id}-user`} error={errors.userId}>
              <Select id={`${id}-user`} name="userId" defaultValue="" invalid={Boolean(errors.userId)}>
                <option value="">Not linked</option>
                {linkableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} · {user.email} · {user.role.toLowerCase()}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : null}
          {mode === 'create' ? 'Add editor' : 'Save changes'}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: 'ghost' })}>
          Cancel
        </Link>
      </div>
    </form>
  )
}
