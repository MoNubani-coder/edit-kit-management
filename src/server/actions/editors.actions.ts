'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createEditorSchema, editorActiveSchema, editorLinkSchema, formDataToObject, updateEditorSchema } from '@/lib/validation/editors'
import { action, type ActionResult } from '@/server/auth/action'
import { prisma } from '@/server/db/prisma'
import { createEditor, linkEditorUser, removeEditor, setEditorActive, unlinkEditorUser, updateEditor } from '@/server/services/editors.service'

/**
 * Editor profile mutations. Each is built with `action()` - permission, Zod
 * validation and safe failure are not optional - and requires `editor.manage`.
 */

export type EditorFormState = ActionResult<void> | null

const id = z.object({ id: z.string().min(1) })

const createEditorAction = action({
  permission: 'editor.manage',
  schema: createEditorSchema,
  async handler({ actor, input }) {
    const created = await createEditor(prisma, actor, input)
    redirect(`/editors/${created.id}`)
  },
})

export async function createEditorFormAction(_previous: EditorFormState, formData: FormData): Promise<EditorFormState> {
  return createEditorAction(formDataToObject(formData))
}

const updateEditorAction = action({
  permission: 'editor.manage',
  schema: updateEditorSchema.extend(id.shape),
  async handler({ actor, input }) {
    const { id, ...rest } = input
    await updateEditor(prisma, actor, id, rest)
    redirect(`/editors/${id}`)
  },
})

export async function updateEditorFormAction(_previous: EditorFormState, formData: FormData): Promise<EditorFormState> {
  return updateEditorAction(formDataToObject(formData))
}

const setEditorActiveAction = action({
  permission: 'editor.manage',
  schema: editorActiveSchema.extend(id.shape),
  async handler({ actor, input }) {
    const { id, ...rest } = input
    await setEditorActive(prisma, actor, id, rest)
    redirect(`/editors/${id}`)
  },
})

export async function setEditorActiveFormAction(_previous: EditorFormState, formData: FormData): Promise<EditorFormState> {
  return setEditorActiveAction(formDataToObject(formData))
}

const linkEditorUserAction = action({
  permission: 'editor.manage',
  schema: editorLinkSchema.extend(id.shape),
  async handler({ actor, input }) {
    await linkEditorUser(prisma, actor, input.id, input.userId)
    redirect(`/editors/${input.id}`)
  },
})

export async function linkEditorUserFormAction(_previous: EditorFormState, formData: FormData): Promise<EditorFormState> {
  return linkEditorUserAction(formDataToObject(formData))
}

const unlinkEditorUserAction = action({
  permission: 'editor.manage',
  schema: id,
  async handler({ actor, input }) {
    await unlinkEditorUser(prisma, actor, input.id)
    redirect(`/editors/${input.id}`)
  },
})

export async function unlinkEditorUserFormAction(_previous: EditorFormState, formData: FormData): Promise<EditorFormState> {
  return unlinkEditorUserAction(formDataToObject(formData))
}

const removeEditorAction = action({
  permission: 'editor.manage',
  schema: id,
  async handler({ actor, input }) {
    await removeEditor(prisma, actor, input.id)
    redirect('/editors')
  },
})

export async function removeEditorFormAction(_previous: EditorFormState, formData: FormData): Promise<EditorFormState> {
  return removeEditorAction(formDataToObject(formData))
}
