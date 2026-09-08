'use client'

import { LoaderCircle, Plus } from 'lucide-react'
import Link from 'next/link'
import { useActionState, useId } from 'react'

import { ConfirmSubmitButton } from '@/components/common/confirm-submit-button'
import { Button, buttonVariants } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  addKitAssetFormAction,
  type KitCompositionState,
  removeKitAssetFormAction,
  updateKitAssetFormAction,
} from '@/server/actions/kit-composition.actions'

function Failure({ state }: { state: KitCompositionState }) {
  if (!state || state.ok) return null
  return (
    <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-300">
      {state.message}
    </p>
  )
}

function RequiredSelect({ id, defaultValue }: { id: string; defaultValue: boolean }) {
  return (
    <Select id={id} name="isRequired" defaultValue={defaultValue ? 'true' : 'false'} className="h-9">
      <option value="true">Required</option>
      <option value="false">Optional</option>
    </Select>
  )
}

/** One candidate row's "Add" control: slot label, required / optional, submit. */
export function AddMemberForm({ kitId, assetId, assetCode, pick }: { kitId: string; assetId: string; assetCode: string; pick?: string }) {
  const [state, formAction, pending] = useActionState<KitCompositionState, FormData>(addKitAssetFormAction, null)
  const id = useId()

  return (
    <form action={formAction} className="flex flex-wrap items-end justify-end gap-2">
      <input type="hidden" name="kitId" value={kitId} />
      <input type="hidden" name="assetId" value={assetId} />
      {pick ? <input type="hidden" name="pick" value={pick} /> : null}
      <label className="sr-only" htmlFor={`${id}-slot`}>
        Slot label for {assetCode}
      </label>
      <Input id={`${id}-slot`} name="slotLabel" placeholder="Slot (optional)" maxLength={60} className="h-9 w-36" />
      <label className="sr-only" htmlFor={`${id}-required`}>
        Required or optional
      </label>
      <span className="w-32">
        <RequiredSelect id={`${id}-required`} defaultValue />
      </span>
      <Button type="submit" size="sm" disabled={pending} aria-busy={pending} className="h-9">
        {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />}
        Add
      </Button>
      <Failure state={state} />
    </form>
  )
}

export interface MemberEditValues {
  kitAssetId: string
  assetCode: string
  assetName: string
  slotLabel: string
  isRequired: boolean
}

/** Slot label and required flag for an existing member. */
export function MemberEditForm({ values, cancelHref }: { values: MemberEditValues; cancelHref: string }) {
  const [state, formAction, pending] = useActionState<KitCompositionState, FormData>(updateKitAssetFormAction, null)
  const id = useId()
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {}

  return (
    <form action={formAction} noValidate className="theme-transition rounded-panel border border-accent/40 bg-panel">
      <header className="border-b border-line bg-panel-header px-5 py-3">
        <h3 className="font-display text-[15px] font-semibold text-foreground">
          Edit <span className="font-mono text-accent-foreground">{values.assetCode}</span> in this kit
        </h3>
        <p className="mt-0.5 text-xs text-muted">{values.assetName}</p>
      </header>
      <div className="space-y-5 p-5">
        <input type="hidden" name="kitAssetId" value={values.kitAssetId} />
        {state && !state.ok ? <Failure state={state} /> : null}
        <div className="grid gap-5 md:grid-cols-2">
          <FormField label="Slot label" htmlFor={`${id}-slot`} error={errors.slotLabel} hint="How the line reads on the handover form, e.g. Speaker 1.">
            <Input id={`${id}-slot`} name="slotLabel" defaultValue={values.slotLabel} maxLength={60} />
          </FormField>
          <FormField label="Membership" htmlFor={`${id}-required`} error={errors.isRequired} hint="Required items must be available for the kit to be ready.">
            <RequiredSelect id={`${id}-required`} defaultValue={values.isRequired} />
          </FormField>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
            {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
          <Link href={cancelHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Cancel
          </Link>
        </div>
      </div>
    </form>
  )
}

/** Remove a member; the server refuses when a workflow depends on it. */
export function RemoveMemberForm({ kitAssetId, assetCode, blocker }: { kitAssetId: string; assetCode: string; blocker: string | null }) {
  const [state, formAction] = useActionState<KitCompositionState, FormData>(removeKitAssetFormAction, null)

  if (blocker) {
    return (
      <span className="text-xs text-subtle" title={blocker}>
        Locked
      </span>
    )
  }

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="kitAssetId" value={kitAssetId} />
      <ConfirmSubmitButton
        variant="ghost"
        size="sm"
        className="text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:text-rose-300 dark:hover:bg-rose-400/10"
        message={`Remove ${assetCode} from this kit? The equipment stays in the inventory and past handover records keep their reference.`}
      >
        Remove
      </ConfirmSubmitButton>
      <Failure state={state} />
    </form>
  )
}
