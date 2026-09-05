'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createKitSchema, formDataToObject, updateKitSchema } from '@/lib/validation/kits'
import { action, type ActionResult } from '@/server/auth/action'
import { prisma } from '@/server/db/prisma'
import { createKit, removeKit, updateKit } from '@/server/services/kits.service'

/**
 * Kit mutations. Each is built with `action()` - permission, Zod validation
 * and safe failure are not optional - and hands the authorised actor to the
 * service. Successful writes redirect to the kit workspace.
 */

export type KitFormState = ActionResult<void> | null

const createKitAction = action({
  permission: 'kit.manage',
  schema: createKitSchema,
  async handler({ actor, input }) {
    const created = await createKit(prisma, actor, input)
    redirect(`/kits/${created.id}`)
  },
})

export async function createKitFormAction(_previous: KitFormState, formData: FormData): Promise<KitFormState> {
  return createKitAction(formDataToObject(formData))
}

const updateKitAction = action({
  permission: 'kit.manage',
  schema: updateKitSchema.extend({ id: z.string().min(1) }),
  async handler({ actor, input }) {
    const { id, ...rest } = input
    await updateKit(prisma, actor, id, rest)
    redirect(`/kits/${id}`)
  },
})

export async function updateKitFormAction(_previous: KitFormState, formData: FormData): Promise<KitFormState> {
  return updateKitAction(formDataToObject(formData))
}

const removeKitAction = action({
  permission: 'kit.manage',
  schema: z.object({ id: z.string().min(1) }),
  async handler({ actor, input }) {
    await removeKit(prisma, actor, input.id)
    redirect('/kits')
  },
})

export async function removeKitFormAction(_previous: KitFormState, formData: FormData): Promise<KitFormState> {
  return removeKitAction(formDataToObject(formData))
}
