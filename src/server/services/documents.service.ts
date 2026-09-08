import 'server-only'

import { InspectionStatus } from '@prisma/client'

import { env } from '@/lib/env'
import { can } from '@/server/auth/permissions'
import type { Actor } from '@/server/auth/session'
import type { Db } from '@/server/db/prisma'
import { type DocumentKind, type FrozenDocument, documentTitle, inspectionTypeFor, readDocument } from '@/server/documents/snapshot'
import { renderDocumentPdf, type SignatureImage } from '@/server/documents/pdf'
import { readStoredFile } from '@/server/storage/photo-store'

/**
 * Handover and return documents.
 *
 * Everything comes from `Inspection.documentSnapshot` (AD-6) - the copy frozen
 * when the inspection completed. Renaming the kit or swapping an asset's serial
 * number afterwards cannot change a document that was signed, because nothing
 * here reads the kit, the assets or the editor as they are now.
 *
 * Authorisation is the booking's, not the report area's: `booking.read` sees
 * any booking's document, and `booking.readOwn` sees one for a booking whose
 * editor is the caller's own profile - which is how an internal editor gets
 * their own signed record. External editors have no account and therefore no
 * access; their copy is the one handed to them in person.
 */

export type DocumentAccess = { status: 'ok'; document: FrozenDocument; bookingId: string; inspectionId: string } | { status: 'not-found' } | { status: 'forbidden' } | { status: 'not-ready' }

async function bookingScope(db: Db, bookingId: string) {
  return db.booking.findFirst({ where: { id: bookingId, deletedAt: null }, select: { id: true, editorId: true } })
}

/** A booking with no directory profile is nobody's own: fail closed for `booking.readOwn`. */
function mayRead(actor: Actor, editorId: string | null): boolean {
  if (can(actor, 'booking.read')) return true
  if (can(actor, 'booking.readOwn')) return actor.editorProfileId !== null && actor.editorProfileId === editorId
  return false
}

/**
 * The frozen document for one booking, if this caller may have it.
 *
 * `not-ready` distinguishes a booking whose inspection has not been completed
 * yet - there is nothing to print - from one the caller may not see, which is
 * reported as `not-found` so probing tells them nothing.
 */
export async function loadDocument(db: Db, actor: Actor, bookingId: string, kind: DocumentKind): Promise<DocumentAccess> {
  const booking = await bookingScope(db, bookingId)
  if (!booking) return { status: 'not-found' }
  if (!mayRead(actor, booking.editorId)) return { status: 'forbidden' }

  const inspection = await db.inspection.findFirst({
    where: { bookingId, type: inspectionTypeFor(kind), voidedAt: null },
    select: { id: true, status: true, documentSnapshot: true },
  })
  if (!inspection) return { status: 'not-ready' }
  if (inspection.status !== InspectionStatus.COMPLETED || inspection.documentSnapshot === null) return { status: 'not-ready' }

  const document = readDocument(kind, inspection.documentSnapshot)
  if (!document) return { status: 'not-ready' }
  return { status: 'ok', document, bookingId: booking.id, inspectionId: inspection.id }
}

/** Which documents exist for a booking, for the links on its page. */
export async function availableDocuments(db: Db, bookingId: string): Promise<DocumentKind[]> {
  const rows = await db.inspection.findMany({
    where: { bookingId, voidedAt: null, status: InspectionStatus.COMPLETED },
    select: { type: true, documentSnapshot: true },
  })
  // A completed inspection always has a snapshot, but a restored database may
  // not: only offer a document there is something to render.
  return rows.filter((row) => row.documentSnapshot !== null).map((row) => (row.type === 'HANDOVER' ? 'handover' : 'return'))
}

/**
 * The signature images for a document, read through the same contained path
 * the file route uses. A missing file is skipped: the PDF then prints
 * "(signature on file)" rather than failing, because the record of who signed
 * and when lives in the snapshot either way.
 */
async function signatureImages(db: Db, inspectionId: string): Promise<SignatureImage[]> {
  const rows = await db.signature.findMany({
    where: { inspectionId, voidedAt: null },
    select: { type: true, imagePath: true, imageMimeType: true },
    orderBy: [{ signedAt: 'asc' }],
  })

  const images: SignatureImage[] = []
  for (const row of rows) {
    const stored = await readStoredFile(row.imagePath).catch(() => null)
    if (stored) images.push({ type: row.type, bytes: stored.bytes, mimeType: row.imageMimeType })
  }
  return images
}

export interface RenderedDocument {
  fileName: string
  bytes: Uint8Array
}

/** The document as a PDF, with its signatures embedded. */
export async function renderDocument(db: Db, access: Extract<DocumentAccess, { status: 'ok' }>, options: { now?: Date } = {}): Promise<RenderedDocument> {
  const signatures = await signatureImages(db, access.inspectionId)
  const bytes = await renderDocumentPdf(access.document, {
    organisation: env.APP_ORG_NAME,
    applicationName: env.APP_NAME,
    timeZone: env.APP_TIMEZONE,
    generatedAt: options.now ?? new Date(),
    signatures,
  })

  const number = access.document.bookingNumber ?? access.bookingId
  return { fileName: `${number}-${access.document.kind}.pdf`, bytes }
}

export { documentTitle }
export type { DocumentKind, FrozenDocument }
