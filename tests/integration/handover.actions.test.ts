import { randomUUID } from 'node:crypto'

import { UserRole } from '@prisma/client'
import type { Session } from 'next-auth'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Db } from '@/server/db/prisma'

import { actorFor, createTestUser, testDb, type TestUser, } from '../helpers/db'
import { prepareChecklistFor } from '../helpers/checklist'

/**
 * The handover Server Actions invoked directly, as a hostile client could POST
 * them - with the session stubbed and the database real. The suite runs inside
 * ONE PostgreSQL transaction that is rolled back in `afterAll`; the signature
 * store is swapped for the in-memory one. No test provokes a database
 * constraint: that would abort the shared transaction.
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
    { maxWait: 10_000, timeout: 180_000 },
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
vi.mock('@/server/storage/signature-store', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/storage/signature-store')>()
  return { ...original, signatureStore: original.memorySignatureStore() }
})

const { startHandoverFormAction, saveEquipmentFormAction, saveChecklistFormAction, captureSignatureFormAction, completeHandoverFormAction } = await import(
  '@/server/actions/handover.actions'
)
const { loadHandoverWorkspace } = await import('@/server/services/handover.service')
const { loadBookingWorkspace, createBooking, markReadyForHandover } = await import('@/server/services/bookings.service')
const { createKit, addKitAsset, addKitSoftware } = await import('@/server/services/kits.service')
const { createAsset } = await import('@/server/services/assets.service')
const { createEditor } = await import('@/server/services/editors.service')
const { getLiveHandover } = await import('@/server/dal/handover.dal')

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function sessionFor(user: TestUser): Session {
  return { expires: new Date(Date.now() + 60_000).toISOString(), user: { id: user.id, name: user.name, email: user.email, role: user.role } }
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

let admin: TestUser
let engineer: TestUser
let viewer: TestUser
let editorUser: TestUser
let bookingId: string
let kitCode: string
let externalEditorId: string
let countersBefore: Array<{ scope: string; current: number }>
const tag = randomUUID().slice(0, 8).toUpperCase()

beforeAll(async () => {
  await ready
  countersBefore = await tx.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })
  admin = await createTestUser(tx, { role: UserRole.ADMIN })
  engineer = await createTestUser(tx, { role: UserRole.ENGINEER })
  viewer = await createTestUser(tx, { role: UserRole.VIEWER })
  editorUser = await createTestUser(tx, { role: UserRole.EDITOR, withEditorProfile: true })

  const actor = actorFor(admin)
  const engineerProfile = await tx.engineerProfile.findFirstOrThrow({ select: { id: true } })
  const category = await tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' } })
  const software = await tx.softwareApplication.findFirstOrThrow({ where: { deletedAt: null, isActive: true } })
  const kit = await createKit(tx, actor, { kitCode: `HOA-${tag}`, name: `Action handover kit ${tag}`, admBarcode: undefined, description: undefined, location: undefined, notes: undefined, suitcaseStatus: 'GOOD', status: 'AVAILABLE' })
  kitCode = kit.kitCode
  const asset = await createAsset(tx, actor, { name: `Action handover asset ${tag}`, categoryId: category.id, manufacturer: 'Testco', model: 'A-8', serialNumber: `SN-HOA-${tag}`, admBarcode: `ADM-HOA-${tag}`, location: undefined, notes: undefined, status: 'AVAILABLE' })
  await addKitAsset(tx, actor, kit.id, { assetId: asset.id, slotLabel: undefined, isRequired: true })
  await addKitSoftware(tx, actor, kit.id, { softwareApplicationId: software.id, isRequired: true })
  externalEditorId = (
    await createEditor(tx, actor, { fullName: `Action Handover Editor ${tag}`, staffId: undefined, email: undefined, contactNumber: undefined, department: undefined, company: 'Freelance', type: 'EXTERNAL', notes: undefined, userId: undefined, isActive: true })
  ).id
  const booking = await createBooking(tx, actor, {
    editorId: externalEditorId,
    kitId: kit.id,
    engineerId: engineerProfile.id,
    bookingStart: '2042-06-10T09:00',
    bookingEnd: '2042-06-12T18:00',
    collectionDate: undefined,
    expectedReturnDate: undefined,
    purpose: 'Action handover',
    notes: undefined,
    intent: 'reserve',
  })
  bookingId = booking.id
  await prepareChecklistFor(tx, actor, bookingId)
  await markReadyForHandover(tx, actor, bookingId)
})

afterAll(async () => {
  releaseTransaction?.()
  await transaction
  expect(await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })).toEqual(countersBefore)
  expect(await testDb.kit.count({ where: { kitCode } })).toBe(0)
  expect(await testDb.inspection.count({ where: { booking: { kit: { kitCode } } } })).toBe(0)
  expect(await testDb.signature.count({ where: { booking: { kit: { kitCode } } } })).toBe(0)
  expect(await testDb.user.count({ where: { id: { in: [admin.id, engineer.id, viewer.id, editorUser.id] } } })).toBe(0)
  await testDb.$disconnect()
})

beforeEach(() => {
  currentSession = null
})

describe('handover access', () => {
  it('rejects anonymous, VIEWER and EDITOR attempts to start a handover', async () => {
    expect(await startHandoverFormAction(null, form({ bookingId }))).toMatchObject({ ok: false, error: 'unauthorized' })
    currentSession = sessionFor(viewer)
    expect(await startHandoverFormAction(null, form({ bookingId }))).toMatchObject({ ok: false, error: 'forbidden' })
    currentSession = sessionFor(editorUser)
    expect(await startHandoverFormAction(null, form({ bookingId }))).toMatchObject({ ok: false, error: 'forbidden' })
    expect(await tx.inspection.count({ where: { bookingId } })).toBe(0)
  })
})

describe('handover workflow through the actions', () => {
  it('lets an ENGINEER start the handover once, however many times the button is pressed', async () => {
    currentSession = sessionFor(engineer)
    await expect(startHandoverFormAction(null, form({ bookingId }))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    await expect(startHandoverFormAction(null, form({ bookingId }))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    expect(await tx.inspection.count({ where: { bookingId } })).toBe(1)
    expect(await tx.bookingChecklistItem.count({ where: { bookingId } })).toBe(12)
    const workspace = await loadHandoverWorkspace(tx, actorFor(engineer), bookingId)
    expect(workspace?.inspection?.lines).toHaveLength(1)
    expect(workspace?.canComplete).toBe(false)
  })

  it('records equipment and checklist answers from the posted line fields', async () => {
    currentSession = sessionFor(engineer)
    const inspection = (await getLiveHandover(tx, bookingId))!
    const line = inspection.lines[0]
    await expect(
      saveEquipmentFormAction(null, form({ bookingId, suitcaseStatus: 'GOOD', generalNotes: 'Checked twice', [`asset.${line.id}.status`]: 'INCLUDED', [`asset.${line.id}.notes`]: 'Clean' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })

    const fields: Record<string, string> = { bookingId }
    for (const item of inspection.checklist) fields[`check.${item.id}.status`] = 'PASS'
    for (const check of inspection.software) fields[`software.${check.id}.status`] = 'INSTALLED'
    await expect(saveChecklistFormAction(null, form(fields))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })

    const saved = (await getLiveHandover(tx, bookingId))!
    expect(saved.lines[0]).toMatchObject({ status: 'INCLUDED', notes: 'Clean' })
    expect(saved.generalNotes).toBe('Checked twice')
    expect(saved.checklist.every((item) => item.result?.status === 'PASS')).toBe(true)
    expect(saved.status).toBe('PENDING_SIGNATURES')

    // A bogus line id is refused, not written.
    expect(await saveEquipmentFormAction(null, form({ bookingId, suitcaseStatus: 'GOOD', 'asset.bogus.status': 'MISSING' }))).toMatchObject({ ok: false, error: 'rejected' })
  })

  it('captures both signatures with server-side identity; VIEWER cannot sign; bad images are refused', async () => {
    currentSession = sessionFor(viewer)
    expect(await captureSignatureFormAction(null, form({ bookingId, role: 'EDITOR', image: PNG }))).toMatchObject({ ok: false, error: 'forbidden' })

    currentSession = sessionFor(engineer)
    expect(await captureSignatureFormAction(null, form({ bookingId, role: 'EDITOR', image: 'data:image/jpeg;base64,AAAA' }))).toMatchObject({ ok: false, error: 'validation' })
    expect(await captureSignatureFormAction(null, form({ bookingId, role: 'OWNER', image: PNG }))).toMatchObject({ ok: false, error: 'validation' })
    await expect(captureSignatureFormAction(null, form({ bookingId, role: 'EDITOR', image: PNG }))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })

    currentSession = sessionFor(admin)
    await expect(captureSignatureFormAction(null, form({ bookingId, role: 'ENGINEER', image: PNG }))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })

    const rows = await tx.signature.findMany({ where: { bookingId, voidedAt: null } })
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.type === 'HANDOVER_EDITOR')).toMatchObject({ signerEditorProfileId: externalEditorId, signerUserId: null })
    expect(rows.find((row) => row.type === 'HANDOVER_ENGINEER')).toMatchObject({ signerUserId: admin.id, signerName: admin.name })
    expect((await loadHandoverWorkspace(tx, actorFor(engineer), bookingId))?.canComplete).toBe(true)
  })

  it('completes once for an ADMIN; a repeat, a VIEWER and an EDITOR are all refused with a sentence', async () => {
    currentSession = sessionFor(viewer)
    expect(await completeHandoverFormAction(null, form({ bookingId, confirm: 'true' }))).toMatchObject({ ok: false, error: 'forbidden' })
    currentSession = sessionFor(editorUser)
    expect(await completeHandoverFormAction(null, form({ bookingId, confirm: 'true' }))).toMatchObject({ ok: false, error: 'forbidden' })

    currentSession = sessionFor(admin)
    expect(await completeHandoverFormAction(null, form({ bookingId }))).toMatchObject({ ok: false, error: 'validation' })
    await expect(completeHandoverFormAction(null, form({ bookingId, confirm: 'true' }))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })

    const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } })
    expect(booking.status).toBe('CHECKED_OUT')
    expect(booking.collectionDate).not.toBeNull()
    expect((await tx.kit.findFirstOrThrow({ where: { kitCode } })).status).toBe('CHECKED_OUT')

    // Double submit / second tab: friendly, no second document, no new signatures.
    expect(await completeHandoverFormAction(null, form({ bookingId, confirm: 'true' }))).toMatchObject({ ok: false, error: 'rejected', message: expect.stringContaining('already been handed over') })
    expect(await captureSignatureFormAction(null, form({ bookingId, role: 'EDITOR', image: PNG }))).toMatchObject({ ok: false, error: 'rejected' })
    expect(await tx.signature.count({ where: { bookingId } })).toBe(2)
    expect(await tx.inspection.count({ where: { bookingId } })).toBe(1)

    // The booking workspace now carries the handover summary for every reader, without paths or hashes.
    currentSession = sessionFor(viewer)
    const workspace = await loadBookingWorkspace(tx, actorFor(viewer), bookingId)
    expect(workspace?.handover).toMatchObject({ status: 'COMPLETED', completedByName: admin.name, includedCount: 1 })
    expect(workspace?.canHandover).toBe(false)
    expect(workspace?.canUpdate).toBe(false)
    expect(workspace?.canCancel).toBe(false)
    expect(JSON.stringify(workspace?.handover)).not.toMatch(/imagePath|imageHash/)
  })
})
