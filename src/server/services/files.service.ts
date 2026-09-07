import 'server-only'

import { can } from '@/server/auth/permissions'
import type { Actor } from '@/server/auth/session'
import { getFileBookingScope, getIssuePhotoFileInternal, getPhotoFileInternal, getSignatureFileInternal, type StoredFileRecord } from '@/server/dal/attachments.dal'
import type { Db } from '@/server/db/prisma'
import { readStoredFile } from '@/server/storage/photo-store'

/**
 * Authorised file access.
 *
 * Signature images and photos are not public files: they are read through
 * `/api/files/...`, which resolves the row, checks the caller against the
 * booking the file belongs to, and only then reads the bytes. Three rules:
 *
 *  - the URL carries an opaque row id, never a path. The path comes from the
 *    database row and is read through `readStoredFile`, which refuses anything
 *    resolving outside the store;
 *  - `booking.read` sees any booking's files; `booking.readOwn` sees only the
 *    files of a booking whose editor is the caller's own editor profile;
 *  - a row that points at a file which is no longer there answers "gone", not
 *    an exception, and nothing about the path, the provider or the hash is
 *    ever returned.
 *
 * External editors have no account, so they have no access at all - their
 * signature is captured in person on the engineer's device (AD-20).
 */

export type FileKind = 'signature' | 'photo' | 'issue-photo'

export type FileResult =
  | { status: 'ok'; fileName: string; mimeType: string; bytes: Buffer }
  | { status: 'not-found' }
  | { status: 'forbidden' }
  | { status: 'gone' }

/** Whether this actor may see the files of this booking. */
export async function canReadBookingFiles(db: Db, actor: Actor, bookingId: string | null): Promise<boolean> {
  if (!bookingId) return false
  const scope = await getFileBookingScope(db, bookingId)
  if (!scope) return false
  if (can(actor, 'booking.read')) return true
  if (can(actor, 'booking.readOwn')) return actor.editorProfileId !== null && actor.editorProfileId === scope.editorId
  return false
}

async function record(db: Db, kind: FileKind, id: string): Promise<StoredFileRecord | null> {
  if (kind === 'signature') return getSignatureFileInternal(db, id)
  if (kind === 'issue-photo') return getIssuePhotoFileInternal(db, id)
  return getPhotoFileInternal(db, id)
}

/**
 * Resolves one file for one caller. The caller is authorised against the
 * booking before a single byte is read.
 */
export async function loadAuthorisedFile(db: Db, actor: Actor, kind: FileKind, id: string): Promise<FileResult> {
  const row = await record(db, kind, id)
  // An unknown id and a file the caller may not see are both "not found" as
  // far as the caller is concerned; distinguishing them would confirm that a
  // particular id exists.
  if (!row) return { status: 'not-found' }

  // An issue photo is an equipment record rather than a booking record: it may
  // have no booking at all (a fault noticed on the shelf), so `issue.read`
  // decides. When it *did* come from a return, the booking rule still lets the
  // booking's own reader see it.
  const allowed =
    kind === 'issue-photo'
      ? can(actor, 'issue.read') || (await canReadBookingFiles(db, actor, row.bookingId))
      : await canReadBookingFiles(db, actor, row.bookingId)
  if (!allowed) return { status: 'forbidden' }

  const stored = await readStoredFile(row.storagePath)
  if (!stored) return { status: 'gone' }

  return { status: 'ok', fileName: row.fileName, mimeType: row.mimeType, bytes: stored.bytes }
}

/** The URL a page uses to show a file it is already allowed to see. */
export function fileHref(kind: FileKind, id: string): string {
  return `/api/files/${kind}/${id}`
}
