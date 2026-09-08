import { z } from 'zod'

import { formDataToObject } from './assets'
import { ITEM_CONDITIONS, parseLineFields, SIGNATURE_MAX_DATA_URL_CHARS, SIGNER_ROLES } from './handover'
import { SUITCASE_STATUSES } from './kits'

/**
 * Return-inspection schemas.
 *
 * The same `ItemConditionStatus` values the handover uses, read from the other
 * direction: the question is no longer "did it go into the case" but "did it
 * come back". `NOT_APPLICABLE` carries the extra meaning of "no answer yet" for
 * an item that went out, which is what lets the service insist on an explicit
 * answer for everything that was handed over.
 *
 * Line fields arrive as `asset.<id>.status` / `accessory.<id>.quantityReceived`
 * and are collected by the shared `parseLineFields`. No Prisma import.
 */

export { formDataToObject, ITEM_CONDITIONS, parseLineFields, SIGNER_ROLES }
export type { ItemCondition, SignerRoleValue } from './handover'

export const RETURN_CONDITION_LABELS: Record<(typeof ITEM_CONDITIONS)[number], string> = {
  INCLUDED: 'Returned',
  MISSING: 'Not returned',
  DAMAGED: 'Returned damaged',
  NOT_APPLICABLE: 'Not applicable',
}

/** What an engineer may record for something that actually went out. */
export const ANSWERED_RETURN_CONDITIONS = ['INCLUDED', 'DAMAGED', 'MISSING'] as const
export type AnsweredReturnCondition = (typeof ANSWERED_RETURN_CONDITIONS)[number]

export const RETURN_CHECKLIST_STATUSES = ['PASS', 'FAIL', 'NOT_APPLICABLE'] as const

const emptyToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value)
const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max, `Use at most ${max} characters.`).optional())

// -----------------------------------------------------------------------------
// Equipment and accessories
// -----------------------------------------------------------------------------

export const returnAssetLineSchema = z.object({
  id: z.string().min(1),
  status: z.enum(ITEM_CONDITIONS),
  notes: optionalText(500),
})
export type ReturnAssetLineInput = z.output<typeof returnAssetLineSchema>

export const returnAccessoryLineSchema = z.object({
  id: z.string().min(1),
  status: z.enum(ITEM_CONDITIONS),
  quantityReceived: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(99).optional()),
  notes: optionalText(500),
})
export type ReturnAccessoryLineInput = z.output<typeof returnAccessoryLineSchema>

export const returnEquipmentSchema = z.object({
  suitcaseStatus: z.enum(SUITCASE_STATUSES),
  generalNotes: optionalText(2000),
  assets: z.array(returnAssetLineSchema),
  accessories: z.array(returnAccessoryLineSchema),
})
export type ReturnEquipmentInput = z.output<typeof returnEquipmentSchema>

// -----------------------------------------------------------------------------
// Return checklist
// -----------------------------------------------------------------------------

export const returnCheckSchema = z.object({
  id: z.string().min(1),
  status: z.preprocess(emptyToUndefined, z.enum(RETURN_CHECKLIST_STATUSES).optional()),
  notes: optionalText(500),
})
export type ReturnCheckInput = z.output<typeof returnCheckSchema>

export const returnChecklistSchema = z.object({ checks: z.array(returnCheckSchema) })
export type ReturnChecklistInput = z.output<typeof returnChecklistSchema>

// -----------------------------------------------------------------------------
// Signature and completion
// -----------------------------------------------------------------------------

export const returnSignatureSchema = z.object({
  role: z.enum(SIGNER_ROLES),
  image: z
    .string()
    .min(1, 'Sign before saving.')
    .max(SIGNATURE_MAX_DATA_URL_CHARS, 'The signature image is too large.')
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'The signature must be a PNG image.'),
  /** The person returning the kit, when they sign too. Ignored for the engineer. */
  recipientName: optionalText(120),
  recipientMobile: optionalText(40),
})
export type ReturnSignatureInput = z.output<typeof returnSignatureSchema>

/**
 * Completion names the person who physically brought the kit back. It is a
 * typed field because that person may have no account; who *received* it is
 * the authenticated engineer and is never posted.
 */
export const completeReturnSchema = z.object({
  confirm: z.literal('true', { message: 'Confirm that the kit has been received back.' }),
  returnedByName: z.string().trim().min(2, 'Enter who returned the kit.').max(120, 'Use at most 120 characters.'),
})
