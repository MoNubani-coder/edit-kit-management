import { z } from 'zod'

import { formDataToObject } from './assets'
import { SUITCASE_STATUSES } from './kits'

/**
 * Handover schemas. The verification forms post one field per line
 * (`asset.<id>.status`, `check.<id>.notes` …); `parseLineFields` turns that
 * into typed arrays so the service never sees raw form keys. No Prisma import.
 */

export { formDataToObject }

export const ITEM_CONDITIONS = ['INCLUDED', 'MISSING', 'DAMAGED', 'NOT_APPLICABLE'] as const
export type ItemCondition = (typeof ITEM_CONDITIONS)[number]
export const ITEM_CONDITION_LABELS: Record<ItemCondition, string> = {
  INCLUDED: 'Handed over',
  MISSING: 'Missing',
  DAMAGED: 'Damaged',
  NOT_APPLICABLE: 'Not applicable',
}

export const SOFTWARE_STATUSES = ['INSTALLED', 'NOT_INSTALLED', 'LICENSE_ISSUE', 'NEEDS_UPDATE', 'NOT_APPLICABLE'] as const
export type SoftwareStatusValue = (typeof SOFTWARE_STATUSES)[number]
export const SOFTWARE_STATUS_LABELS: Record<SoftwareStatusValue, string> = {
  INSTALLED: 'Installed',
  NOT_INSTALLED: 'Not installed',
  LICENSE_ISSUE: 'Licence issue',
  NEEDS_UPDATE: 'Needs update',
  NOT_APPLICABLE: 'Not applicable',
}

export const CHECKLIST_STATUSES = ['PASS', 'FAIL', 'NOT_APPLICABLE'] as const
export type ChecklistStatusValue = (typeof CHECKLIST_STATUSES)[number]
export const CHECKLIST_STATUS_LABELS: Record<ChecklistStatusValue, string> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  NOT_APPLICABLE: 'Not applicable',
}

export const SIGNER_ROLES = ['EDITOR', 'ENGINEER'] as const
export type SignerRoleValue = (typeof SIGNER_ROLES)[number]

const emptyToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value)
const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max, `Use at most ${max} characters.`).optional())

// -----------------------------------------------------------------------------
// Equipment step
// -----------------------------------------------------------------------------

export const assetLineSchema = z.object({
  id: z.string().min(1),
  status: z.enum(ITEM_CONDITIONS),
  notes: optionalText(500),
})
export type AssetLineInput = z.output<typeof assetLineSchema>

export const accessoryLineSchema = z.object({
  id: z.string().min(1),
  status: z.enum(ITEM_CONDITIONS),
  quantityReceived: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(99).optional()),
  notes: optionalText(500),
})
export type AccessoryLineInput = z.output<typeof accessoryLineSchema>

export const equipmentVerificationSchema = z.object({
  suitcaseStatus: z.enum(SUITCASE_STATUSES),
  generalNotes: optionalText(2000),
  assets: z.array(assetLineSchema),
  accessories: z.array(accessoryLineSchema),
})
export type EquipmentVerificationInput = z.output<typeof equipmentVerificationSchema>

// -----------------------------------------------------------------------------
// Checklist and software step
// -----------------------------------------------------------------------------

export const checklistAnswerSchema = z.object({
  id: z.string().min(1),
  status: z.preprocess(emptyToUndefined, z.enum(CHECKLIST_STATUSES).optional()),
  notes: optionalText(500),
})
export type ChecklistAnswerInput = z.output<typeof checklistAnswerSchema>

export const softwareAnswerSchema = z.object({
  id: z.string().min(1),
  status: z.enum(SOFTWARE_STATUSES),
  installedVersion: optionalText(60),
  notes: optionalText(500),
})
export type SoftwareAnswerInput = z.output<typeof softwareAnswerSchema>

export const checklistVerificationSchema = z.object({
  checks: z.array(checklistAnswerSchema),
  software: z.array(softwareAnswerSchema),
})
export type ChecklistVerificationInput = z.output<typeof checklistVerificationSchema>

// -----------------------------------------------------------------------------
// Signatures and completion
// -----------------------------------------------------------------------------

/** A 640×240 PNG from the pad is ~20 KB; this leaves room without inviting abuse. */
export const SIGNATURE_MAX_DATA_URL_CHARS = 400_000

/**
 * The recipient signs with a typed name and mobile; the engineer's identity is
 * never posted - it comes from the session. The service enforces which role
 * the two text fields belong to, so a client cannot rename the engineer.
 */
export const signatureSchema = z.object({
  role: z.enum(SIGNER_ROLES),
  image: z
    .string()
    .min(1, 'Sign before saving.')
    .max(SIGNATURE_MAX_DATA_URL_CHARS, 'The signature image is too large.')
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'The signature must be a PNG image.'),
  recipientName: optionalText(120),
  recipientMobile: optionalText(40),
})
export type SignatureInput = z.output<typeof signatureSchema>

export const completeHandoverSchema = z.object({
  confirm: z.literal('true', { message: 'Confirm that the equipment has been handed over.' }),
})

// -----------------------------------------------------------------------------
// Form parsing
// -----------------------------------------------------------------------------

/**
 * Collects `prefix.<id>.<field>` entries into one object per id. Repeated ids
 * merge; unknown fields are kept for the Zod schema to reject.
 */
export function parseLineFields(formData: FormData, prefix: string): Array<Record<string, string>> {
  const byId = new Map<string, Record<string, string>>()
  const pattern = new RegExp(`^${prefix}\\.([^.]+)\\.([^.]+)$`)
  for (const [key, value] of formData.entries()) {
    const match = pattern.exec(key)
    if (!match || typeof value !== 'string') continue
    const [, id, field] = match
    const entry = byId.get(id) ?? { id }
    entry[field] = value
    byId.set(id, entry)
  }
  return [...byId.values()]
}
