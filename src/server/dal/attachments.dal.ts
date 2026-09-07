import 'server-only'

import { AttachmentKind, type InspectionType, type StorageProvider } from '@prisma/client'

import type { Db } from '@/server/db/prisma'

/**
 * Photo-evidence reads.
 *
 * Photos are `Attachment` rows of kind INSPECTION_PHOTO hung off the
 * inspection they were taken during (and the booking, for one cheap query on
 * the booking page). What leaves here is metadata a page may show - who, when,
 * how big, a caption - plus the id the authorised file route needs. The
 * storage path, the provider and the SHA-256 stay behind: `*Internal`
 * functions are for the file route and the services only.
 */

export interface PhotoMeta {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  caption: string | null
  uploadedByName: string | null
  createdAt: Date
  /** Which inspection it belongs to, so a page can group handover vs return. */
  inspectionId: string | null
  inspectionType: InspectionType | null
}

const photoSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  caption: true,
  createdAt: true,
  inspectionId: true,
  uploadedBy: { select: { name: true } },
  inspection: { select: { type: true } },
} as const

type PhotoRow = {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  caption: string | null
  createdAt: Date
  inspectionId: string | null
  uploadedBy: { name: string } | null
  inspection: { type: InspectionType } | null
}

function toMeta(row: PhotoRow): PhotoMeta {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    caption: row.caption,
    uploadedByName: row.uploadedBy?.name ?? null,
    createdAt: row.createdAt,
    inspectionId: row.inspectionId,
    inspectionType: row.inspection?.type ?? null,
  }
}

/** Photos taken during one inspection, oldest first. */
export async function getInspectionPhotos(db: Db, inspectionId: string): Promise<PhotoMeta[]> {
  const rows = await db.attachment.findMany({
    where: { inspectionId, kind: AttachmentKind.INSPECTION_PHOTO, deletedAt: null },
    orderBy: [{ createdAt: 'asc' }],
    select: photoSelect,
  })
  return rows.map(toMeta)
}

/** Every photo on a booking, whichever inspection it came from. */
export async function getBookingPhotos(db: Db, bookingId: string): Promise<PhotoMeta[]> {
  const rows = await db.attachment.findMany({
    where: { bookingId, kind: AttachmentKind.INSPECTION_PHOTO, deletedAt: null },
    orderBy: [{ createdAt: 'asc' }],
    select: photoSelect,
  })
  return rows.map(toMeta)
}

export async function countInspectionPhotos(db: Db, inspectionId: string): Promise<number> {
  return db.attachment.count({ where: { inspectionId, kind: AttachmentKind.INSPECTION_PHOTO, deletedAt: null } })
}

// -----------------------------------------------------------------------------
// Internal: the authorised file route and the services only
// -----------------------------------------------------------------------------

export interface StoredFileRecord {
  id: string
  bookingId: string | null
  fileName: string
  mimeType: string
  storageProvider: StorageProvider
  storagePath: string
}

/** One photo with its storage details, for the file route to read the bytes. */
export async function getPhotoFileInternal(db: Db, id: string): Promise<StoredFileRecord | null> {
  const row = await db.attachment.findFirst({
    where: { id, kind: AttachmentKind.INSPECTION_PHOTO, deletedAt: null },
    select: { id: true, bookingId: true, fileName: true, mimeType: true, storageProvider: true, storagePath: true },
  })
  return row
}

/** One signature image with its storage details, for the same route. */
export async function getSignatureFileInternal(db: Db, id: string): Promise<StoredFileRecord | null> {
  const row = await db.signature.findFirst({
    where: { id },
    select: { id: true, bookingId: true, type: true, imageMimeType: true, storageProvider: true, imagePath: true },
  })
  if (!row) return null
  return {
    id: row.id,
    bookingId: row.bookingId,
    // A filename for the download header only; nothing reads it back.
    fileName: `${row.type.toLowerCase()}-signature.png`,
    mimeType: row.imageMimeType,
    storageProvider: row.storageProvider,
    storagePath: row.imagePath,
  }
}

/** The booking a file hangs off, for the authorisation check. */
export async function getFileBookingScope(db: Db, bookingId: string): Promise<{ id: string; editorId: string; deleted: boolean } | null> {
  const booking = await db.booking.findUnique({ where: { id: bookingId }, select: { id: true, editorId: true, deletedAt: true } })
  return booking ? { id: booking.id, editorId: booking.editorId, deleted: booking.deletedAt !== null } : null
}
