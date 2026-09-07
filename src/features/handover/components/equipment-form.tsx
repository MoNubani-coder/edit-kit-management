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
import { ITEM_CONDITION_LABELS, ITEM_CONDITIONS, type ItemCondition } from '@/lib/validation/handover'
import { SUITCASE_STATUS_LABELS, SUITCASE_STATUSES } from '@/lib/validation/kits'
import { type HandoverFormState, saveEquipmentFormAction } from '@/server/actions/handover.actions'
import type { HandoverAssetLine } from '@/server/dal/handover.dal'

/**
 * Step 3: every item that leaves in the case, as snapshotted when the handover
 * started, with its accessories one level in. The engineer records each line's
 * condition; a required item that is not handed over blocks completion.
 */

const TONE: Record<ItemCondition, string> = {
  INCLUDED: '',
  MISSING: 'border-rose-300 dark:border-rose-400/40',
  DAMAGED: 'border-amber-300 dark:border-amber-400/40',
  NOT_APPLICABLE: '',
}

function groupByCategory(lines: HandoverAssetLine[]) {
  const groups = new Map<string, HandoverAssetLine[]>()
  for (const line of lines) {
    const group = groups.get(line.categoryNameSnapshot) ?? []
    group.push(line)
    groups.set(line.categoryNameSnapshot, group)
  }
  return [...groups.entries()]
}

export function EquipmentForm({
  bookingId,
  lines,
  suitcaseStatus,
  generalNotes,
  disabled,
}: {
  bookingId: string
  lines: HandoverAssetLine[]
  suitcaseStatus: string
  generalNotes: string | null
  disabled: boolean
}) {
  const [state, formAction, pending] = useActionState<HandoverFormState, FormData>(saveEquipmentFormAction, null)
  const id = useId()
  const groups = groupByCategory(lines)

  return (
    <form action={formAction} noValidate className="space-y-5">
      <input type="hidden" name="bookingId" value={bookingId} />
      {state && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}

      {lines.length === 0 ? (
        <Alert variant="warning" title="The kit is empty">
          No equipment was in the kit when the handover started. Add equipment to the kit and start again.
        </Alert>
      ) : null}

      <div className="space-y-4">
        {groups.map(([category, members]) => (
          <fieldset key={category} className="min-w-0 rounded-lg border border-line">
            <legend className="ml-3 px-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-foreground">{category}</legend>
            <ul className="divide-y divide-line">
              {members.map((line) => (
                <li key={line.id} className={`grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_12rem_minmax(0,16rem)] ${TONE[line.status]}`}>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-accent-foreground">{line.assetCodeSnapshot}</span>
                      <span className="font-medium text-foreground">{line.nameSnapshot}</span>
                      {line.isRequired ? <Badge tone="blue">Required</Badge> : <Badge tone="neutral">Optional</Badge>}
                      {line.slotLabelSnapshot ? <span className="text-xs text-muted">{line.slotLabelSnapshot}</span> : null}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {[line.manufacturerSnapshot, line.modelSnapshot].filter(Boolean).join(' ') || 'No make or model recorded'}
                      {line.serialNumberSnapshot ? <span className="font-mono"> · SN {line.serialNumberSnapshot}</span> : null}
                      {line.admBarcodeSnapshot ? <span className="font-mono"> · {line.admBarcodeSnapshot}</span> : null}
                    </p>
                    {line.current.activeMaintenanceCount > 0 || !line.current.stillInKit || line.current.deleted ? (
                      <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                        {line.current.deleted ? 'Removed from the inventory since the handover started. ' : ''}
                        {!line.current.stillInKit && !line.current.deleted ? 'No longer in the kit. ' : ''}
                        {line.current.activeMaintenanceCount > 0 ? 'Maintenance in progress or on hold.' : ''}
                      </p>
                    ) : null}
                    {line.accessories.length > 0 ? (
                      <ul className="mt-3 space-y-2 border-l border-line pl-3">
                        {line.accessories.map((accessory) => (
                          <li key={accessory.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_5rem]">
                            <span className="text-sm text-foreground">
                              {accessory.labelSnapshot}
                              <span className="text-xs text-muted"> · {accessory.accessoryTypeSnapshot}</span>
                              {accessory.quantityExpected > 1 ? <span className="text-xs text-muted"> · expected {accessory.quantityExpected}</span> : null}
                              {!accessory.isRequired ? <span className="text-xs text-subtle"> · optional</span> : null}
                            </span>
                            <label className="sr-only" htmlFor={`${id}-acc-${accessory.id}`}>
                              Condition of {accessory.labelSnapshot}
                            </label>
                            <Select id={`${id}-acc-${accessory.id}`} name={`accessory.${accessory.id}.status`} defaultValue={accessory.status} disabled={disabled} className="h-9">
                              {ITEM_CONDITIONS.map((option) => (
                                <option key={option} value={option}>
                                  {ITEM_CONDITION_LABELS[option]}
                                </option>
                              ))}
                            </Select>
                            <label className="sr-only" htmlFor={`${id}-qty-${accessory.id}`}>
                              Quantity received for {accessory.labelSnapshot}
                            </label>
                            <Input id={`${id}-qty-${accessory.id}`} name={`accessory.${accessory.id}.quantityReceived`} type="number" inputMode="numeric" min={0} max={99} defaultValue={accessory.quantityReceived ?? accessory.quantityExpected} disabled={disabled} className="h-9" aria-label="Quantity received" />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div>
                    <label className="sr-only" htmlFor={`${id}-status-${line.id}`}>
                      Condition of {line.assetCodeSnapshot}
                    </label>
                    <Select id={`${id}-status-${line.id}`} name={`asset.${line.id}.status`} defaultValue={line.status} disabled={disabled} className="h-11 text-base">
                      {ITEM_CONDITIONS.map((option) => (
                        <option key={option} value={option}>
                          {ITEM_CONDITION_LABELS[option]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className="sr-only" htmlFor={`${id}-notes-${line.id}`}>
                      Notes for {line.assetCodeSnapshot}
                    </label>
                    <Input id={`${id}-notes-${line.id}`} name={`asset.${line.id}.notes`} defaultValue={line.notes ?? ''} maxLength={500} placeholder="Condition notes (optional)" disabled={disabled} className="h-11" />
                  </div>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <FormField label="Case condition at handover" htmlFor={`${id}-case`}>
          <Select id={`${id}-case`} name="suitcaseStatus" defaultValue={suitcaseStatus} disabled={disabled} className="h-11">
            {SUITCASE_STATUSES.map((option) => (
              <option key={option} value={option}>
                {SUITCASE_STATUS_LABELS[option]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="General notes" htmlFor={`${id}-general`} hint="Anything the return inspection should know.">
          <Textarea id={`${id}-general`} name="generalNotes" defaultValue={generalNotes ?? ''} maxLength={2000} disabled={disabled} className="min-h-[2.75rem]" />
        </FormField>
      </div>

      {!disabled ? (
        <Button type="submit" size="lg" disabled={pending || lines.length === 0} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Save aria-hidden className="h-4 w-4" />}
          Save equipment verification
        </Button>
      ) : null}
    </form>
  )
}
