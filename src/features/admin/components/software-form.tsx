'use client'

import { LoaderCircle } from 'lucide-react'
import Link from 'next/link'
import { useActionState, useId } from 'react'

import { Alert } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { type AdminFormState, createSoftwareFormAction, updateSoftwareFormAction } from '@/server/actions/admin.actions'

export interface SoftwareFormValues {
  id?: string
  name: string
  vendor: string
  version: string
  licenseType: string
  notes: string
  sortOrder: number
}

/**
 * An application a kit is expected to carry. Name and version are unique
 * together, because "DaVinci Resolve 19" and "DaVinci Resolve 20" are
 * different things to check for at handover.
 */
export function SoftwareForm({ values, cancelHref }: { values: SoftwareFormValues; cancelHref: string }) {
  const editing = Boolean(values.id)
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(editing ? updateSoftwareFormAction : createSoftwareFormAction, null)
  const id = useId()
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {}

  return (
    <form action={formAction} noValidate className="theme-transition rounded-panel border border-accent/40 bg-panel">
      <header className="border-b border-line bg-panel-header px-5 py-3">
        <h3 className="font-display text-[15px] font-semibold text-foreground">{editing ? 'Edit application' : 'New application'}</h3>
      </header>
      <div className="space-y-5 p-5">
        {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <div className="grid gap-5 md:grid-cols-2">
          <FormField label="Name" htmlFor={`${id}-name`} error={errors.name} required>
            <Input id={`${id}-name`} name="name" defaultValue={values.name} maxLength={120} required invalid={Boolean(errors.name)} />
          </FormField>
          <FormField label="Version" htmlFor={`${id}-version`} error={errors.version} hint="Optional. Unique together with the name.">
            <Input id={`${id}-version`} name="version" defaultValue={values.version} maxLength={60} className="font-mono" invalid={Boolean(errors.version)} />
          </FormField>
          <FormField label="Vendor" htmlFor={`${id}-vendor`} error={errors.vendor}>
            <Input id={`${id}-vendor`} name="vendor" defaultValue={values.vendor} maxLength={120} />
          </FormField>
          <FormField label="Licence" htmlFor={`${id}-license`} error={errors.licenseType} hint="How it is licensed, e.g. site, named user, perpetual.">
            <Input id={`${id}-license`} name="licenseType" defaultValue={values.licenseType} maxLength={60} />
          </FormField>
          <FormField label="Notes" htmlFor={`${id}-notes`} error={errors.notes} className="md:col-span-2">
            <Input id={`${id}-notes`} name="notes" defaultValue={values.notes} maxLength={500} />
          </FormField>
          <FormField label="Sort order" htmlFor={`${id}-sort`} error={errors.sortOrder}>
            <Input id={`${id}-sort`} name="sortOrder" type="number" inputMode="numeric" min={0} max={999} defaultValue={values.sortOrder} />
          </FormField>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
            {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : null}
            {editing ? 'Save application' : 'Create application'}
          </Button>
          <Link href={cancelHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Cancel
          </Link>
        </div>
      </div>
    </form>
  )
}
