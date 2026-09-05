'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  formDataToObject,
  kitChecklistInputSchema,
  kitMemberInputSchema,
  kitMemberUpdateSchema,
  kitSoftwareInputSchema,
} from '@/lib/validation/kits'
import { action, type ActionResult } from '@/server/auth/action'
import { prisma } from '@/server/db/prisma'
import {
  addKitAsset,
  addKitSoftware,
  removeKitAsset,
  removeKitSoftware,
  setKitChecklistTemplate,
  updateKitAsset,
} from '@/server/services/kits.service'

/**
 * What goes into a kit: equipment membership, software expectations and the
 * handover checklist template. All require `kit.manage`; every rule about
 * whether an asset may join or leave is checked in the service and backed by
 * the database constraints.
 */

export type KitCompositionState = ActionResult<void> | null

const kitId = z.object({ kitId: z.string().min(1) })

const addKitAssetAction = action({
  permission: 'kit.manage',
  schema: kitMemberInputSchema.extend(kitId.shape),
  async handler({ actor, input }) {
    const { kitId, ...rest } = input
    await addKitAsset(prisma, actor, kitId, rest)
    redirect(`/kits/${kitId}?tab=equipment`)
  },
})

export async function addKitAssetFormAction(_previous: KitCompositionState, formData: FormData): Promise<KitCompositionState> {
  return addKitAssetAction(formDataToObject(formData))
}

const updateKitAssetAction = action({
  permission: 'kit.manage',
  schema: kitMemberUpdateSchema.extend({ kitAssetId: z.string().min(1) }),
  async handler({ actor, input }) {
    const { kitAssetId, ...rest } = input
    const result = await updateKitAsset(prisma, actor, kitAssetId, rest)
    redirect(`/kits/${result.kitId}?tab=equipment`)
  },
})

export async function updateKitAssetFormAction(_previous: KitCompositionState, formData: FormData): Promise<KitCompositionState> {
  return updateKitAssetAction(formDataToObject(formData))
}

const removeKitAssetAction = action({
  permission: 'kit.manage',
  schema: z.object({ kitAssetId: z.string().min(1) }),
  async handler({ actor, input }) {
    const result = await removeKitAsset(prisma, actor, input.kitAssetId)
    redirect(`/kits/${result.kitId}?tab=equipment`)
  },
})

export async function removeKitAssetFormAction(_previous: KitCompositionState, formData: FormData): Promise<KitCompositionState> {
  return removeKitAssetAction(formDataToObject(formData))
}

const addKitSoftwareAction = action({
  permission: 'kit.manage',
  schema: kitSoftwareInputSchema.extend(kitId.shape),
  async handler({ actor, input }) {
    const { kitId, ...rest } = input
    await addKitSoftware(prisma, actor, kitId, rest)
    redirect(`/kits/${kitId}?tab=software`)
  },
})

export async function addKitSoftwareFormAction(_previous: KitCompositionState, formData: FormData): Promise<KitCompositionState> {
  return addKitSoftwareAction(formDataToObject(formData))
}

const removeKitSoftwareAction = action({
  permission: 'kit.manage',
  schema: z.object({ kitSoftwareId: z.string().min(1) }),
  async handler({ actor, input }) {
    const result = await removeKitSoftware(prisma, actor, input.kitSoftwareId)
    redirect(`/kits/${result.kitId}?tab=software`)
  },
})

export async function removeKitSoftwareFormAction(_previous: KitCompositionState, formData: FormData): Promise<KitCompositionState> {
  return removeKitSoftwareAction(formDataToObject(formData))
}

const setKitChecklistAction = action({
  permission: 'kit.manage',
  schema: kitChecklistInputSchema.extend(kitId.shape),
  async handler({ actor, input }) {
    const { kitId, ...rest } = input
    await setKitChecklistTemplate(prisma, actor, kitId, rest)
    redirect(`/kits/${kitId}?tab=checklist`)
  },
})

export async function setKitChecklistFormAction(_previous: KitCompositionState, formData: FormData): Promise<KitCompositionState> {
  return setKitChecklistAction(formDataToObject(formData))
}
