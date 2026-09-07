import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { env } from '@/lib/env'

/**
 * Where operational photos live, and the only way anything reads a stored file
 * back out.
 *
 * Same shape as the signature store (AD-4): the provider is a column on the
 * row, the driver is chosen here, the database keeps a relative path plus a
 * SHA-256, and the bytes are a file under `STORAGE_LOCAL_PATH`. Two rules make
 * the difference for uploads, where the bytes come from a person's device:
 *
 *  - the type is decided by *sniffing the bytes*, not by the client's
 *    `Content-Type` or file extension, and only JPEG, PNG and WebP are kept;
 *  - the stored name is generated here. A client filename is never part of a
 *    path, so there is nothing to traverse with, and it is kept only as a
 *    display label with its directory parts stripped.
 *
 * `readStoredFile` is the single read path and refuses anything that resolves
 * outside the store root, so even a tampered database row cannot reach
 * /etc/passwd.
 */

export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type PhotoMimeType = (typeof PHOTO_MIME_TYPES)[number]

/** Photos are evidence, not artwork: enough for a legible 12 MP phone shot. */
export const PHOTO_MAX_BYTES = Math.min(env.MAX_UPLOAD_BYTES, 8 * 1024 * 1024)

export class PhotoUploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhotoUploadError'
  }
}

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff])
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const RIFF_MAGIC = Buffer.from('RIFF', 'ascii')
const WEBP_MAGIC = Buffer.from('WEBP', 'ascii')

const EXTENSION: Record<PhotoMimeType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/**
 * The real type of the bytes, or null when they are not an image this system
 * accepts. A JPEG renamed to `.png` is still a JPEG; a script renamed to
 * `.jpg` is nothing at all.
 */
export function sniffImageType(bytes: Buffer): PhotoMimeType | null {
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(JPEG_MAGIC)) return 'image/jpeg'
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png'
  if (bytes.length >= 12 && bytes.subarray(0, 4).equals(RIFF_MAGIC) && bytes.subarray(8, 12).equals(WEBP_MAGIC)) return 'image/webp'
  return null
}

/** A client filename reduced to a harmless label: no directories, no tricks. */
export function safeDisplayName(fileName: unknown, fallback = 'photo'): string {
  if (typeof fileName !== 'string' || fileName.trim() === '') return fallback
  // Take the last segment whichever separator was used, then strip anything
  // that is not a plain filename character.
  const base = fileName.split(/[\\/]/).pop() ?? fallback
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120)
  return cleaned === '' ? fallback : cleaned
}

export interface PhotoUpload {
  bytes: Buffer
  mimeType: PhotoMimeType
  sizeBytes: number
  /** For display only; never used to build a path. */
  displayName: string
  hash: string
}

/**
 * Validates one uploaded file. Throws `PhotoUploadError` with a sentence a
 * person can act on; never trusts anything the client said about the file.
 */
export async function readPhotoUpload(file: unknown): Promise<PhotoUpload> {
  if (!(file instanceof File) || file.size === 0) throw new PhotoUploadError('Choose a photo to upload.')
  if (file.size > PHOTO_MAX_BYTES) {
    throw new PhotoUploadError(`That photo is ${Math.round(file.size / 1024 / 1024)} MB. The limit is ${Math.round(PHOTO_MAX_BYTES / 1024 / 1024)} MB.`)
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  // Re-check after reading: `File.size` is a claim until the bytes are counted.
  if (bytes.length > PHOTO_MAX_BYTES) throw new PhotoUploadError(`The photo is larger than ${Math.round(PHOTO_MAX_BYTES / 1024 / 1024)} MB.`)

  const mimeType = sniffImageType(bytes)
  if (!mimeType) throw new PhotoUploadError('That file is not a JPEG, PNG or WebP image.')

  return {
    bytes,
    mimeType,
    sizeBytes: bytes.length,
    displayName: safeDisplayName(file.name, `photo.${EXTENSION[mimeType]}`),
    hash: createHash('sha256').update(bytes).digest('hex'),
  }
}

export interface StoredPhoto {
  provider: 'LOCAL'
  /** Relative path inside the store; never shown to a user. */
  path: string
}

export interface PhotoStore {
  save(input: { bookingId: string; scope: string; mimeType: PhotoMimeType; bytes: Buffer }): Promise<StoredPhoto>
  remove(relativePath: string): Promise<void>
}

/** Rejects any relative path that could climb out of the store. */
function assertContained(root: string, relativePath: string): string {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') throw new PhotoUploadError('That file has no stored location.')
  if (relativePath.includes('\u0000')) throw new PhotoUploadError('That file has no stored location.')
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, relativePath)
  const withSeparator = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep
  if (resolved !== resolvedRoot && !resolved.startsWith(withSeparator)) {
    throw new PhotoUploadError('That file is outside the store.')
  }
  return resolved
}

export function localPhotoStore(root: string = env.STORAGE_LOCAL_PATH): PhotoStore {
  return {
    async save({ bookingId, scope, mimeType, bytes }) {
      // Every path segment is generated here: the booking id (a cuid), the
      // scope word, a timestamp and random bytes.
      const safeScope = scope.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'photo'
      const directory = path.join(root, 'photos', safeDisplayName(bookingId, 'unknown'))
      await mkdir(directory, { recursive: true })
      const name = `${safeScope}-${Date.now()}-${randomUUID().slice(0, 8)}.${EXTENSION[mimeType]}`
      await writeFile(path.join(directory, name), bytes, { flag: 'wx' })
      return { provider: 'LOCAL', path: path.posix.join('photos', safeDisplayName(bookingId, 'unknown'), name) }
    },
    async remove(relativePath) {
      try {
        await unlink(assertContained(root, relativePath))
      } catch {
        /* already gone */
      }
    },
  }
}

/** In-memory store for tests: nothing reaches the disk. */
export function memoryPhotoStore(): PhotoStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>()
  return {
    files,
    async save({ bookingId, scope, mimeType, bytes }) {
      const relativePath = path.posix.join('photos', bookingId, `${scope}-${files.size + 1}.${EXTENSION[mimeType]}`)
      files.set(relativePath, bytes)
      return { provider: 'LOCAL', path: relativePath }
    },
    async remove(relativePath) {
      files.delete(relativePath)
    },
  }
}

export const photoStore = localPhotoStore()

export interface StoredBytes {
  bytes: Buffer
  sizeBytes: number
}

/**
 * The one read path for stored files - signatures and photos alike.
 *
 * Returns null when the row points at a file that is not there (a restored
 * database, a half-finished migration, a manual tidy-up), so a caller can
 * answer 404 instead of a stack trace. Anything that resolves outside the
 * store root throws.
 */
export async function readStoredFile(relativePath: string, root: string = env.STORAGE_LOCAL_PATH): Promise<StoredBytes | null> {
  const resolved = assertContained(root, relativePath)
  try {
    const info = await stat(resolved)
    if (!info.isFile()) return null
    return { bytes: await readFile(resolved), sizeBytes: info.size }
  } catch {
    return null
  }
}
