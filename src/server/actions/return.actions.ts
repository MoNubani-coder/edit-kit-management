'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  completeReturnSchema,
  formDataToObject,
  parseLineFields,
  returnAccessoryLineSchema,
  returnAssetLineSchema,
  returnCheckSchema,
  returnEquipmentSchema,
  returnSignatureSchema,
} from '@/lib/validation/return'
import { action, type ActionResult } from '@/server/auth/action'
import { requestContextFrom } from '@/server/auth/credentials'
import { prisma } from '@/server/db/prisma'
import { captureReturnSignature, completeReturn, saveReturnChecklist, saveReturnEquipment, startReturn } from '@/server/services/return.service'
import { signatureStore } from '@/server/storage/signature-store'

/**
 * Return mutations. `return.perform` covers starting, recording and signing;
 * `return.complete` covers closing the booking. Every action re-reads the
 * booking and its handover on the server - the form carries ids, never facts.
 */

export type ReturnFormState = ActionResult<void> | null

const bookingId = z.object({ bookingId: z.string().min(1) })

const startReturnAction = action({
  permission: 'return.perform',
  schema: bookingId,
  async handler({ actor, input }) {
    await startReturn(prisma, actor, input.bookingId)
    redirect(`/bookings/${input.bookingId}/return`)
  },
})

export async function startReturnFormAction(_previous: ReturnFormState, formData: FormData): Promise<ReturnFormState> {
  return startReturnAction(formDataToObject(formData))
}

const saveReturnEquipmentAction = action({
  permission: 'return.perform',
  schema: returnEquipmentSchema.extend(bookingId.shape),
  async handler({ actor, input }) {
    const { bookingId, ...rest } = input
    await saveReturnEquipment(prisma, actor, bookingId, rest)
    redirect(`/bookings/${bookingId}/return#checklist`)
  },
})

export async function saveReturnEquipmentFormAction(_previous: ReturnFormState, formData: FormData): Promise<ReturnFormState> {
  const flat = formDataToObject(formData)
  return saveReturnEquipmentAction({
    bookingId: flat.bookingId,
    suitcaseStatus: flat.suitcaseStatus,
    generalNotes: flat.generalNotes,
    assets: parseLineFields(formData, 'asset').map((line) => returnAssetLineSchema.safeParse(line).data ?? line),
    accessories: parseLineFields(formData, 'accessory').map((line) => returnAccessoryLineSchema.safeParse(line).data ?? line),
  })
}

const saveReturnChecklistAction = action({
  permission: 'return.perform',
  schema: z.object({ bookingId: z.string().min(1), checks: z.array(returnCheckSchema) }),
  async handler({ actor, input }) {
    const { bookingId, checks } = input
    await saveReturnChecklist(prisma, actor, bookingId, { checks })
    redirect(`/bookings/${bookingId}/return#signature`)
  },
})

export async function saveReturnChecklistFormAction(_previous: ReturnFormState, formData: FormData): Promise<ReturnFormState> {
  const flat = formDataToObject(formData)
  return saveReturnChecklistAction({ bookingId: flat.bookingId, checks: parseLineFields(formData, 'check') })
}

const captureReturnSignatureAction = action({
  permission: 'return.perform',
  schema: returnSignatureSchema.extend(bookingId.shape),
  async handler({ actor, input }) {
    // IP and user agent are evidence, not requirements: outside a request scope
    // (tests, scripts) the signature is stored without them.
    let context: ReturnType<typeof requestContextFrom> = { ipAddress: null, userAgent: null }
    try {
      context = requestContextFrom(await headers())
    } catch {
      /* no request scope */
    }
    await captureReturnSignature(prisma, actor, input.bookingId, input.role, input.image, signatureStore, { ...context, recipientName: input.recipientName ?? null, recipientMobile: input.recipientMobile ?? null })
    redirect(`/bookings/${input.bookingId}/return#signature`)
  },
})

export async function captureReturnSignatureFormAction(_previous: ReturnFormState, formData: FormData): Promise<ReturnFormState> {
  return captureReturnSignatureAction(formDataToObject(formData))
}

const completeReturnAction = action({
  permission: 'return.complete',
  schema: completeReturnSchema.extend(bookingId.shape),
  async handler({ actor, input }) {
    // Who brought the kit back is typed; who received it is the actor.
    await completeReturn(prisma, actor, input.bookingId, input.returnedByName)
    redirect(`/bookings/${input.bookingId}`)
  },
})

export async function completeReturnFormAction(_previous: ReturnFormState, formData: FormData): Promise<ReturnFormState> {
  return completeReturnAction(formDataToObject(formData))
}
