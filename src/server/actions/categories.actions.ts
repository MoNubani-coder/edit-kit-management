'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { categoryInputSchema, formDataToObject } from '@/lib/validation/assets'
import { action, type ActionResult } from '@/server/auth/action'
import { prisma } from '@/server/db/prisma'
import { createCategory, setCategoryActive, updateCategory } from '@/server/services/categories.service'

export type CategoryFormState = ActionResult<void> | null

const CATEGORIES_PATH = '/admin/categories'

const createCategoryAction = action({
  permission: 'admin.categories.manage',
  schema: categoryInputSchema,
  async handler({ actor, input }) {
    await createCategory(prisma, actor, input)
    redirect(CATEGORIES_PATH)
  },
})

export async function createCategoryFormAction(_previous: CategoryFormState, formData: FormData): Promise<CategoryFormState> {
  return createCategoryAction(formDataToObject(formData))
}

const updateCategoryAction = action({
  permission: 'admin.categories.manage',
  schema: categoryInputSchema.extend({ id: z.string().min(1) }),
  async handler({ actor, input }) {
    const { id, ...rest } = input
    await updateCategory(prisma, actor, id, rest)
    redirect(CATEGORIES_PATH)
  },
})

export async function updateCategoryFormAction(_previous: CategoryFormState, formData: FormData): Promise<CategoryFormState> {
  return updateCategoryAction(formDataToObject(formData))
}

const setCategoryActiveAction = action({
  permission: 'admin.categories.manage',
  schema: z.object({ id: z.string().min(1), isActive: z.enum(['true', 'false']).transform((value) => value === 'true') }),
  async handler({ actor, input }) {
    await setCategoryActive(prisma, actor, input.id, input.isActive)
    revalidatePath(CATEGORIES_PATH)
  },
})

export async function setCategoryActiveFormAction(_previous: CategoryFormState, formData: FormData): Promise<CategoryFormState> {
  return setCategoryActiveAction(formDataToObject(formData))
}
