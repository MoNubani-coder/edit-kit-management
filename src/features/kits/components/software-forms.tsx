'use client'

import { LoaderCircle, Plus } from 'lucide-react'
import { useActionState, useId } from 'react'

import { ConfirmSubmitButton } from '@/components/common/confirm-submit-button'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Select } from '@/components/ui/select'
import { addKitSoftwareFormAction, type KitCompositionState, removeKitSoftwareFormAction } from '@/server/actions/kit-composition.actions'
import type { SoftwareApplicationOption } from '@/server/dal/catalogue.dal'

export function AddSoftwareForm({ kitId, options }: { kitId: string; options: SoftwareApplicationOption[] }) {
  const [state, formAction, pending] = useActionState<KitCompositionState, FormData>(addKitSoftwareFormAction, null)
  const id = useId()
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {}

  return (
    <form action={formAction} noValidate className="theme-transition rounded-panel border border-line bg-panel">
      <header className="border-b border-line bg-panel-header px-5 py-3">
        <h3 className="font-display text-[15px] font-semibold text-foreground">Add an application</h3>
        <p className="mt-0.5 text-xs text-muted">Applications come from Administration › Software.</p>
      </header>
      <div className="space-y-4 p-5">
        {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
        <input type="hidden" name="kitId" value={kitId} />
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem_auto] md:items-end">
          <FormField label="Application" htmlFor={`${id}-app`} error={errors.softwareApplicationId} required>
            <Select id={`${id}-app`} name="softwareApplicationId" defaultValue="" required disabled={options.length === 0} invalid={Boolean(errors.softwareApplicationId)}>
              <option value="">{options.length === 0 ? 'Every active application is already listed' : 'Choose an application…'}</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                  {option.version ? ` ${option.version}` : ''}
                  {option.vendor ? ` · ${option.vendor}` : ''}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Requirement" htmlFor={`${id}-required`} error={errors.isRequired}>
            <Select id={`${id}-required`} name="isRequired" defaultValue="true">
              <option value="true">Required</option>
              <option value="false">Optional</option>
            </Select>
          </FormField>
          <Button type="submit" disabled={pending || options.length === 0} aria-busy={pending}>
            {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />}
            Add
          </Button>
        </div>
      </div>
    </form>
  )
}

export function RemoveSoftwareForm({ kitSoftwareId, label }: { kitSoftwareId: string; label: string }) {
  const [state, formAction] = useActionState<KitCompositionState, FormData>(removeKitSoftwareFormAction, null)

  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="kitSoftwareId" value={kitSoftwareId} />
      <ConfirmSubmitButton variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:text-rose-300 dark:hover:bg-rose-400/10" message={`Remove ${label} from this kit's software list?`}>
        Remove
      </ConfirmSubmitButton>
      {state && !state.ok ? (
        <p role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-300">
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
