'use client'

import { LoaderCircle } from 'lucide-react'
import Link from 'next/link'
import { useActionState, useId } from 'react'

import { Alert } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  type AccessoryFormState,
  addAccessoryFormAction,
  updateAccessoryFormAction,
} from '@/server/actions/accessories.actions'

export interface AccessoryFormValues {
  accessoryId?: string
  accessoryTypeId: string
  label: string
  quantity: number
  serialNumber: string
  admBarcode: string
  isRequired: boolean
  notes: string
}

/** Add or edit one accessory. The type comes from the managed catalogue. */
export function AccessoryForm({
  assetId,
  values,
  accessoryTypes,
  cancelHref,
}: {
  assetId: string
  values: AccessoryFormValues
  accessoryTypes: ReadonlyArray<{ id: string; name: string }>
  cancelHref: string
}) {
  const editing = Boolean(values.accessoryId)
  const [state, formAction, pending] = useActionState<AccessoryFormState, FormData>(
    editing ? updateAccessoryFormAction : addAccessoryFormAction,
    null,
  )
  const id = useId()
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {}

  return (
    <form action={formAction} noValidate className="theme-transition rounded-panel border border-accent/40 bg-panel">
      <header className="border-b border-line bg-panel-header px-5 py-3">
        <h3 className="font-display text-[15px] font-semibold text-foreground">{editing ? 'Edit accessory' : 'Add accessory'}</h3>
      </header>
      <div className="space-y-5 p-5">
        {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
        <input type="hidden" name="assetId" value={assetId} />
        {values.accessoryId ? <input type="hidden" name="accessoryId" value={values.accessoryId} /> : null}

        <div className="grid gap-5 md:grid-cols-3">
          <FormField label="Accessory type" htmlFor={`${id}-type`} error={errors.accessoryTypeId} required>
            <Select id={`${id}-type`} name="accessoryTypeId" defaultValue={values.accessoryTypeId} required invalid={Boolean(errors.accessoryTypeId)}>
              <option value="">Choose a type…</option>
              {accessoryTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Label" htmlFor={`${id}-label`} error={errors.label} hint="Optional detail, e.g. USB-C Cable (2m).">
            <Input id={`${id}-label`} name="label" defaultValue={values.label} maxLength={80} />
          </FormField>
          <FormField label="Quantity" htmlFor={`${id}-quantity`} error={errors.quantity} required>
            <Input id={`${id}-quantity`} name="quantity" type="number" inputMode="numeric" min={1} max={99} defaultValue={values.quantity} invalid={Boolean(errors.quantity)} />
          </FormField>
          <FormField label="Serial number" htmlFor={`${id}-serial`} error={errors.serialNumber}>
            <Input id={`${id}-serial`} name="serialNumber" defaultValue={values.serialNumber} maxLength={120} className="font-mono" autoComplete="off" />
          </FormField>
          <FormField label="ADM barcode" htmlFor={`${id}-barcode`} error={errors.admBarcode} hint="Unique when present.">
            <Input id={`${id}-barcode`} name="admBarcode" defaultValue={values.admBarcode} maxLength={64} className="font-mono" autoComplete="off" invalid={Boolean(errors.admBarcode)} />
          </FormField>
          <FormField label="Notes" htmlFor={`${id}-notes`} error={errors.notes}>
            <Input id={`${id}-notes`} name="notes" defaultValue={values.notes} maxLength={500} />
          </FormField>
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" name="isRequired" defaultChecked={values.isRequired} className="h-4 w-4 rounded border-line-strong accent-[var(--accent)]" />
          Required at handover
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
            {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : null}
            {editing ? 'Save accessory' : 'Add accessory'}
          </Button>
          <Link href={cancelHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Cancel
          </Link>
        </div>
      </div>
    </form>
  )
}
