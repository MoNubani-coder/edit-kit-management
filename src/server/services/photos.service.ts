import 'server-only'

import { AttachmentKind, AuditAction, InspectionStatus, InspectionType } from '@prisma/client'

import type { Actor } from '@/server/auth/session'
import { countInspectionPhotos, getInspectionPhotos, type PhotoMeta } from '@/server/dal/attachments.dal'
import type { Db } from '@/server/db/prisma'
import { recordAudit } from '@/server/services/audit.service'
import { DomainError } from '@/server/services/errors'
import { type PhotoStore, PhotoUploadError, readPhotoUpload } from '@/server/storage/photo-store'

/**
 * Optional photo evidence for an inspection.
 *
 * A photo is an `Attachment` of kind INSPECTION_PHOTO hung off the inspection
 * it was taken during, so a handover's photos belong to the handover for good:
 * a return adds its own and never touches, replaces or re-parents what the
 * handover recorded.
 *
 * Photos are always optional. Nothing in the handover or return verdicts looks
 * at them - an engineer who photographs nothing can still complete either
 * workflow, and one who photographs everything is not slowed down by a
 * required field.
 *
 * Uploads are only accepted while the inspection is open. Once it is locked
 * the document is frozen, and its evidence with it.
 */

export const PHOTO_LIMIT_PER_INSPECTION = 12

export interface UploadedPhoto {
  id: string
  fileName: string
}

async function openInspection(db: Db, bookingId: string, type: InspectionType) {
  const inspection = await db.inspection.findFirst({
    where: { bookingId, type, voidedAt: null },
    select: { id: true, status: true, lockedAt: true, booking: { select: { bookingNumber: true } } },
  })
  if (!inspection) {
    throw new DomainError('lifecycle', type === InspectionType.HANDOVER ? 'The handover has not been started.' : 'The return inspection has not been started.')
  }
  if (inspection.lockedAt || inspection.status === InspectionStatus.COMPLETED) {
    throw new DomainError('lifecycle', 'That inspection is complete; its evidence is part of the frozen document and cannot be added to.')
  }
  return inspection
}

/**
 * Stores one photo against the booking's open handover or return.
 *
 * The file is validated by its bytes (photo-store.ts) before anything is
 * written, and the row is written after the file so a failed insert leaves no
 * orphan - if the row fails, the file is removed again.
 */
export async function addInspectionPhoto(
  db: Db,
  actor: Actor,
  input: { bookingId: string; type: InspectionType; file: unknown; caption?: string },
  store: PhotoStore,
): Promise<UploadedPhoto> {
  const inspection = await openInspection(db, input.bookingId, input.type)

  const existing = await countInspectionPhotos(db, inspection.id)
  if (existing >= PHOTO_LIMIT_PER_INSPECTION) {
    throw new DomainError('validation', `That inspection already has ${PHOTO_LIMIT_PER_INSPECTION} photos, which is the limit.`)
  }

  let upload
  try {
    upload = await readPhotoUpload(input.file)
  } catch (error) {
    if (error instanceof PhotoUploadError) throw new DomainError('validation', error.message, { photo: error.message })
    throw error
  }

  const scope = input.type === InspectionType.HANDOVER ? 'handover' : 'return'
  const stored = await store.save({ bookingId: input.bookingId, scope, mimeType: upload.mimeType, bytes: upload.bytes })

  try {
    const attachment = await db.attachment.create({
      data: {
        kind: AttachmentKind.INSPECTION_PHOTO,
        fileName: upload.displayName,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        sha256: upload.hash,
        storageProvider: stored.provider,
        storagePath: stored.path,
        caption: input.caption?.trim() ? input.caption.trim() : null,
        bookingId: input.bookingId,
        inspectionId: inspection.id,
        uploadedById: actor.id,
      },
      select: { id: true, fileName: true },
    })

    await recordAudit(db, {
      action: AuditAction.FILE_UPLOADED,
      entityType: 'Booking',
      entityId: input.bookingId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      summary: `${inspection.booking.bookingNumber} ${scope} photo added by ${actor.name} (${Math.round(upload.sizeBytes / 1024)} KB)`,
      metadata: { inspectionId: inspection.id, attachmentId: attachment.id, step: `${scope}-photo` },
    })

    return attachment
  } catch (error) {
    await store.remove(stored.path)
    throw error
  }
}

export async function loadInspectionPhotos(db: Db, inspectionId: string): Promise<PhotoMeta[]> {
  return getInspectionPhotos(db, inspectionId)
}
