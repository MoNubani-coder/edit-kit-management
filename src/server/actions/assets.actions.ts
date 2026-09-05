'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createAssetSchema, formDataToObject, updateAssetSchema } from '@/lib/validation/assets'
import { action, type ActionResult } from '@/server/auth/action'
import { prisma } from '@/server/db/prisma'
import { createAsset, removeAsset, updateAsset } from '@/server/services/assets.service'

/**
 * Equipment mutations. Each is built with `action()` - permission, Zod
 * validation and safe failure are not optional - and hands the authorised
 * actor to the service. Successful writes redirect to the asset workspace.
 */

export type AssetFormState = ActionResult<void> | null

const createAssetAction = action({
  permission: 'asset.manage',
  schema: createAssetSchema,
  async handler({ actor, input }) {
    const created = await createAsset(prisma, actor, input)
    redirect(`/assets/${created.id}`)
  },
})

export async function createAssetFormAction(_previous: AssetFormState, formData: FormData): Promise<AssetFormState> {
  return createAssetAction(formDataToObject(formData))
}

const updateAssetAction = action({
  permission: 'asset.manage',
  schema: updateAssetSchema.extend({ id: z.string().min(1) }),
  async handler({ actor, input }) {
    const { id, ...rest } = input
    await updateAsset(prisma, actor, id, rest)
    redirect(`/assets/${id}`)
  },
})

export async function updateAssetFormAction(_previous: AssetFormState, formData: FormData): Promise<AssetFormState> {
  return updateAssetAction(formDataToObject(formData))
}

const removeAssetAction = action({
  permission: 'asset.manage',
  schema: z.object({ id: z.string().min(1) }),
  async handler({ actor, input }) {
    await removeAsset(prisma, actor, input.id)
    redirect('/assets')
  },
})

export async function removeAssetFormAction(_previous: AssetFormState, formData: FormData): Promise<AssetFormState> {
  return removeAssetAction(formDataToObject(formData))
}
