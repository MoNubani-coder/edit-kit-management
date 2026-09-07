'use client'

import { LoaderCircle, Save } from 'lucide-react'
import { useActionState, useId } from 'react'

import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils/cn'
import { ITEM_CONDITIONS, RETURN_CONDITION_LABELS } from '@/lib/validation/return'
import { SUITCASE_STATUS_LABELS, SUITCASE_STATUSES } from '@/lib/validation/kits'
import { type ReturnFormState, saveReturnEquipmentFormAction } from '@/server/actions/return.actions'
import type { ReturnAssetLine } from '@/server/dal/return.dal'

/**
 * What has to come back, taken from the handover document rather than from the
 * kit as it stands today. Each item that went out gets one of three answers on
 * a control big enough to hit with a thumb while holding the case open;
 * "Not checked" is the state a line starts in, and completion refuses to
 * proceed while any remain.
 */

/** The answers, in the order an engineer works through them. */
const ANSWERS = [
  { value: 'INCLUDED', label: 'Returned', tone: 'data-[checked=true]:border-emerald-500 data-[checked=true]:bg-emerald-50 data-[checked=true]:text-emerald-900 dark:data-[checked=true]:bg-emerald-400/15 dark:data-[checked=true]:text-emerald-200' },
  { value: 'DAMAGED', label: 'Damaged', tone: 'data-[checked=true]:border-amber-500 data-[checked=true]:bg-amber-50 data-[checked=true]:text-amber-900 dark:data-[checked=true]:bg-amber-400/15 dark:data-[checked=true]:text-amber-100' },
  { value: 'MISSING', label: 'Not returned', tone: 'data-[checked=true]:border-rose-500 data-[checked=true]:bg-rose-50 data-[checked=true]:text-rose-900 dark:data-[checked=true]:bg-rose-400/15 dark:data-[checked=true]:text-rose-100' },
  { value: 'NOT_APPLICABLE', label: 'Not checked', tone: 'data-[checked=true]:border-line-strong data-[checked=true]:bg-panel-header data-[checked=true]:text-foreground' },
] as const

const HANDOVER_WORD: Record<string, string> = {
  INCLUDED: 'Handed over',
  MISSING: 'Missing at handover',
  DAMAGED: 'Damaged at handover',
  NOT_APPLICABLE: 'Not handed over',
}

const ROW_TONE: Record<string, string> = {
  INCLUDED: '',
  DAMAGED: 'bg-amber-50/40 dark:bg-amber-400/5',
  MISSING: 'bg-rose-50/40 dark:bg-rose-400/5',
  NOT_APPLICABLE: '',
}

function ConditionChoice({ name, current, disabled, label }: { name: string; current: string; disabled: boolean; label: string }) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">{label}</legend>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-2">
        {ANSWERS.map((answer) => {
          const checked = current === answer.value
          return (
            <label
              key={answer.value}
              data-checked={checked}
              className={cn(
                'flex min-h-[2.75rem] cursor-pointer items-center justify-center rounded-lg border border-line bg-panel px-2 text-center text-[13px] font-medium text-muted transition-colors',
                'hover:border-line-strong hover:text-foreground has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
                answer.tone,
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input type="radio" name={name} value={answer.value} defaultChecked={checked} disabled={disabled} className="sr-only" />
              {answer.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export function EquipmentReturnForm({
  bookingId,
  lines,
  suitcaseStatus,
  generalNotes,
  disabled,
}: {
  bookingId: string
  lines: ReturnAssetLine[]
  suitcaseStatus: string
  generalNotes: string | null
  disabled: boolean
}) {
  const [state, formAction, pending] = useActionState<ReturnFormState, FormData>(saveReturnEquipmentFormAction, null)
  const id = useId()
  const expected = lines.filter((line) => line.wasHandedOver)
  const notHandedOver = lines.filter((line) => !line.wasHandedOver)
  const outstanding = expected.filter((line) => line.status === 'NOT_APPLICABLE').length

  return (
    <form action={formAction} noValidate className="space-y-5">
      <input type="hidden" name="bookingId" value={bookingId} />
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}

      {outstanding > 0 ? (
        <Alert variant="info" title={`${outstanding} of ${expected.length} still to check`}>
          Work down the list and give every handed-over item an answer. Anything missing or damaged raises an issue when the return is completed.
        </Alert>
      ) : null}

      <ul className="space-y-3">
        {expected.map((line) => (
          <li key={line.id} className={cn('rounded-lg border border-line p-4', ROW_TONE[line.status])}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-sm font-bold text-accent-foreground">{line.assetCodeSnapshot}</span>
                  <span className="text-base font-semibold text-foreground">{line.nameSnapshot}</span>
                  <Badge tone="neutral">{line.categoryNameSnapshot}</Badge>
                  {line.slotLabelSnapshot ? <span className="text-xs text-muted">{line.slotLabelSnapshot}</span> : null}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {[line.manufacturerSnapshot, line.modelSnapshot].filter(Boolean).join(' ') || 'No make or model recorded'}
                  {line.serialNumberSnapshot ? <span className="font-mono"> · SN {line.serialNumberSnapshot}</span> : null}
                  {line.admBarcodeSnapshot ? <span className="font-mono"> · {line.admBarcodeSnapshot}</span> : null}
                </p>
                <p className="mt-1 text-xs text-subtle">
                  {HANDOVER_WORD[line.handoverStatus ?? 'NOT_APPLICABLE']} at collection
                  {line.handoverNotes ? ` · "${line.handoverNotes}"` : ''}
                  {!line.current.stillInKit && !line.current.deleted ? ' · since removed from the kit, still expected back' : ''}
                  {line.current.deleted ? ' · since removed from the inventory' : ''}
                </p>

                {line.accessories.length > 0 ? (
                  <ul className="mt-3 space-y-2 border-l-2 border-line pl-3">
                    {line.accessories.map((accessory) => (
                      <li key={accessory.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_5.5rem]">
                        <span className="text-sm text-foreground">
                          {accessory.labelSnapshot}
                          <span className="text-xs text-muted"> · {accessory.accessoryTypeSnapshot}</span>
                          {accessory.wasHandedOver ? (
                            <span className="text-xs text-muted"> · {accessory.quantityExpected} went out</span>
                          ) : (
                            <span className="text-xs text-subtle"> · did not go out</span>
                          )}
                        </span>
                        <label className="sr-only" htmlFor={`${id}-acc-${accessory.id}`}>
                          Return condition of {accessory.labelSnapshot}
                        </label>
                        <Select id={`${id}-acc-${accessory.id}`} name={`accessory.${accessory.id}.status`} defaultValue={accessory.status} disabled={disabled} className="h-10">
                          {ITEM_CONDITIONS.map((option) => (
                            <option key={option} value={option}>
                              {option === 'NOT_APPLICABLE' && accessory.wasHandedOver ? 'Not checked' : RETURN_CONDITION_LABELS[option]}
                            </option>
                          ))}
                        </Select>
                        <label className="sr-only" htmlFor={`${id}-qty-${accessory.id}`}>
                          Quantity returned for {accessory.labelSnapshot}
                        </label>
                        <Input
                          id={`${id}-qty-${accessory.id}`}
                          name={`accessory.${accessory.id}.quantityReceived`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={99}
                          defaultValue={accessory.quantityReceived ?? ''}
                          placeholder={String(accessory.quantityExpected)}
                          disabled={disabled}
                          className="h-10"
                          aria-label="Quantity returned"
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="space-y-2">
                <ConditionChoice name={`asset.${line.id}.status`} current={line.status} disabled={disabled} label={`Return condition of ${line.assetCodeSnapshot}`} />
                <label className="sr-only" htmlFor={`${id}-notes-${line.id}`}>
                  Notes for {line.assetCodeSnapshot}
                </label>
                <Input
                  id={`${id}-notes-${line.id}`}
                  name={`asset.${line.id}.notes`}
                  defaultValue={line.notes ?? ''}
                  maxLength={500}
                  placeholder="What you found (optional)"
                  disabled={disabled}
                  className="h-11"
                />
              </div>
            </div>
          </li>
        ))}
      </ul>

      {notHandedOver.length > 0 ? (
        <details className="rounded-lg border border-line px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            {notHandedOver.length} {notHandedOver.length === 1 ? 'item' : 'items'} on the handover that never went out
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {notHandedOver.map((line) => (
              <li key={line.id}>
                <span className="font-mono text-accent-foreground">{line.assetCodeSnapshot}</span> {line.nameSnapshot} · {HANDOVER_WORD[line.handoverStatus ?? 'NOT_APPLICABLE']}
                {/* Keeps the line in the posted set without changing its answer. */}
                <input type="hidden" name={`asset.${line.id}.status`} value="NOT_APPLICABLE" />
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        <FormField label="Case condition on return" htmlFor={`${id}-case`}>
          <Select id={`${id}-case`} name="suitcaseStatus" defaultValue={suitcaseStatus} disabled={disabled} className="h-11">
            {SUITCASE_STATUSES.map((option) => (
              <option key={option} value={option}>
                {SUITCASE_STATUS_LABELS[option]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Return notes" htmlFor={`${id}-general`} hint="Scratches, replacements, anything sent for repair.">
          <Textarea id={`${id}-general`} name="generalNotes" defaultValue={generalNotes ?? ''} maxLength={2000} disabled={disabled} className="min-h-[2.75rem]" />
        </FormField>
      </div>

      {!disabled ? (
        <Button type="submit" size="lg" disabled={pending || expected.length === 0} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Save aria-hidden className="h-4 w-4" />}
          Save what came back
        </Button>
      ) : null}
    </form>
  )
}
