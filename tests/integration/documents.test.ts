import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { UserRole } from '@prisma/client'
import type { Session } from 'next-auth'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { env } from '@/lib/env'
import type { Actor } from '@/server/auth/session'
import type { Db } from '@/server/db/prisma'

import { actorFor, createTestUser, testDb, type TestUser } from '../helpers/db'

/**
 * Handover and return documents (AD-6).
 *
 * The roadmap's own test for this phase is here: regenerate a handover
 * document *after* renaming the kit and swapping an asset's serial number, and
 * it must still show what was signed. That is the whole point of rendering
 * from `documentSnapshot` rather than from live joins.
 *
 * One rolled-back transaction with the prisma client proxied onto it, the
 * session stubbed, and real signature files in a throwaway directory inside
 * the store so the PDF can embed them. The directory is removed in `afterAll`.
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

const { GET } = await import('@/app/api/documents/[kind]/[id]/route')
const { availableDocuments, loadDocument, renderDocument } = await import('@/server/services/documents.service')
const { readDocument } = await import('@/server/documents/snapshot')
const { createAsset, addAccessory } = await import('@/server/services/assets.service')
const { createBooking, markReadyForHandover } = await import('@/server/services/bookings.service')
const { createEditor } = await import('@/server/services/editors.service')
const { addKitAsset, addKitSoftware, createKit } = await import('@/server/services/kits.service')
const { captureSignature, completeHandover, saveChecklistVerification, saveEquipmentVerification, startHandover } = await import('@/server/services/handover.service')
const { getLiveHandover } = await import('@/server/dal/handover.dal')
const { getLiveReturn } = await import('@/server/dal/return.dal')
const { captureReturnSignature, completeReturn, saveReturnChecklist, saveReturnEquipment, startReturn } = await import('@/server/services/return.service')

/** A real 1x1 PNG, written to disk so the PDF can embed it. */
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const PNG_DATA_URL = `data:image/png;base64,${PNG_BYTES.toString('base64')}`
const tag = randomUUID().slice(0, 8).toUpperCase()
const local = (day: number, hour: number) => `2050-03-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`
const testDirectory = `test-docs-${tag.toLowerCase()}`
const storeRoot = env.STORAGE_LOCAL_PATH

/** A signature store that writes into the throwaway directory. */
const fileStore = {
  async save({ type }: { bookingId: string; type: string; bytes: Buffer }) {
    const name = `${type.toLowerCase()}-${randomUUID().slice(0, 8)}.png`
    await writeFile(path.join(storeRoot, testDirectory, name), PNG_BYTES)
    return { provider: 'LOCAL' as const, path: `${testDirectory}/${name}`, hash: 'a'.repeat(64), sizeBytes: PNG_BYTES.length }
  },
  async remove() {
    /* the directory is removed wholesale in afterAll */
  },
}

function sessionFor(user: TestUser | null): Session | null {
  return user ? { expires: new Date(Date.now() + 60_000).toISOString(), user: { id: user.id, name: user.name, email: user.email, role: user.role } } : null
}

async function call(kind: string, id: string) {
  const request = new NextRequest(`http://localhost:3000/api/documents/${kind}/${id}`, { headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http' } })
  return GET(request, { params: Promise.resolve({ kind, id }) })
}

let admin: TestUser
let engineer: TestUser
let viewer: TestUser
let ownEditorUser: TestUser
let otherEditorUser: TestUser
let adminActor: Actor
let engineerActor: Actor
let ownEditorActor: Actor
let otherEditorActor: Actor
let bookingId: string
let bookingNumber: string
let kitId: string
let assetId: string
let openBookingId: string
let countersBefore: Array<{ scope: string; current: number }>

beforeAll(async () => {
  await ready
  countersBefore = await tx.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })
  await mkdir(path.join(storeRoot, testDirectory), { recursive: true })

  admin = await createTestUser(tx, { role: UserRole.ADMIN })
  engineer = await createTestUser(tx, { role: UserRole.ENGINEER })
  viewer = await createTestUser(tx, { role: UserRole.VIEWER })
  ownEditorUser = await createTestUser(tx, { role: UserRole.EDITOR })
  otherEditorUser = await createTestUser(tx, { role: UserRole.EDITOR })
  adminActor = actorFor(admin)
  engineerActor = actorFor(engineer)

  const [engineerProfile, category, software, accessoryType] = await Promise.all([
    tx.engineerProfile.findFirstOrThrow({ select: { id: true } }),
    tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' }, select: { id: true } }),
    tx.softwareApplication.findFirstOrThrow({ where: { deletedAt: null, isActive: true }, select: { id: true } }),
    tx.accessoryType.findFirstOrThrow({ where: { code: 'POWER_CABLE' }, select: { id: true } }),
  ])

  const kit = await createKit(tx, adminActor, {
    kitCode: `DOC-${tag}`,
    name: 'Original kit name',
    admBarcode: `ADM-DOCKIT-${tag}`,
    description: undefined,
    location: undefined,
    notes: undefined,
    suitcaseStatus: 'GOOD',
    status: 'AVAILABLE',
  })
  kitId = kit.id

  const asset = await createAsset(tx, adminActor, {
    name: 'Original asset name',
    categoryId: category.id,
    manufacturer: 'Testco',
    model: 'D-1',
    serialNumber: `SN-ORIGINAL-${tag}`,
    admBarcode: `ADM-DOC-${tag}`,
    location: undefined,
    notes: undefined,
    status: 'AVAILABLE',
  })
  assetId = asset.id
  await addAccessory(tx, adminActor, asset.id, { accessoryTypeId: accessoryType.id, label: 'Power adapter', quantity: 1, serialNumber: undefined, admBarcode: undefined, isRequired: true, notes: undefined })
  await addKitAsset(tx, adminActor, kit.id, { assetId: asset.id, slotLabel: 'Slot 1', isRequired: true })
  await addKitSoftware(tx, adminActor, kit.id, { softwareApplicationId: software.id, isRequired: true })

  const ownEditor = await createEditor(tx, adminActor, {
    fullName: `Doc Own Editor ${tag}`,
    staffId: `EDT-DOC-${tag}`,
    email: undefined,
    contactNumber: '+971 50 321 9876',
    department: 'Post-production',
    company: undefined,
    type: 'INTERNAL',
    notes: undefined,
    userId: ownEditorUser.id,
    isActive: true,
  })
  const otherEditor = await createEditor(tx, adminActor, {
    fullName: `Doc Other Editor ${tag}`,
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
  ownEditorActor = actorFor(ownEditorUser, { editorProfileId: ownEditor.id })
  otherEditorActor = actorFor(otherEditorUser, { editorProfileId: otherEditor.id })

  const booking = await createBooking(tx, adminActor, {
    editorId: ownEditor.id,
    kitId: kit.id,
    engineerId: engineerProfile.id,
    bookingStart: local(10, 9),
    bookingEnd: local(16, 18),
    collectionDate: undefined,
    expectedReturnDate: local(16, 17),
    purpose: 'Document phase test',
    notes: undefined,
    intent: 'reserve',
  })
  bookingId = booking.id
  bookingNumber = booking.bookingNumber

  // A complete handover, then a complete return with one damaged item.
  await markReadyForHandover(tx, adminActor, booking.id)
  await startHandover(tx, engineerActor, booking.id)
  const handover = (await getLiveHandover(tx, booking.id))!
  await saveEquipmentVerification(tx, engineerActor, booking.id, {
    suitcaseStatus: 'GOOD',
    generalNotes: 'Packed and checked',
    assets: handover.lines.map((line) => ({ id: line.id, status: 'INCLUDED' as const, notes: undefined })),
    accessories: handover.lines.flatMap((line) => line.accessories.map((accessory) => ({ id: accessory.id, status: 'INCLUDED' as const, quantityReceived: 1, notes: undefined }))),
  })
  await saveChecklistVerification(tx, engineerActor, booking.id, {
    checks: handover.checklist.map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })),
    software: handover.software.map((check) => ({ id: check.id, status: 'INSTALLED' as const, installedVersion: '2050.1', notes: undefined })),
  })
  await captureSignature(tx, engineerActor, booking.id, 'EDITOR', PNG_DATA_URL, fileStore)
  await captureSignature(tx, engineerActor, booking.id, 'ENGINEER', PNG_DATA_URL, fileStore)
  await completeHandover(tx, engineerActor, booking.id)

  await startReturn(tx, engineerActor, booking.id)
  const inspection = (await getLiveReturn(tx, booking.id))!
  await saveReturnEquipment(tx, engineerActor, booking.id, {
    suitcaseStatus: 'MINOR_DAMAGE',
    generalNotes: 'Lid scuffed in transit',
    assets: inspection.lines.map((line) => ({ id: line.id, status: 'DAMAGED' as const, notes: 'Scuffed lid' })),
    accessories: inspection.lines.flatMap((line) => line.accessories.map((accessory) => ({ id: accessory.id, status: 'INCLUDED' as const, quantityReceived: 1, notes: undefined }))),
  })
  const withChecks = (await getLiveReturn(tx, booking.id))!
  if (withChecks.checklist.length > 0) {
    await saveReturnChecklist(tx, engineerActor, booking.id, { checks: withChecks.checklist.map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })) })
  }
  await captureReturnSignature(tx, engineerActor, booking.id, 'ENGINEER', PNG_DATA_URL, fileStore)
  await completeReturn(tx, engineerActor, booking.id)

  // A second booking left as a draft: nothing to print.
  const openBooking = await createBooking(tx, adminActor, {
    editorId: ownEditor.id,
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
  openBookingId = openBooking.id
})

afterAll(async () => {
  releaseTransaction?.()
  await transaction
  await rm(path.join(storeRoot, testDirectory), { recursive: true, force: true })
  expect(await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })).toEqual(countersBefore)
  expect(await testDb.kit.count({ where: { kitCode: { startsWith: 'DOC-' } } })).toBe(0)
  expect(await testDb.signature.count({ where: { imagePath: { startsWith: testDirectory } } })).toBe(0)
  await testDb.$disconnect()
})

describe('the frozen document', () => {
  it('carries everything the record needs, from the snapshot', async () => {
    const access = await loadDocument(tx, adminActor, bookingId, 'handover')
    expect(access.status).toBe('ok')
    if (access.status !== 'ok') return

    const document = access.document
    expect(document.bookingNumber).toBe(bookingNumber)
    expect(document.editor).toMatchObject({ name: `Doc Own Editor ${tag}`, staffId: `EDT-DOC-${tag}`, contactNumber: '+971 50 321 9876', type: 'INTERNAL' })
    expect(document.kit).toMatchObject({ code: `DOC-${tag}`, name: 'Original kit name' })
    expect(document.engineer.handedOverBy).toBe(engineer.name)
    expect(document.collectedAt).toBeTruthy()
    expect(document.expectedReturnDate).toBeTruthy()
    expect(document.equipment).toHaveLength(1)
    expect(document.equipment[0]).toMatchObject({ name: 'Original asset name', serialNumber: `SN-ORIGINAL-${tag}`, status: 'INCLUDED' })
    expect(document.equipment[0].accessories[0]).toMatchObject({ label: 'Power adapter', status: 'INCLUDED' })
    expect(document.checklist.length).toBeGreaterThan(0)
    expect(document.software[0]).toMatchObject({ status: 'INSTALLED', installedVersion: '2050.1' })
    expect(document.signatures).toHaveLength(2)
    expect(document.signatures.map((signature) => signature.type).sort()).toEqual(['HANDOVER_EDITOR', 'HANDOVER_ENGINEER'])
    expect(document.generalNotes).toBe('Packed and checked')

    // Nothing internal is carried into the view model.
    expect(JSON.stringify(document)).not.toMatch(/imagePath|storagePath|passwordHash/)
    expect(JSON.stringify(document)).not.toMatch(/[0-9a-f]{64}/)
  })

  it('shows the return against what went out, with the punctuality worked out', async () => {
    const access = await loadDocument(tx, adminActor, bookingId, 'return')
    expect(access.status).toBe('ok')
    if (access.status !== 'ok') return

    expect(access.document.kind).toBe('return')
    expect(access.document.returnedAt).toBeTruthy()
    expect(access.document.punctuality).toBe('early')
    expect(access.document.equipment[0]).toMatchObject({ handoverStatus: 'INCLUDED', returnStatus: 'DAMAGED', notes: 'Scuffed lid' })
    expect(access.document.measuredAgainst?.lineCount).toBe(1)
    expect(access.document.generalNotes).toBe('Lid scuffed in transit')
    // The return has the engineer's signature; the editor's is optional.
    expect(access.document.signatures.map((signature) => signature.type)).toEqual(['RETURN_ENGINEER'])
  })

  it('still shows what was signed after the kit is renamed and a serial swapped', async () => {
    // The roadmap's test for this phase. The rename is the premise, so it is
    // applied to the rows directly - the equipment could equally have been
    // dismantled, re-serialised or retired by then.
    await tx.kit.update({ where: { id: kitId }, data: { name: 'Kit renamed after the handover' } })
    await tx.asset.update({ where: { id: assetId }, data: { name: 'Asset renamed after the handover', serialNumber: `SN-SWAPPED-${tag}` } })

    // The live rows have changed...
    const live = await tx.asset.findUniqueOrThrow({ where: { id: assetId }, select: { name: true, serialNumber: true } })
    expect(live).toMatchObject({ name: 'Asset renamed after the handover', serialNumber: `SN-SWAPPED-${tag}` })

    // ...and the document has not.
    const access = await loadDocument(tx, adminActor, bookingId, 'handover')
    expect(access.status).toBe('ok')
    if (access.status !== 'ok') return
    expect(access.document.kit.name).toBe('Original kit name')
    expect(access.document.equipment[0]).toMatchObject({ name: 'Original asset name', serialNumber: `SN-ORIGINAL-${tag}` })

    // And the PDF regenerated now still says the same.
    const rendered = await renderDocument(tx, access, { now: new Date() })
    expect(Buffer.from(rendered.bytes.slice(0, 5)).toString()).toBe('%PDF-')
    expect(rendered.bytes.byteLength).toBeGreaterThan(1000)
    expect(rendered.fileName).toBe(`${bookingNumber}-handover.pdf`)
  })

  it('parses a snapshot defensively rather than throwing', () => {
    expect(readDocument('handover', null)).toBeNull()
    expect(readDocument('handover', 'not an object')).toBeNull()

    // An older or partial shape renders with nulls instead of failing.
    const sparse = readDocument('handover', { booking: { number: 'BK-1' }, equipment: [{ assetCode: 'AST-1' }, 'rubbish'], signatures: [{ type: 'X' }] })
    expect(sparse).not.toBeNull()
    expect(sparse?.bookingNumber).toBe('BK-1')
    expect(sparse?.equipment).toHaveLength(1)
    expect(sparse?.equipment[0]).toMatchObject({ assetCode: 'AST-1', name: null, accessories: [] })
    expect(sparse?.editor.name).toBeNull()
    expect(sparse?.checklist).toEqual([])
  })
})

describe('the PDF', () => {
  it('embeds the signatures and produces one file per document', async () => {
    const handover = await loadDocument(tx, adminActor, bookingId, 'handover')
    const returned = await loadDocument(tx, adminActor, bookingId, 'return')
    expect(handover.status).toBe('ok')
    expect(returned.status).toBe('ok')
    if (handover.status !== 'ok' || returned.status !== 'ok') return

    const handoverPdf = await renderDocument(tx, handover, { now: new Date() })
    const returnPdf = await renderDocument(tx, returned, { now: new Date() })

    for (const pdf of [handoverPdf, returnPdf]) {
      expect(Buffer.from(pdf.bytes.slice(0, 5)).toString()).toBe('%PDF-')
      expect(pdf.bytes.byteLength).toBeGreaterThan(1000)
    }
    // The handover carries two signature images, the return one, so its file
    // is the larger of the two.
    expect(handoverPdf.bytes.byteLength).toBeGreaterThan(returnPdf.bytes.byteLength)
    expect(returnPdf.fileName).toBe(`${bookingNumber}-return.pdf`)

    // A missing image must not cost the document. Take the files away and it
    // still renders - the record of who signed and when is in the snapshot.
    await rm(path.join(storeRoot, testDirectory), { recursive: true, force: true })
    const withoutImages = await renderDocument(tx, handover, { now: new Date() })
    expect(Buffer.from(withoutImages.bytes.slice(0, 5)).toString()).toBe('%PDF-')
    expect(withoutImages.bytes.byteLength).toBeLessThan(handoverPdf.bytes.byteLength)
  })

  it('lists which documents a booking has', async () => {
    expect((await availableDocuments(tx, bookingId)).sort()).toEqual(['handover', 'return'])
    expect(await availableDocuments(tx, openBookingId)).toEqual([])
  })
})

describe('who may open a document', () => {
  it('serves it to a booking reader, inline, with dull headers', async () => {
    for (const user of [admin, engineer, viewer]) {
      currentSession = sessionFor(user)
      const response = await call('handover', bookingId)
      expect(response.status, user.role).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/pdf')
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('content-disposition')).toContain(`${bookingNumber}-handover.pdf`)
      const headerText = [...response.headers.entries()].map(([key, value]) => `${key}:${value}`).join(' ')
      expect(headerText).not.toMatch(/test-docs|storage/)
    }
  })

  it('refuses an anonymous caller', async () => {
    currentSession = null
    const response = await call('handover', bookingId)
    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toContain('application/json')
  })

  it('lets an editor open their own booking’s document and nobody else’s', async () => {
    currentSession = sessionFor(ownEditorUser)
    expect((await call('handover', bookingId)).status).toBe(200)
    expect((await call('return', bookingId)).status).toBe(200)

    // The service is where that rule lives, so check it directly too.
    expect((await loadDocument(tx, ownEditorActor, bookingId, 'handover')).status).toBe('ok')
    expect((await loadDocument(tx, otherEditorActor, bookingId, 'handover')).status).toBe('forbidden')

    currentSession = sessionFor(otherEditorUser)
    expect((await call('handover', bookingId)).status).toBe(403)
  })

  it('answers plainly for a booking with nothing signed, an unknown booking and an odd kind', async () => {
    currentSession = sessionFor(admin)

    const notReady = await call('handover', openBookingId)
    expect(notReady.status).toBe(409)
    expect(await notReady.json()).toMatchObject({ error: 'not_ready' })

    expect((await call('handover', 'clzzzzzzzzzzzzzzzzzzzzzz')).status).toBe(404)
    expect((await call('invoice', bookingId)).status).toBe(404)
    expect((await call('handover', '../../etc/passwd')).status).toBe(404)

    // And the service agrees about an unknown booking.
    expect((await loadDocument(tx, adminActor, 'clzzzzzzzzzzzzzzzzzzzzzz', 'handover')).status).toBe('not-found')
  })
})
