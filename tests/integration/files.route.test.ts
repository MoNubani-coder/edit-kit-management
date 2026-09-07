import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { AttachmentKind, UserRole } from '@prisma/client'
import type { Session } from 'next-auth'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { env } from '@/lib/env'
import type { Db } from '@/server/db/prisma'

import { actorFor, createTestUser, testDb, type TestUser } from '../helpers/db'

/**
 * The authorised file route, invoked the way a browser would.
 *
 * One rolled-back transaction for the file, with `@/server/db/prisma` proxied
 * onto it and the session stubbed, plus two real files written under a
 * throwaway directory inside the store so the route's own read path (and its
 * traversal guard) is what runs. The directory is deleted in `afterAll`.
 */

class Rollback extends Error {}

let tx: Db
let releaseTransaction: (() => void) | undefined
let transactionReady: () => void = () => {}
const ready = new Promise<void>((resolve) => {
  transactionReady = resolve
})

const transaction = testDb
  .$transaction(
    async (client) => {
      tx = client
      transactionReady()
      await new Promise<void>((_, reject) => {
        releaseTransaction = () => reject(new Rollback())
      })
    },
    { maxWait: 10_000, timeout: 300_000 },
  )
  .catch((error: unknown) => {
    if (!(error instanceof Rollback)) throw error
  })

let currentSession: Session | null = null
vi.mock('@/server/auth/auth', () => ({ auth: vi.fn(async () => currentSession) }))
vi.mock('@/server/db/prisma', () => ({
  prisma: new Proxy({} as Record<string | symbol, unknown>, {
    get: (_target, property) => (tx as unknown as Record<string | symbol, unknown>)[property],
  }),
}))

const { GET } = await import('@/app/api/files/[kind]/[id]/route')
const { createKit } = await import('@/server/services/kits.service')
const { createEditor } = await import('@/server/services/editors.service')
const { createBooking } = await import('@/server/services/bookings.service')

const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 5)])
const tag = randomUUID().slice(0, 8).toUpperCase()
const local = (day: number, hour: number) => `2045-05-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`

/** A throwaway folder inside the real store; removed in afterAll. */
const testDirectory = `test-files-${tag.toLowerCase()}`
const storeRoot = env.STORAGE_LOCAL_PATH

function sessionFor(user: TestUser | null): Session | null {
  return user ? { expires: new Date(Date.now() + 60_000).toISOString(), user: { id: user.id, name: user.name, email: user.email, role: user.role } } : null
}

async function call(kind: string, id: string) {
  const request = new NextRequest(`http://localhost:3000/api/files/${kind}/${id}`, { headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http' } })
  return GET(request, { params: Promise.resolve({ kind, id }) })
}

let admin: TestUser
let engineer: TestUser
let viewer: TestUser
let ownEditorUser: TestUser
let otherEditorUser: TestUser
let ownBookingId: string
let otherBookingId: string
let signatureId: string
let photoId: string
let missingFilePhotoId: string
let otherBookingPhotoId: string

beforeAll(async () => {
  await ready
  admin = await createTestUser(tx, { role: UserRole.ADMIN })
  engineer = await createTestUser(tx, { role: UserRole.ENGINEER })
  viewer = await createTestUser(tx, { role: UserRole.VIEWER })
  ownEditorUser = await createTestUser(tx, { role: UserRole.EDITOR })
  otherEditorUser = await createTestUser(tx, { role: UserRole.EDITOR })

  const actor = actorFor(admin)
  const engineerProfile = await tx.engineerProfile.findFirstOrThrow({ select: { id: true } })
  const kit = await createKit(tx, actor, { kitCode: `FIL-${tag}`, name: `File route kit ${tag}`, admBarcode: undefined, description: undefined, location: undefined, notes: undefined, suitcaseStatus: 'GOOD', status: 'AVAILABLE' })

  const ownEditor = await createEditor(tx, actor, {
    fullName: `File Own Editor ${tag}`,
    staffId: `EDT-OWN-${tag}`,
    email: undefined,
    contactNumber: undefined,
    department: undefined,
    company: undefined,
    type: 'INTERNAL',
    notes: undefined,
    userId: ownEditorUser.id,
    isActive: true,
  })
  const otherEditor = await createEditor(tx, actor, {
    fullName: `File Other Editor ${tag}`,
    staffId: `EDT-OTH-${tag}`,
    email: undefined,
    contactNumber: undefined,
    department: undefined,
    company: undefined,
    type: 'INTERNAL',
    notes: undefined,
    userId: otherEditorUser.id,
    isActive: true,
  })

  const ownBooking = await createBooking(tx, actor, {
    editorId: ownEditor.id,
    kitId: kit.id,
    engineerId: engineerProfile.id,
    bookingStart: local(10, 9),
    bookingEnd: local(12, 18),
    collectionDate: undefined,
    expectedReturnDate: local(12, 17),
    purpose: undefined,
    notes: undefined,
    intent: 'draft',
  })
  const otherBooking = await createBooking(tx, actor, {
    editorId: otherEditor.id,
    kitId: kit.id,
    engineerId: engineerProfile.id,
    bookingStart: local(20, 9),
    bookingEnd: local(22, 18),
    collectionDate: undefined,
    expectedReturnDate: local(22, 17),
    purpose: undefined,
    notes: undefined,
    intent: 'draft',
  })
  ownBookingId = ownBooking.id
  otherBookingId = otherBooking.id

  // Two real files in the store, and rows pointing at them.
  await mkdir(path.join(storeRoot, testDirectory), { recursive: true })
  await writeFile(path.join(storeRoot, testDirectory, 'signature.png'), PNG_BYTES)
  await writeFile(path.join(storeRoot, testDirectory, 'photo.png'), PNG_BYTES)

  const inspection = await tx.inspection.create({ data: { bookingId: ownBookingId, type: 'HANDOVER', startedById: admin.id }, select: { id: true } })
  const signature = await tx.signature.create({
    data: {
      bookingId: ownBookingId,
      inspectionId: inspection.id,
      type: 'HANDOVER_EDITOR',
      signerRole: 'EDITOR',
      signerEditorProfileId: ownEditor.id,
      signerName: `File Own Editor ${tag}`,
      storageProvider: 'LOCAL',
      imagePath: `${testDirectory}/signature.png`,
      imageMimeType: 'image/png',
      imageHash: 'a'.repeat(64),
    },
    select: { id: true },
  })
  signatureId = signature.id

  const attachment = await tx.attachment.create({
    data: {
      kind: AttachmentKind.INSPECTION_PHOTO,
      fileName: 'case.png',
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.length,
      sha256: 'b'.repeat(64),
      storageProvider: 'LOCAL',
      storagePath: `${testDirectory}/photo.png`,
      bookingId: ownBookingId,
      inspectionId: inspection.id,
      uploadedById: engineer.id,
    },
    select: { id: true },
  })
  photoId = attachment.id

  const orphan = await tx.attachment.create({
    data: {
      kind: AttachmentKind.INSPECTION_PHOTO,
      fileName: 'gone.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      sha256: 'c'.repeat(64),
      storageProvider: 'LOCAL',
      storagePath: `${testDirectory}/not-written.png`,
      bookingId: ownBookingId,
      inspectionId: inspection.id,
      uploadedById: engineer.id,
    },
    select: { id: true },
  })
  missingFilePhotoId = orphan.id

  const otherPhoto = await tx.attachment.create({
    data: {
      kind: AttachmentKind.INSPECTION_PHOTO,
      fileName: 'other.png',
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.length,
      sha256: 'd'.repeat(64),
      storageProvider: 'LOCAL',
      storagePath: `${testDirectory}/photo.png`,
      bookingId: otherBookingId,
      uploadedById: engineer.id,
    },
    select: { id: true },
  })
  otherBookingPhotoId = otherPhoto.id
})

afterAll(async () => {
  releaseTransaction?.()
  await transaction
  await rm(path.join(storeRoot, testDirectory), { recursive: true, force: true })
  // Nothing of this suite may survive: no rows, no files.
  expect(await testDb.kit.count({ where: { kitCode: { startsWith: 'FIL-' } } })).toBe(0)
  expect(await testDb.attachment.count({ where: { storagePath: { startsWith: testDirectory } } })).toBe(0)
  await testDb.$disconnect()
})

describe('who may read a file', () => {
  it('refuses an anonymous caller', async () => {
    currentSession = null
    const response = await call('signature', signatureId)
    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toContain('application/json')
  })

  it('serves a signature to a booking reader, with dull headers and no internals', async () => {
    currentSession = sessionFor(engineer)
    const response = await call('signature', signatureId)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-disposition')).toBe('inline; filename="handover_editor-signature.png"')
    // The path, the provider and the hash stay behind.
    const headerText = [...response.headers.entries()].map(([key, value]) => `${key}:${value}`).join(' ')
    expect(headerText).not.toMatch(/test-files|storage|sha256|a{16}/)
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 8)).toEqual(PNG_BYTES.subarray(0, 8))
  })

  it('serves photos to ADMIN and VIEWER, who both hold booking.read', async () => {
    for (const user of [admin, viewer]) {
      currentSession = sessionFor(user)
      const response = await call('photo', photoId)
      expect(response.status, user.role).toBe(200)
      expect(response.headers.get('content-type'), user.role).toBe('image/png')
    }
  })

  it('lets an EDITOR read only the files of their own booking', async () => {
    currentSession = sessionFor(ownEditorUser)
    const own = await call('photo', photoId)
    expect(own.status).toBe(200)

    const ownSignature = await call('signature', signatureId)
    expect(ownSignature.status).toBe(200)

    // Another editor's booking is not theirs to see.
    const other = await call('photo', otherBookingPhotoId)
    expect(other.status).toBe(403)
    expect(await other.json()).toMatchObject({ error: 'forbidden' })
  })

  it('refuses an EDITOR whose account is not linked to the booking at all', async () => {
    currentSession = sessionFor(otherEditorUser)
    expect((await call('photo', photoId)).status).toBe(403)
    expect((await call('signature', signatureId)).status).toBe(403)
  })
})

describe('what the route refuses to be talked into', () => {
  it('treats an unknown id as not found, and does not confirm which ids exist', async () => {
    currentSession = sessionFor(admin)
    const unknown = await call('photo', 'clzzzzzzzzzzzzzzzzzzzzzzzz')
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({ error: 'not_found' })
  })

  it('refuses an unknown kind and a malformed id without touching the database', async () => {
    currentSession = sessionFor(admin)
    expect((await call('document', photoId)).status).toBe(404)
    expect((await call('photo', '../../../etc/passwd')).status).toBe(404)
    expect((await call('photo', 'a/b')).status).toBe(404)
    expect((await call('photo', '')).status).toBe(404)
  })

  it('answers plainly when the row is real but the file is gone', async () => {
    currentSession = sessionFor(admin)
    const response = await call('photo', missingFilePhotoId)
    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ error: 'gone' })
  })

  it('does not serve a signature as a photo or the other way round', async () => {
    currentSession = sessionFor(admin)
    expect((await call('photo', signatureId)).status).toBe(404)
    expect((await call('signature', photoId)).status).toBe(404)
  })
})
