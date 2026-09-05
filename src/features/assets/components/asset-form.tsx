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
import {
  ASSET_STATUS_LABELS,
  type AssetStatusValue,
  CREATE_ASSET_STATUSES,
} from '@/lib/validation/assets'
import { type AssetFormState, createAssetFormAction, updateAssetFormAction } from '@/server/actions/assets.actions'

/**
 * Create / edit form for equipment. The asset code is never entered - the
 * numbering service allocates it on save. Status choices are the transitions
 * the server allows for this asset; a reason is asked for when it changes.
 */

export interface AssetFormValues {
  id?: string
  name: string
  categoryId: string
  manufacturer: string
  model: string
  serialNumber: string
  admBarcode: string
  location: string
  notes: string
  status: AssetStatusValue
}

export function AssetForm({
  mode,
  values,
  categories,
  allowedStatuses,
  cancelHref,
}: {
  mode: 'create' | 'edit'
  values: AssetFormValues
  categories: ReadonlyArray<{ id: string; name: string }>
  /** Edit only: statuses the asset may move to (current included). */
  allowedStatuses?: readonly AssetStatusValue[]
  cancelHref: string
}) {
  const [state, formAction, pending] = useActionState<AssetFormState, FormData>(
    mode === 'create' ? createAssetFormAction : updateAssetFormAction,
    null,
  )
  const [status, setStatus] = useState<AssetStatusValue>(values.status)
  const id = useId()

  const errors = state && !state.ok ? state.fieldErrors ?? {} : {}
  const message = state && !state.ok && Object.keys(errors).length === 0 ? state.message : null
  const statusOptions: readonly AssetStatusValue[] = mode === 'create' ? CREATE_ASSET_STATUSES : allowedStatuses ?? [values.status]
  const statusChanged = mode === 'edit' && status !== values.status

  return (
    <form action={formAction} noValidate className="space-y-8">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      {message ? <Alert variant="error">{message}</Alert> : null}
      {state && !state.ok && Object.keys(errors).length > 0 ? (
        <Alert variant="error">{state.message}</Alert>
      ) : null}

      <section className="theme-transition rounded-panel border border-line bg-panel">
        <header className="border-b border-line bg-panel-header px-5 py-3">
          <h2 className="font-display text-[15px] font-semibold text-foreground">Equipment</h2>
        </header>
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <FormField label="Name" htmlFor={`${id}-name`} error={errors.name} required className="md:col-span-2">
            <Input id={`${id}-name`} name="name" defaultValue={values.name} maxLength={120} required invalid={Boolean(errors.name)} placeholder="e.g. MacBook Pro 16&quot; M3 Max" />
          </FormField>
          <FormField label="Category" htmlFor={`${id}-category`} error={errors.categoryId} required>
            <Select id={`${id}-category`} name="categoryId" defaultValue={values.categoryId} required invalid={Boolean(errors.categoryId)}>
              <option value="">Choose a category…</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Location" htmlFor={`${id}-location`} error={errors.location} hint="Where it lives when not in a kit.">
            <Input id={`${id}-location`} name="location" defaultValue={values.location} maxLength={120} placeholder="e.g. Engineering Store - Rack B" />
          </FormField>
          <FormField label="Manufacturer" htmlFor={`${id}-manufacturer`} error={errors.manufacturer}>
            <Input id={`${id}-manufacturer`} name="manufacturer" defaultValue={values.manufacturer} maxLength={80} />
          </FormField>
          <FormField label="Model" htmlFor={`${id}-model`} error={errors.model}>
            <Input id={`${id}-model`} name="model" defaultValue={values.model} maxLength={120} />
          </FormField>
        </div>
      </section>

      <section className="theme-transition rounded-panel border border-line bg-panel">
        <header className="border-b border-line bg-panel-header px-5 py-3">
          <h2 className="font-display text-[15px] font-semibold text-foreground">Identification</h2>
          <p className="mt-0.5 text-xs text-muted">
            {mode === 'create' ? 'The asset code (AST-NNNNNN) is allocated automatically on save.' : `Asset code is fixed once allocated.`}
          </p>
        </header>
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <FormField label="Serial number" htmlFor={`${id}-serial`} error={errors.serialNumber} hint="Must be unique across the inventory.">
            <Input id={`${id}-serial`} name="serialNumber" defaultValue={values.serialNumber} maxLength={120} autoComplete="off" className="font-mono" invalid={Boolean(errors.serialNumber)} />
          </FormField>
          <FormField label="ADM barcode" htmlFor={`${id}-barcode`} error={errors.admBarcode} hint="Scan the label; must be unique.">
            <Input id={`${id}-barcode`} name="admBarcode" defaultValue={values.admBarcode} maxLength={64} autoComplete="off" className="font-mono" invalid={Boolean(errors.admBarcode)} />
          </FormField>
        </div>
      </section>

      <section className="theme-transition rounded-panel border border-line bg-panel">
        <header className="border-b border-line bg-panel-header px-5 py-3">
          <h2 className="font-display text-[15px] font-semibold text-foreground">State</h2>
          {mode === 'edit' ? (
            <p className="mt-0.5 text-xs text-muted">
              Reserved, checked out and maintenance are set by their workflows; only the states listed can be chosen here.
            </p>
          ) : null}
        </header>
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <FormField label="Status" htmlFor={`${id}-status`} error={errors.status} required>
            <Select
              id={`${id}-status`}
              name="status"
              value={status}
              onChange={(event) => setStatus(event.target.value as AssetStatusValue)}
              disabled={statusOptions.length <= 1}
              invalid={Boolean(errors.status)}
            >
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {ASSET_STATUS_LABELS[option]}
                </option>
              ))}
            </Select>
          </FormField>
          {statusChanged ? (
            <FormField label="Reason for status change" htmlFor={`${id}-reason`} error={errors.statusReason} hint="Recorded in the equipment history.">
              <Input id={`${id}-reason`} name="statusReason" maxLength={300} placeholder="e.g. Screen cracked during transport" />
            </FormField>
          ) : null}
          <FormField label="Notes" htmlFor={`${id}-notes`} error={errors.notes} className="md:col-span-2">
            <Textarea id={`${id}-notes`} name="notes" defaultValue={values.notes} maxLength={2000} placeholder="Configuration, calibration notes, anything the next engineer should know." />
          </FormField>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : null}
          {mode === 'create' ? 'Add equipment' : 'Save changes'}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: 'ghost' })}>
          Cancel
        </Link>
      </div>
    </form>
  )
}
