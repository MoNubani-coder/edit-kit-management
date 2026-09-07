'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  accessoryLineSchema,
  assetLineSchema,
  checklistAnswerSchema,
  completeHandoverSchema,
  equipmentVerificationSchema,
  formDataToObject,
  parseLineFields,
  signatureSchema,
  softwareAnswerSchema,
} from '@/lib/validation/handover'
import { action, type ActionResult } from '@/server/auth/action'
import { requestContextFrom } from '@/server/auth/credentials'
import { prisma } from '@/server/db/prisma'
import { captureSignature, completeHandover, saveChecklistVerification, saveEquipmentVerification, startHandover } from '@/server/services/handover.service'
import { signatureStore } from '@/server/storage/signature-store'

/**
 * Handover mutations. `handover.perform` covers starting, verifying and
 * signing; `handover.complete` covers the final step. Every action re-reads
 * the booking on the server - the form carries ids, never facts.
 */

export type HandoverFormState = ActionResult<void> | null

const bookingId = z.object({ bookingId: z.string().min(1) })

const startHandoverAction = action({
  permission: 'handover.perform',
  schema: bookingId,
  async handler({ actor, input }) {
    await startHandover(prisma, actor, input.bookingId)
    redirect(`/bookings/${input.bookingId}/handover`)
  },
})

export async function startHandoverFormAction(_previous: HandoverFormState, formData: FormData): Promise<HandoverFormState> {
  return startHandoverAction(formDataToObject(formData))
}

const saveEquipmentAction = action({
  permission: 'handover.perform',
  schema: equipmentVerificationSchema.extend(bookingId.shape),
  async handler({ actor, input }) {
    const { bookingId, ...rest } = input
    await saveEquipmentVerification(prisma, actor, bookingId, rest)
    redirect(`/bookings/${bookingId}/handover#checklist`)
  },
})

export async function saveEquipmentFormAction(_previous: HandoverFormState, formData: FormData): Promise<HandoverFormState> {
  const flat = formDataToObject(formData)
  return saveEquipmentAction({
    bookingId: flat.bookingId,
    suitcaseStatus: flat.suitcaseStatus,
    generalNotes: flat.generalNotes,
    assets: parseLineFields(formData, 'asset').map((line) => assetLineSchema.safeParse(line).data ?? line),
    accessories: parseLineFields(formData, 'accessory').map((line) => accessoryLineSchema.safeParse(line).data ?? line),
  })
}

const saveChecklistAction = action({
  permission: 'handover.perform',
  schema: z.object({ bookingId: z.string().min(1), checks: z.array(checklistAnswerSchema), software: z.array(softwareAnswerSchema) }),
  async handler({ actor, input }) {
    const { bookingId, ...rest } = input
    await saveChecklistVerification(prisma, actor, bookingId, rest)
    redirect(`/bookings/${bookingId}/handover#signatures`)
  },
})

export async function saveChecklistFormAction(_previous: HandoverFormState, formData: FormData): Promise<HandoverFormState> {
  const flat = formDataToObject(formData)
  return saveChecklistAction({
    bookingId: flat.bookingId,
    checks: parseLineFields(formData, 'check'),
    software: parseLineFields(formData, 'software'),
  })
}

const captureSignatureAction = action({
  permission: 'handover.perform',
  schema: signatureSchema.extend(bookingId.shape),
  async handler({ actor, input }) {
    // IP and user agent are evidence, not requirements: outside a request scope
    // (tests, scripts) the signature is stored without them.
    let context: ReturnType<typeof requestContextFrom> = { ipAddress: null, userAgent: null }
    try {
      context = requestContextFrom(await headers())
    } catch {
      /* no request scope */
    }
    await captureSignature(prisma, actor, input.bookingId, input.role, input.image, signatureStore, context)
    redirect(`/bookings/${input.bookingId}/handover#signatures`)
  },
})

export async function captureSignatureFormAction(_previous: HandoverFormState, formData: FormData): Promise<HandoverFormState> {
  return captureSignatureAction(formDataToObject(formData))
}

const completeHandoverAction = action({
  permission: 'handover.complete',
  schema: completeHandoverSchema.extend(bookingId.shape),
  async handler({ actor, input }) {
    await completeHandover(prisma, actor, input.bookingId)
    redirect(`/bookings/${input.bookingId}`)
  },
})

export async function completeHandoverFormAction(_previous: HandoverFormState, formData: FormData): Promise<HandoverFormState> {
  return completeHandoverAction(formDataToObject(formData))
}
