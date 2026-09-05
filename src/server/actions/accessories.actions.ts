'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { accessoryInputSchema, formDataToObject } from '@/lib/validation/assets'
import { action, type ActionResult } from '@/server/auth/action'
import { prisma } from '@/server/db/prisma'
import { addAccessory, removeAccessory, updateAccessory } from '@/server/services/assets.service'

export type AccessoryFormState = ActionResult<void> | null

const addAccessoryAction = action({
  permission: 'asset.manage',
  schema: accessoryInputSchema.extend({ assetId: z.string().min(1) }),
  async handler({ actor, input }) {
    const { assetId, ...rest } = input
    await addAccessory(prisma, actor, assetId, rest)
    redirect(`/assets/${assetId}?tab=accessories`)
  },
})

export async function addAccessoryFormAction(_previous: AccessoryFormState, formData: FormData): Promise<AccessoryFormState> {
  return addAccessoryAction(formDataToObject(formData))
}

const updateAccessoryAction = action({
  permission: 'asset.manage',
  schema: accessoryInputSchema.extend({ accessoryId: z.string().min(1) }),
  async handler({ actor, input }) {
    const { accessoryId, ...rest } = input
    const result = await updateAccessory(prisma, actor, accessoryId, rest)
    redirect(`/assets/${result.assetId}?tab=accessories`)
  },
})

export async function updateAccessoryFormAction(_previous: AccessoryFormState, formData: FormData): Promise<AccessoryFormState> {
  return updateAccessoryAction(formDataToObject(formData))
}

const removeAccessoryAction = action({
  permission: 'asset.manage',
  schema: z.object({ accessoryId: z.string().min(1) }),
  async handler({ actor, input }) {
    const result = await removeAccessory(prisma, actor, input.accessoryId)
    redirect(`/assets/${result.assetId}?tab=accessories`)
  },
})

export async function removeAccessoryFormAction(_previous: AccessoryFormState, formData: FormData): Promise<AccessoryFormState> {
  return removeAccessoryAction(formDataToObject(formData))
}
