import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { env } from '@/lib/env'

/**
 * Where signature images live (AD-4: the provider is a column on the row, the
 * driver is chosen here). The database keeps only the path and a SHA-256 of
 * the bytes; the image itself is a file under `STORAGE_LOCAL_PATH`, never a
 * database payload. Paths are relative to the store root and are never shown
 * to users - serving them is a later, authorised route.
 *
 * `memorySignatureStore` backs the tests so nothing touches the disk.
 */

export interface StoredSignature {
  provider: 'LOCAL'
  /** Relative path inside the store. */
  path: string
  hash: string
  sizeBytes: number
}

export interface SignatureStore {
  save(input: { bookingId: string; type: string; bytes: Buffer }): Promise<StoredSignature>
  remove(relativePath: string): Promise<void>
}

/** Hard ceiling on a decoded signature image. */
export const SIGNATURE_MAX_BYTES = 256 * 1024

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export class SignatureImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignatureImageError'
  }
}

/** Validates a PNG data URL from the pad and returns its bytes. */
export function decodeSignatureImage(dataUrl: string): Buffer {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim())
  if (!match) throw new SignatureImageError('The signature must be a PNG image.')
  const bytes = Buffer.from(match[1], 'base64')
  if (bytes.length < PNG_MAGIC.length || !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new SignatureImageError('The signature image is not a valid PNG.')
  }
  if (bytes.length > SIGNATURE_MAX_BYTES) throw new SignatureImageError('The signature image is too large.')
  return bytes
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)
}

export function localSignatureStore(root: string = env.STORAGE_LOCAL_PATH): SignatureStore {
  const base = path.resolve(root)
  return {
    async save({ bookingId, type, bytes }) {
      const relative = path.posix.join('signatures', safeSegment(bookingId), `${safeSegment(type).toLowerCase()}-${Date.now()}-${randomUUID().slice(0, 8)}.png`)
      const absolute = path.join(base, relative)
      await mkdir(path.dirname(absolute), { recursive: true })
      await writeFile(absolute, bytes, { flag: 'wx' })
      return { provider: 'LOCAL', path: relative, hash: sha256(bytes), sizeBytes: bytes.length }
    },
    async remove(relative) {
      try {
        await unlink(path.join(base, relative))
      } catch {
        /* best effort: an orphaned file is harmless, a failed DB write is not */
      }
    },
  }
}

/** Keeps images in memory - for tests, so a rolled-back transaction leaves no file behind. */
export function memorySignatureStore(): SignatureStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>()
  return {
    files,
    async save({ bookingId, type, bytes }) {
      const relative = `signatures/${safeSegment(bookingId)}/${safeSegment(type).toLowerCase()}-${randomUUID().slice(0, 8)}.png`
      files.set(relative, bytes)
      return { provider: 'LOCAL', path: relative, hash: sha256(bytes), sizeBytes: bytes.length }
    },
    async remove(relative) {
      files.delete(relative)
    },
  }
}

/** The store the application uses. Tests replace this module. */
export const signatureStore: SignatureStore = localSignatureStore()
