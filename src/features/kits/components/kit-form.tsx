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
  CREATE_KIT_STATUSES,
  KIT_STATUS_LABELS,
  type KitStatusValue,
  SUITCASE_STATUS_LABELS,
  SUITCASE_STATUSES,
  type SuitcaseStatusValue,
} from '@/lib/validation/kits'
import { createKitFormAction, type KitFormState, updateKitFormAction } from '@/server/actions/kits.actions'

/**
 * Create / edit form for a kit's own details. Equipment, software and the
 * checklist are managed on the kit workspace, not here. Status choices are the
 * transitions the server allows; a reason is asked for when it changes.
 */

export interface KitFormValues {
  id?: string
  kitCode: string
  name: string
  admBarcode: string
  location: string
  description: string
  notes: string
  suitcaseStatus: SuitcaseStatusValue
  status: KitStatusValue
}

export function KitForm({
  mode,
  values,
  allowedStatuses,
  cancelHref,
}: {
  mode: 'create' | 'edit'
  values: KitFormValues
  /** Edit only: statuses the kit may move to (current included). */
  allowedStatuses?: readonly KitStatusValue[]
  cancelHref: string
}) {
  const [state, formAction, pending] = useActionState<KitFormState, FormData>(
    mode === 'create' ? createKitFormAction : updateKitFormAction,
    null,
  )
  const [status, setStatus] = useState<KitStatusValue>(values.status)
  const id = useId()

  const errors = state && !state.ok ? state.fieldErrors ?? {} : {}
  const statusOptions: readonly KitStatusValue[] = mode === 'create' ? CREATE_KIT_STATUSES : allowedStatuses ?? [values.status]
  const statusChanged = mode === 'edit' && status !== values.status

  return (
    <form action={formAction} noValidate className="space-y-8">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}

      <section className="theme-transition rounded-panel border border-line bg-panel">
        <header className="border-b border-line bg-panel-header px-5 py-3">
          <h2 className="font-display text-[15px] font-semibold text-foreground">Identity</h2>
          <p className="mt-0.5 text-xs text-muted">The kit code is printed on the case and quoted on every booking. It must be unique.</p>
        </header>
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <FormField label="Kit code" htmlFor={`${id}-code`} error={errors.kitCode} required hint="Upper-case groups joined by hyphens: MBP-03, WIN-01, AUDIO-01, CAM-01.">
            <Input id={`${id}-code`} name="kitCode" defaultValue={values.kitCode} maxLength={40} required autoComplete="off" className="font-mono uppercase" invalid={Boolean(errors.kitCode)} placeholder="MBP-03" />
          </FormField>
          <FormField label="ADM barcode" htmlFor={`${id}-barcode`} error={errors.admBarcode} hint="Scan the case label; unique when present.">
            <Input id={`${id}-barcode`} name="admBarcode" defaultValue={values.admBarcode} maxLength={64} autoComplete="off" className="font-mono" invalid={Boolean(errors.admBarcode)} />
          </FormField>
          <FormField label="Kit name" htmlFor={`${id}-name`} error={errors.name} required className="md:col-span-2">
            <Input id={`${id}-name`} name="name" defaultValue={values.name} maxLength={120} required invalid={Boolean(errors.name)} placeholder="e.g. External MBP Edit - 03" />
          </FormField>
          <FormField label="Description" htmlFor={`${id}-description`} error={errors.description} className="md:col-span-2">
            <Textarea id={`${id}-description`} name="description" defaultValue={values.description} maxLength={2000} placeholder="What the kit is for and who it is issued to." />
          </FormField>
        </div>
      </section>

      <section className="theme-transition rounded-panel border border-line bg-panel">
        <header className="border-b border-line bg-panel-header px-5 py-3">
          <h2 className="font-display text-[15px] font-semibold text-foreground">Case and storage</h2>
        </header>
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <FormField label="Location" htmlFor={`${id}-location`} error={errors.location} hint="Where the kit lives when it is in the store.">
            <Input id={`${id}-location`} name="location" defaultValue={values.location} maxLength={120} placeholder="e.g. Engineering Store - Rack B" />
          </FormField>
          <FormField label="Case condition" htmlFor={`${id}-suitcase`} error={errors.suitcaseStatus}>
            <Select id={`${id}-suitcase`} name="suitcaseStatus" defaultValue={values.suitcaseStatus}>
              {SUITCASE_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {SUITCASE_STATUS_LABELS[option]}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      </section>

      <section className="theme-transition rounded-panel border border-line bg-panel">
        <header className="border-b border-line bg-panel-header px-5 py-3">
          <h2 className="font-display text-[15px] font-semibold text-foreground">State</h2>
          <p className="mt-0.5 text-xs text-muted">
            {mode === 'edit'
              ? 'Reserved and checked out are set by bookings; only the states listed can be chosen here. Whether the kit is actually ready to go out is calculated from its equipment.'
              : 'Reserved and checked out are set by bookings and cannot be chosen here.'}
          </p>
        </header>
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <FormField label="Status" htmlFor={`${id}-status`} error={errors.status} required>
            <Select
              id={`${id}-status`}
              name="status"
              value={status}
              onChange={(event) => setStatus(event.target.value as KitStatusValue)}
              disabled={statusOptions.length <= 1}
              invalid={Boolean(errors.status)}
            >
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {KIT_STATUS_LABELS[option]}
                </option>
              ))}
            </Select>
          </FormField>
          {statusChanged ? (
            <FormField label="Reason for status change" htmlFor={`${id}-reason`} error={errors.statusReason} hint="Recorded in the kit history.">
              <Input id={`${id}-reason`} name="statusReason" maxLength={300} placeholder="e.g. Flight case latch broken" />
            </FormField>
          ) : null}
          <FormField label="Notes" htmlFor={`${id}-notes`} error={errors.notes} className="md:col-span-2">
            <Textarea id={`${id}-notes`} name="notes" defaultValue={values.notes} maxLength={2000} placeholder="Anything the next engineer should know about this kit." />
          </FormField>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : null}
          {mode === 'create' ? 'Create kit' : 'Save changes'}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: 'ghost' })}>
          Cancel
        </Link>
      </div>
    </form>
  )
}
