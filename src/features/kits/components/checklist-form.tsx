'use client'

import { LoaderCircle } from 'lucide-react'
import { useActionState, useId } from 'react'

import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Select } from '@/components/ui/select'
import { type KitCompositionState, setKitChecklistFormAction } from '@/server/actions/kit-composition.actions'
import type { ChecklistTemplateOption } from '@/server/dal/catalogue.dal'

export function ChecklistForm({ kitId, templateId, options }: { kitId: string; templateId: string; options: ChecklistTemplateOption[] }) {
  const [state, formAction, pending] = useActionState<KitCompositionState, FormData>(setKitChecklistFormAction, null)
  const id = useId()
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {}

  return (
    <form action={formAction} noValidate className="theme-transition rounded-panel border border-line bg-panel">
      <header className="border-b border-line bg-panel-header px-5 py-3">
        <h3 className="font-display text-[15px] font-semibold text-foreground">Checklist template for new bookings</h3>
        <p className="mt-0.5 text-xs text-muted">Copied into each booking when it is created; existing bookings are never changed.</p>
      </header>
      <div className="space-y-4 p-5">
        {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
        <input type="hidden" name="kitId" value={kitId} />
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <FormField label="Template" htmlFor={`${id}-template`} error={errors.templateId}>
            <Select id={`${id}-template`} name="templateId" defaultValue={templateId} invalid={Boolean(errors.templateId)}>
              <option value="">System default</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} · {option.itemCount} checks · v{option.version}
                  {option.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </Select>
          </FormField>
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </div>
    </form>
  )
}
