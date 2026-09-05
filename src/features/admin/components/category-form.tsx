'use client'

import { LoaderCircle } from 'lucide-react'
import Link from 'next/link'
import { useActionState, useId } from 'react'

import { Alert } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import {
  type CategoryFormState,
  createCategoryFormAction,
  updateCategoryFormAction,
} from '@/server/actions/categories.actions'

export interface CategoryFormValues {
  id?: string
  name: string
  code: string
  description: string
  icon: string
  sortOrder: number
}

export function CategoryForm({ values, cancelHref }: { values: CategoryFormValues; cancelHref: string }) {
  const editing = Boolean(values.id)
  const [state, formAction, pending] = useActionState<CategoryFormState, FormData>(
    editing ? updateCategoryFormAction : createCategoryFormAction,
    null,
  )
  const id = useId()
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {}

  return (
    <form action={formAction} noValidate className="theme-transition rounded-panel border border-accent/40 bg-panel">
      <header className="border-b border-line bg-panel-header px-5 py-3">
        <h3 className="font-display text-[15px] font-semibold text-foreground">{editing ? 'Edit category' : 'New category'}</h3>
      </header>
      <div className="space-y-5 p-5">
        {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <div className="grid gap-5 md:grid-cols-2">
          <FormField label="Name" htmlFor={`${id}-name`} error={errors.name} required>
            <Input id={`${id}-name`} name="name" defaultValue={values.name} maxLength={80} required invalid={Boolean(errors.name)} />
          </FormField>
          <FormField label="Code" htmlFor={`${id}-code`} error={errors.code} hint={editing ? 'Stable identifier used by seeds and integrations.' : 'Optional; derived from the name when left blank.'}>
            <Input id={`${id}-code`} name="code" defaultValue={values.code} maxLength={40} className="font-mono uppercase" invalid={Boolean(errors.code)} />
          </FormField>
          <FormField label="Description" htmlFor={`${id}-description`} error={errors.description} className="md:col-span-2">
            <Input id={`${id}-description`} name="description" defaultValue={values.description} maxLength={300} />
          </FormField>
          <FormField label="Icon" htmlFor={`${id}-icon`} error={errors.icon} hint="lucide icon name, e.g. laptop, monitor, mic.">
            <Input id={`${id}-icon`} name="icon" defaultValue={values.icon} maxLength={40} className="font-mono" />
          </FormField>
          <FormField label="Sort order" htmlFor={`${id}-sort`} error={errors.sortOrder}>
            <Input id={`${id}-sort`} name="sortOrder" type="number" inputMode="numeric" min={0} max={999} defaultValue={values.sortOrder} />
          </FormField>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
            {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : null}
            {editing ? 'Save category' : 'Create category'}
          </Button>
          <Link href={cancelHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Cancel
          </Link>
        </div>
      </div>
    </form>
  )
}
