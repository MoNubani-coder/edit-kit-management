'use server'

import { InspectionType } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { action, type ActionResult } from '@/server/auth/action'
import { prisma } from '@/server/db/prisma'
import { addInspectionPhoto, addIssuePhoto } from '@/server/services/photos.service'
import { photoStore } from '@/server/storage/photo-store'

/**
 * Photo evidence uploads.
 *
 * The file itself never goes through Zod - it is validated by its bytes in the
 * storage layer - so the schema covers the ids and the caption, and the `File`
 * is passed through under a permissive key. `handover.perform` covers handover
 * photos and `return.perform` return photos, which keeps evidence in the same
 * hands as the workflow it documents.
 */

export type PhotoFormState = ActionResult<{ id: string }> | null

const photoInput = z.object({
  bookingId: z.string().min(1),
  caption: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().trim().max(200).optional()),
  file: z.custom<File>((value) => value instanceof File, 'Choose a photo to upload.'),
})

const uploadHandoverPhoto = action({
  permission: 'handover.perform',
  schema: photoInput,
  async handler({ actor, input }) {
    const photo = await addInspectionPhoto(prisma, actor, { bookingId: input.bookingId, type: InspectionType.HANDOVER, file: input.file, caption: input.caption }, photoStore)
    revalidatePath(`/bookings/${input.bookingId}/handover`)
    return { id: photo.id }
  },
})

const uploadReturnPhoto = action({
  permission: 'return.perform',
  schema: photoInput,
  async handler({ actor, input }) {
    const photo = await addInspectionPhoto(prisma, actor, { bookingId: input.bookingId, type: InspectionType.RETURN, file: input.file, caption: input.caption }, photoStore)
    revalidatePath(`/bookings/${input.bookingId}/return`)
    return { id: photo.id }
  },
})

const issuePhotoInput = z.object({
  issueId: z.string().min(1),
  caption: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().trim().max(200).optional()),
  file: z.custom<File>((value) => value instanceof File, 'Choose a photo to upload.'),
})

const uploadIssuePhoto = action({
  permission: 'issue.manage',
  schema: issuePhotoInput,
  async handler({ actor, input }) {
    const photo = await addIssuePhoto(prisma, actor, { issueId: input.issueId, file: input.file, caption: input.caption }, photoStore)
    revalidatePath(`/issues/${input.issueId}`)
    return { id: photo.id }
  },
})

export async function uploadIssuePhotoAction(_previous: PhotoFormState, formData: FormData): Promise<PhotoFormState> {
  return uploadIssuePhoto({ issueId: formData.get('issueId'), caption: formData.get('caption'), file: formData.get('file') })
}

function payload(formData: FormData) {
  return { bookingId: formData.get('bookingId'), caption: formData.get('caption'), file: formData.get('file') }
}

export async function uploadHandoverPhotoAction(_previous: PhotoFormState, formData: FormData): Promise<PhotoFormState> {
  return uploadHandoverPhoto(payload(formData))
}

export async function uploadReturnPhotoAction(_previous: PhotoFormState, formData: FormData): Promise<PhotoFormState> {
  return uploadReturnPhoto(payload(formData))
}
