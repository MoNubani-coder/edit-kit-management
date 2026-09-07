import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PHOTO_MAX_BYTES, PhotoUploadError, readPhotoUpload, readStoredFile, safeDisplayName, sniffImageType } from '@/server/storage/photo-store'

/**
 * The upload guards, with no database and no application around them: what
 * counts as an image, what a client filename is allowed to become, and the one
 * read path that refuses to leave the store.
 */

// Real headers, truncated: enough for a sniffer, not enough to decode.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)])
const WEBP = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4, 1), Buffer.from('WEBP', 'ascii'), Buffer.alloc(64, 7)])

const file = (bytes: Buffer, name: string, type: string) => new File([new Uint8Array(bytes)], name, { type })

let root: string

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ekms-store-'))
  await mkdir(path.join(root, 'photos', 'booking'), { recursive: true })
  await writeFile(path.join(root, 'photos', 'booking', 'a.png'), PNG)
  // A file the store must never reach, one level above the root.
  await writeFile(path.join(root, '..', path.basename(root) + '-secret.txt'), 'not yours')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(path.join(path.dirname(root), path.basename(root) + '-secret.txt'), { force: true })
})

describe('what counts as an image', () => {
  it('recognises JPEG, PNG and WebP by their bytes', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg')
    expect(sniffImageType(PNG)).toBe('image/png')
    expect(sniffImageType(WEBP)).toBe('image/webp')
  })

  it('refuses anything else, however it is labelled', () => {
    expect(sniffImageType(Buffer.from('<?php echo 1; ?>', 'utf8'))).toBeNull()
    expect(sniffImageType(Buffer.from('GIF89a', 'ascii'))).toBeNull()
    expect(sniffImageType(Buffer.alloc(0))).toBeNull()
    // RIFF without WEBP is some other RIFF container.
    expect(sniffImageType(Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('AVI ', 'ascii')]))).toBeNull()
  })

  it('takes the type from the bytes, not from the client', async () => {
    // A JPEG announced as a PNG is stored as what it is.
    const upload = await readPhotoUpload(file(JPEG, 'holiday.png', 'image/png'))
    expect(upload.mimeType).toBe('image/jpeg')

    // And a script announced as an image is refused outright.
    await expect(readPhotoUpload(file(Buffer.from('#!/bin/sh\nrm -rf /', 'utf8'), 'evidence.jpg', 'image/jpeg'))).rejects.toBeInstanceOf(PhotoUploadError)
  })

  it('refuses an empty choice and anything over the size limit', async () => {
    await expect(readPhotoUpload(undefined)).rejects.toThrow(/choose a photo/i)
    await expect(readPhotoUpload(file(Buffer.alloc(0), 'nothing.jpg', 'image/jpeg'))).rejects.toThrow(/choose a photo/i)

    const oversized = Buffer.concat([PNG, Buffer.alloc(PHOTO_MAX_BYTES + 1024, 3)])
    await expect(readPhotoUpload(file(oversized, 'huge.png', 'image/png'))).rejects.toThrow(/limit|larger/i)
  })

  it('hashes the bytes so the same photo is recognisable later', async () => {
    const first = await readPhotoUpload(file(PNG, 'a.png', 'image/png'))
    const second = await readPhotoUpload(file(PNG, 'b.png', 'image/png'))
    expect(first.hash).toBe(second.hash)
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('client filenames', () => {
  it('keeps a plain name and strips anything that could be a path', () => {
    expect(safeDisplayName('case-front.jpg')).toBe('case-front.jpg')
    expect(safeDisplayName('../../../../etc/passwd')).toBe('passwd')
    expect(safeDisplayName('..\\..\\windows\\system32\\config\\sam')).toBe('sam')
    expect(safeDisplayName('/absolute/path/photo.png')).toBe('photo.png')
    expect(safeDisplayName('....//....//evil.jpg')).toBe('evil.jpg')
  })

  it('never returns something empty, hidden or exotic', () => {
    expect(safeDisplayName('')).toBe('photo')
    expect(safeDisplayName('   ')).toBe('photo')
    expect(safeDisplayName('..')).toBe('photo')
    expect(safeDisplayName(undefined)).toBe('photo')
    expect(safeDisplayName(42)).toBe('photo')
    expect(safeDisplayName('.hidden')).toBe('hidden')
    expect(safeDisplayName('photo;rm -rf.jpg')).toBe('photo_rm_-rf.jpg')
    expect(safeDisplayName('a'.repeat(400))).toHaveLength(120)
  })
})

describe('reading a stored file', () => {
  it('reads a file inside the store', async () => {
    const stored = await readStoredFile('photos/booking/a.png', root)
    expect(stored?.bytes.subarray(0, 8)).toEqual(PNG.subarray(0, 8))
  })

  it('answers null for a row whose file is not there', async () => {
    expect(await readStoredFile('photos/booking/missing.png', root)).toBeNull()
    // A directory is not a file.
    expect(await readStoredFile('photos/booking', root)).toBeNull()
  })

  it('refuses to leave the store, whatever the path says', async () => {
    for (const attempt of ['../secret.txt', '../../etc/passwd', 'photos/../../escape.txt', '..\\..\\escape.txt', `/etc/passwd`]) {
      // Either refused outright, or resolved inside the store and simply absent.
      const result = await readStoredFile(attempt, root).catch((error: unknown) => {
        expect(error).toBeInstanceOf(PhotoUploadError)
        return 'refused' as const
      })
      expect(result === 'refused' || result === null, attempt).toBe(true)
    }
  })

  it('refuses an empty path or one carrying a null byte', async () => {
    await expect(readStoredFile('', root)).rejects.toBeInstanceOf(PhotoUploadError)
    await expect(readStoredFile('photos/a\u0000.png', root)).rejects.toBeInstanceOf(PhotoUploadError)
  })
})
