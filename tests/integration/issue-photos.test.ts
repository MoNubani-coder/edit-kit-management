import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { AttachmentKind, UserRole } from '@prisma/client'
import type { Session } from 'next-auth'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { env } from '@/lib/env'
import type { Actor } from '@/server/auth/session'
import type { Db } from '@/server/db/prisma'

import { actorFor, createTestUser, testDb, type TestUser } from '../helpers/db'

/**
 * Photo evidence on an issue, and who may read it.
 *
 * The upload path is the Phase 10 store (bytes sniffed, name generated, size
 * bounded); what is new is where the row hangs and who the file route lets in.
 * An issue photo is an equipment record, so `issue.read` decides - and when the
 * issue came from a return, the booking's own reader may see it too.
 *
 * One rolled-back transaction, the prisma client proxied onto it, real files in
 * a throwaway directory inside the store, removed in `afterAll`.
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
const { createAsset } = await import('@/server/services/assets.service')
const { createEditor } = await import('@/server/services/editors.service')
const { createBooking } = await import('@/server/services/bookings.service')
const { createKit } = await import('@/server/services/kits.service')
const { createIssue, closeIssue } = await import('@/server/services/issues.service')
const { addIssuePhoto, PHOTO_LIMIT_PER_INSPECTION } = await import('@/server/services/photos.service')
const { getIssuePhotos } = await import('@/server/dal/attachments.dal')
const { memoryPhotoStore } = await import('@/server/storage/photo-store')

const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(96, 4)])
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(96, 4)])
const tag = randomUUID().slice(0, 8).toUpperCase()
const local = (day: number, hour: number) => `2048-02-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`
const photoFile = (bytes: Buffer, name = 'damage.jpg', type = 'image/jpeg') => new File([new Uint8Array(bytes)], name, { type })

const testDirectory = `test-issue-${tag.toLowerCase()}`
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
let adminActor: Actor
let engineerActor: Actor
let assetId: string
let bookingId: string
let standaloneIssueId: string
let bookingIssueId: string
let standalonePhotoId: string
let bookingPhotoId: string
let countersBefore: Array<{ scope: string; current: number }>

beforeAll(async () => {
  await ready
  countersBefore = await tx.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })
  admin = await createTestUser(tx, { role: UserRole.ADMIN })
  engineer = await createTestUser(tx, { role: UserRole.ENGINEER })
  viewer = await createTestUser(tx, { role: UserRole.VIEWER })
  ownEditorUser = await createTestUser(tx, { role: UserRole.EDITOR })
  otherEditorUser = await createTestUser(tx, { role: UserRole.EDITOR })
  adminActor = actorFor(admin)
  engineerActor = actorFor(engineer)

  const [category, engineerProfile] = await Promise.all([
    tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' }, select: { id: true } }),
    tx.engineerProfile.findFirstOrThrow({ select: { id: true } }),
  ])
  const asset = await createAsset(tx, adminActor, {
    name: `Issue photo asset ${tag}`,
    categoryId: category.id,
    manufacturer: 'Testco',
    model: 'IP-1',
    serialNumber: `SN-IP-${tag}`,
    admBarcode: `ADM-IP-${tag}`,
    location: undefined,
    notes: undefined,
    status: 'AVAILABLE',
  })
  assetId = asset.id

  const kit = await createKit(tx, adminActor, { kitCode: `IPK-${tag}`, name: `Issue photo kit ${tag}`, admBarcode: undefined, description: undefined, location: undefined, notes: undefined, suitcaseStatus: 'GOOD', status: 'AVAILABLE' })
  const ownEditor = await createEditor(tx, adminActor, {
    fullName: `Issue Photo Editor ${tag}`,
    staffId: `EDT-IP-${tag}`,
    email: undefined,
    contactNumber: undefined,
    department: undefined,
    company: undefined,
    type: 'INTERNAL',
    notes: undefined,
    userId: ownEditorUser.id,
    isActive: true,
  })
  await createEditor(tx, adminActor, {
    fullName: `Issue Other Editor ${tag}`,
    staffId: `EDT-IO-${tag}`,
    email: undefined,
    contactNumber: undefined,
    department: undefined,
    company: undefined,
    type: 'INTERNAL',
    notes: undefined,
    userId: otherEditorUser.id,
    isActive: true,
  })
  const booking = await createBooking(tx, adminActor, {
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
  bookingId = booking.id

  // One issue about equipment only, one tied to a booking (as a return's would be).
  standaloneIssueId = (
    await createIssue(tx, engineerActor, {
      type: 'DAMAGED',
      severity: 'MEDIUM',
      title: `ISSUE-PHOTO ${tag} shelf fault`,
      description: 'Noticed on the shelf, no booking involved.',
      assetId,
      kitId: undefined,
      bookingId: undefined,
      accessoryId: undefined,
      assignedToId: undefined,
    })
  ).id
  bookingIssueId = (
    await createIssue(tx, engineerActor, {
      type: 'MISSING',
      severity: 'HIGH',
      title: `ISSUE-PHOTO ${tag} from a booking`,
      description: 'Tied to a booking, the way a return raises one.',
      assetId,
      kitId: undefined,
      bookingId,
      accessoryId: undefined,
      assignedToId: undefined,
    })
  ).id

  // Real files, and rows pointing at them.
  await mkdir(path.join(storeRoot, testDirectory), { recursive: true })
  await writeFile(path.join(storeRoot, testDirectory, 'standalone.png'), PNG_BYTES)
  await writeFile(path.join(storeRoot, testDirectory, 'booking.png'), PNG_BYTES)

  standalonePhotoId = (
    await tx.attachment.create({
      data: {
        kind: AttachmentKind.ISSUE_PHOTO,
        fileName: 'standalone.png',
        mimeType: 'image/png',
        sizeBytes: PNG_BYTES.length,
        sha256: 'e'.repeat(64),
        storageProvider: 'LOCAL',
        storagePath: `${testDirectory}/standalone.png`,
        issueId: standaloneIssueId,
        uploadedById: engineer.id,
      },
      select: { id: true },
    })
  ).id

  bookingPhotoId = (
    await tx.attachment.create({
      data: {
        kind: AttachmentKind.ISSUE_PHOTO,
        fileName: 'booking.png',
        mimeType: 'image/png',
        sizeBytes: PNG_BYTES.length,
        sha256: 'f'.repeat(64),
        storageProvider: 'LOCAL',
        storagePath: `${testDirectory}/booking.png`,
        issueId: bookingIssueId,
        bookingId,
        uploadedById: engineer.id,
      },
      select: { id: true },
    })
  ).id
})

afterAll(async () => {
  releaseTransaction?.()
  await transaction
  await rm(path.join(storeRoot, testDirectory), { recursive: true, force: true })
  expect(await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })).toEqual(countersBefore)
  expect(await testDb.issue.count({ where: { title: { startsWith: 'ISSUE-PHOTO' } } })).toBe(0)
  expect(await testDb.attachment.count({ where: { storagePath: { startsWith: testDirectory } } })).toBe(0)
  await testDb.$disconnect()
})

describe('adding a photo to an issue', () => {
  it('stores it with its metadata and an audit line', async () => {
    const store = memoryPhotoStore()
    const photo = await addIssuePhoto(tx, engineerActor, { issueId: standaloneIssueId, file: photoFile(JPEG_BYTES, 'cracked panel.jpg'), caption: 'The crack' }, store)

    const photos = await getIssuePhotos(tx, standaloneIssueId)
    expect(photos.some((row) => row.id === photo.id)).toBe(true)
    const stored = photos.find((row) => row.id === photo.id)!
    expect(stored).toMatchObject({ mimeType: 'image/jpeg', caption: 'The crack', uploadedByName: engineer.name })
    // The client's spaces never reach a path, and the stored name is ours.
    expect(stored.fileName).toBe('cracked_panel.jpg')
    expect([...store.files.keys()][0]).toMatch(/^photos\//)
    expect(JSON.stringify(photos)).not.toMatch(/storagePath|sha256/)

    const audit = await tx.auditLog.findFirst({ where: { entityType: 'Issue', entityId: standaloneIssueId, action: 'FILE_UPLOADED' }, select: { summary: true } })
    expect(audit?.summary).toMatch(/photo added/i)
  })

  it('refuses a file that is not an image, an unknown issue, and a closed one', async () => {
    const store = memoryPhotoStore()

    await expect(
      addIssuePhoto(tx, engineerActor, { issueId: standaloneIssueId, file: photoFile(Buffer.from('%PDF-1.7', 'utf8'), 'report.pdf', 'application/pdf') }, store),
    ).rejects.toMatchObject({ code: 'validation' })
    await expect(addIssuePhoto(tx, engineerActor, { issueId: 'no-such-issue', file: photoFile(JPEG_BYTES) }, store)).rejects.toMatchObject({ code: 'not_found' })
    expect(store.files.size).toBe(0)

    // A closed issue is a record: reopen it before adding evidence.
    const closable = await createIssue(tx, engineerActor, {
      type: 'OTHER',
      severity: 'LOW',
      title: `ISSUE-PHOTO ${tag} closed`,
      description: 'Will be closed before a photo is attempted.',
      assetId,
      kitId: undefined,
      bookingId: undefined,
      accessoryId: undefined,
      assignedToId: undefined,
    })
    await closeIssue(tx, engineerActor, closable.id, { resolution: 'Nothing wrong after all.' })
    await expect(addIssuePhoto(tx, engineerActor, { issueId: closable.id, file: photoFile(JPEG_BYTES) }, store)).rejects.toMatchObject({ code: 'lifecycle' })
    expect(store.files.size).toBe(0)
  })

  it('stops at the same per-record limit as inspection evidence', async () => {
    const store = memoryPhotoStore()
    const issue = await createIssue(tx, engineerActor, {
      type: 'DAMAGED',
      severity: 'LOW',
      title: `ISSUE-PHOTO ${tag} limit`,
      description: 'Filling up the photo allowance.',
      assetId,
      kitId: undefined,
      bookingId: undefined,
      accessoryId: undefined,
      assignedToId: undefined,
    })

    for (let index = 0; index < PHOTO_LIMIT_PER_INSPECTION; index += 1) {
      await addIssuePhoto(tx, engineerActor, { issueId: issue.id, file: photoFile(JPEG_BYTES, `shot-${index}.jpg`) }, store)
    }
    await expect(addIssuePhoto(tx, engineerActor, { issueId: issue.id, file: photoFile(JPEG_BYTES, 'one-too-many.jpg') }, store)).rejects.toMatchObject({ code: 'validation' })
    expect(store.files.size).toBe(PHOTO_LIMIT_PER_INSPECTION)
  })
})

describe('who may read an issue photo', () => {
  it('serves it to anyone who may read issues', async () => {
    for (const user of [admin, engineer]) {
      currentSession = sessionFor(user)
      const response = await call('issue-photo', standalonePhotoId)
      expect(response.status, user.role).toBe(200)
      expect(response.headers.get('content-type'), user.role).toBe('image/png')
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      // Nothing about where it lives.
      const headerText = [...response.headers.entries()].map(([key, value]) => `${key}:${value}`).join(' ')
      expect(headerText).not.toMatch(/test-issue|storage|e{16}/)
    }
  })

  it('refuses an anonymous caller and a viewer with no issue permission', async () => {
    currentSession = null
    expect((await call('issue-photo', standalonePhotoId)).status).toBe(401)

    // A VIEWER holds booking.read but not issue.read: an equipment-only issue
    // photo is not theirs to see.
    currentSession = sessionFor(viewer)
    expect((await call('issue-photo', standalonePhotoId)).status).toBe(403)
  })

  it('lets the booking side see a photo that came from their booking', async () => {
    // A VIEWER holds booking.read, so an issue photo carrying a booking is
    // readable through that booking.
    currentSession = sessionFor(viewer)
    expect((await call('issue-photo', bookingPhotoId)).status).toBe(200)

    // The booking's own editor may see it; another editor may not.
    currentSession = sessionFor(ownEditorUser)
    expect((await call('issue-photo', bookingPhotoId)).status).toBe(200)
    expect((await call('issue-photo', standalonePhotoId)).status).toBe(403)

    currentSession = sessionFor(otherEditorUser)
    expect((await call('issue-photo', bookingPhotoId)).status).toBe(403)
  })

  it('does not confuse an issue photo with an inspection photo, and refuses odd ids', async () => {
    currentSession = sessionFor(admin)
    // The kinds are separate lookups: an issue photo is not served as 'photo'.
    expect((await call('photo', standalonePhotoId)).status).toBe(404)
    expect((await call('issue-photo', 'clzzzzzzzzzzzzzzzzzzzzzz')).status).toBe(404)
    expect((await call('issue-photo', '../../etc/passwd')).status).toBe(404)
    expect((await call('issue-photos', standalonePhotoId)).status).toBe(404)
  })
})
