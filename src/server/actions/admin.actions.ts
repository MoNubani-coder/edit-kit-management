'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  checklistItemInputSchema,
  checklistTemplateInputSchema,
  formDataToObject,
  setUserRoleSchema,
  softwareInputSchema,
  unlockUserSchema,
} from '@/lib/validation/admin'
import { setUserStatus } from '@/server/actions/admin-users.actions'
import { action, type ActionResult } from '@/server/auth/action'
import { prisma } from '@/server/db/prisma'
import {
  addChecklistItem,
  createChecklistTemplate,
  createSoftware,
  removeChecklistItem,
  setChecklistTemplateActive,
  setChecklistTemplateDefault,
  setSoftwareActive,
  setUserRole,
  unlockUser,
  updateChecklistItem,
  updateChecklistTemplate,
  updateSoftware,
} from '@/server/services/admin.service'

/**
 * Administration actions.
 *
 * Every one is a public endpoint (AD-7): the permission and the schema are
 * declared on the wrapper, so an action cannot be reached by a role that lacks
 * the permission even if the page that offers it is never rendered. The
 * permissions are the specific ones - `admin.users.manage`,
 * `admin.software.manage`, `admin.checklists.manage` - rather than a blanket
 * administrator check, so the matrix stays the single source of truth.
 *
 * There is deliberately no action here that sets a password. Doing that from a
 * browser means deciding how the new password reaches the person, which is a
 * decision with a security answer, not a UI answer; the break-glass path
 * remains `npm run auth:reset-password`, which revokes their sessions.
 */

export type AdminFormState = ActionResult<void> | null

const USERS_PATH = '/admin/users'
const SOFTWARE_PATH = '/admin/software'
const CHECKLISTS_PATH = '/admin/checklists'

// -----------------------------------------------------------------------------
// Accounts
// -----------------------------------------------------------------------------

const setUserRoleAction = action({
  permission: 'admin.users.manage',
  schema: setUserRoleSchema,
  async handler({ actor, input }) {
    await setUserRole(prisma, actor, input.userId, input.role, input.reason)
    revalidatePath(USERS_PATH)
  },
})

export async function setUserRoleFormAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  return setUserRoleAction(formDataToObject(formData))
}

/**
 * Suspension and re-activation.
 *
 * This is the Phase 2 action, unchanged and called directly rather than
 * re-implemented: it authorises on `admin.users.manage`, refuses an
 * administrator changing their own status, bumps `sessionVersion` so the
 * change takes effect on the target's next request, and audits it. The form
 * here is the way in that was missing.
 */
export async function setUserStatusFormAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const result = await setUserStatus(formDataToObject(formData))
  if (result.ok) revalidatePath(USERS_PATH)
  return result.ok ? { ok: true, data: undefined } : result
}

const unlockUserAction = action({
  permission: 'admin.users.manage',
  schema: unlockUserSchema,
  async handler({ actor, input }) {
    await unlockUser(prisma, actor, input.userId)
    revalidatePath(USERS_PATH)
  },
})

export async function unlockUserFormAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  return unlockUserAction(formDataToObject(formData))
}

// -----------------------------------------------------------------------------
// Software catalogue
// -----------------------------------------------------------------------------

const createSoftwareAction = action({
  permission: 'admin.software.manage',
  schema: softwareInputSchema,
  async handler({ actor, input }) {
    await createSoftware(prisma, actor, input)
    redirect(SOFTWARE_PATH)
  },
})

export async function createSoftwareFormAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  return createSoftwareAction(formDataToObject(formData))
}

const updateSoftwareAction = action({
  permission: 'admin.software.manage',
  schema: softwareInputSchema.extend({ id: z.string().min(1) }),
  async handler({ actor, input }) {
    const { id, ...rest } = input
    await updateSoftware(prisma, actor, id, rest)
    redirect(SOFTWARE_PATH)
  },
})

export async function updateSoftwareFormAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  return updateSoftwareAction(formDataToObject(formData))
}

const setSoftwareActiveAction = action({
  permission: 'admin.software.manage',
  schema: z.object({ id: z.string().min(1), isActive: z.enum(['true', 'false']).transform((value) => value === 'true') }),
  async handler({ actor, input }) {
    await setSoftwareActive(prisma, actor, input.id, input.isActive)
    revalidatePath(SOFTWARE_PATH)
  },
})

export async function setSoftwareActiveFormAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  return setSoftwareActiveAction(formDataToObject(formData))
}

// -----------------------------------------------------------------------------
// Checklist templates
// -----------------------------------------------------------------------------

const createTemplateAction = action({
  permission: 'admin.checklists.manage',
  schema: checklistTemplateInputSchema,
  async handler({ actor, input }) {
    const { id } = await createChecklistTemplate(prisma, actor, input)
    redirect(`${CHECKLISTS_PATH}?template=${id}`)
  },
})

export async function createTemplateFormAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  return createTemplateAction(formDataToObject(formData))
}

const updateTemplateAction = action({
  permission: 'admin.checklists.manage',
  schema: checklistTemplateInputSchema.extend({ id: z.string().min(1) }),
  async handler({ actor, input }) {
    const { id, ...rest } = input
    await updateChecklistTemplate(prisma, actor, id, rest)
    revalidatePath(CHECKLISTS_PATH)
  },
})

export async function updateTemplateFormAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  return updateTemplateAction(formDataToObject(formData))
}

const setTemplateActiveAction = action({
  permission: 'admin.checklists.manage',
  schema: z.object({ id: z.string().min(1), isActive: z.enum(['true', 'false']).transform((value) => value === 'true') }),
  async handler({ actor, input }) {
    await setChecklistTemplateActive(prisma, actor, input.id, input.isActive)
    revalidatePath(CHECKLISTS_PATH)
  },
})

export async function setTemplateActiveFormAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  return setTemplateActiveAction(formDataToObject(formData))
}

const setTemplateDefaultAction = action({
  permission: 'admin.checklists.manage',
  schema: z.object({ id: z.string().min(1) }),
  async handler({ actor, input }) {
    await setChecklistTemplateDefault(prisma, actor, input.id)
    revalidatePath(CHECKLISTS_PATH)
  },
})

export async function setTemplateDefaultFormAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  return setTemplateDefaultAction(formDataToObject(formData))
}

const addItemAction = action({
  permission: 'admin.checklists.manage',
  schema: checklistItemInputSchema.extend({ templateId: z.string().min(1) }),
  async handler({ actor, input }) {
    const { templateId, ...rest } = input
    await addChecklistItem(prisma, actor, templateId, rest)
    revalidatePath(CHECKLISTS_PATH)
  },
})

export async function addItemFormAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  return addItemAction(formDataToObject(formData))
}

const updateItemAction = action({
  permission: 'admin.checklists.manage',
  schema: checklistItemInputSchema.extend({ itemId: z.string().min(1) }),
  async handler({ actor, input }) {
    const { itemId, ...rest } = input
    await updateChecklistItem(prisma, actor, itemId, rest)
    revalidatePath(CHECKLISTS_PATH)
  },
})

export async function updateItemFormAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  return updateItemAction(formDataToObject(formData))
}

const removeItemAction = action({
  permission: 'admin.checklists.manage',
  schema: z.object({ itemId: z.string().min(1) }),
  async handler({ actor, input }) {
    await removeChecklistItem(prisma, actor, input.itemId)
    revalidatePath(CHECKLISTS_PATH)
  },
})

export async function removeItemFormAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  return removeItemAction(formDataToObject(formData))
}
