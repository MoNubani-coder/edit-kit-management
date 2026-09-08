import { randomUUID } from 'node:crypto'

import { UserRole } from '@prisma/client'
import type { Session } from 'next-auth'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { UnauthorizedError } from '@/server/auth/errors'
import type { Db } from '@/server/db/prisma'

import { actorFor, createTestUser, testDb, type TestUser } from '../helpers/db'

/**
 * The booking Server Actions invoked directly, as a hostile client could POST
 * them - with the session stubbed and the database real. The whole suite runs
 * inside ONE PostgreSQL transaction that is rolled back in `afterAll`
 * (`@/server/db/prisma` is a proxy onto the transaction client), so no
 * booking, kit, editor, user, audit row or BK number survives. No test here
 * provokes a database constraint: that would abort the shared transaction.
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

const { createBookingFormAction, updateBookingFormAction, reserveBookingFormAction, markReadyFormAction, cancelBookingFormAction } = await import(
  '@/server/actions/bookings.actions'
)
const { loadBookingList, loadBookingWorkspace } = await import('@/server/services/bookings.service')
const { createKit, addKitAsset } = await import('@/server/services/kits.service')
const { createAsset } = await import('@/server/services/assets.service')
const { createEditor } = await import('@/server/services/editors.service')

const LIST = { filter: 'all', sort: 'bookingStart', direction: 'desc', page: 1, pageSize: 25 } as const

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
let otherEditorUser: TestUser
let engineerId: string
let kitId: string
let kitCode: string
let externalEditorId: string
let countersBefore: Array<{ scope: string; current: number }>
const tag = randomUUID().slice(0, 8).toUpperCase()
let createdBookingId: string | null = null
let ownBookingId: string | null = null

beforeAll(async () => {
  await ready
  countersBefore = await tx.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })
  admin = await createTestUser(tx, { role: UserRole.ADMIN })
  engineer = await createTestUser(tx, { role: UserRole.ENGINEER })
  viewer = await createTestUser(tx, { role: UserRole.VIEWER })
  editorUser = await createTestUser(tx, { role: UserRole.EDITOR, withEditorProfile: true })
  otherEditorUser = await createTestUser(tx, { role: UserRole.EDITOR, withEditorProfile: true })
  // Internal editors need a staff ID before they can be booked.
  await tx.editorProfile.update({ where: { id: editorUser.editorProfileId! }, data: { staffId: `EDT-A${tag.slice(0, 6)}` } })
  await tx.editorProfile.update({ where: { id: otherEditorUser.editorProfileId! }, data: { staffId: `EDT-B${tag.slice(0, 6)}` } })

  engineerId = (await tx.engineerProfile.findFirstOrThrow({ select: { id: true } })).id
  const actor = actorFor(admin)
  const category = await tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' } })
  const kit = await createKit(tx, actor, { kitCode: `ACT-${tag}`, name: `Action booking kit ${tag}`, admBarcode: undefined, description: undefined, location: undefined, notes: undefined, suitcaseStatus: 'GOOD', status: 'AVAILABLE' })
  kitId = kit.id
  kitCode = kit.kitCode
  const asset = await createAsset(tx, actor, {
    name: `Action booking asset ${tag}`,
    categoryId: category.id,
    manufacturer: 'Testco',
    model: 'A-7',
    serialNumber: `SN-ACTBK-${tag}`,
    admBarcode: `ADM-ACTBK-${tag}`,
    location: undefined,
    notes: undefined,
    status: 'AVAILABLE',
  })
  await addKitAsset(tx, actor, kit.id, { assetId: asset.id, slotLabel: undefined, isRequired: true })
  externalEditorId = (
    await createEditor(tx, actor, {
      fullName: `Action External Editor ${tag}`,
      staffId: undefined,
      email: undefined,
      contactNumber: undefined,
      department: undefined,
      company: 'Freelance',
      type: 'EXTERNAL',
      notes: undefined,
      userId: undefined,
      isActive: true,
    })
  ).id
})

afterAll(async () => {
  releaseTransaction?.()
  await transaction
  const countersAfter = await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })
  expect(countersAfter).toEqual(countersBefore)
  expect(await testDb.booking.count({ where: { kit: { kitCode } } })).toBe(0)
  expect(await testDb.kit.count({ where: { kitCode } })).toBe(0)
  expect(await testDb.editorProfile.count({ where: { fullName: { startsWith: 'Action External Editor' } } })).toBe(0)
  expect(await testDb.user.count({ where: { id: { in: [admin.id, engineer.id, viewer.id, editorUser.id, otherEditorUser.id] } } })).toBe(0)
  await testDb.$disconnect()
})

beforeEach(() => {
  currentSession = null
})

const fields = (overrides: Record<string, string> = {}) => ({
  editorId: externalEditorId,
  kitId,
  engineerId,
  bookingStart: '2041-05-10T09:00',
  bookingEnd: '2041-05-12T18:00',
  purpose: 'Action test',
  intent: 'draft',
  ...overrides,
})

describe('booking access', () => {
  it('rejects anonymous list access', async () => {
    await expect(loadBookingList(LIST)).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('lets a VIEWER list every booking but not create one', async () => {
    currentSession = sessionFor(viewer)
    const page = await loadBookingList(LIST)
    expect(page.seesAll).toBe(true)
    expect(page.canCreate).toBe(false)
    expect(await createBookingFormAction(null, form(fields()))).toMatchObject({ ok: false, error: 'forbidden' })
  })

  it('refuses an EDITOR the create action', async () => {
    currentSession = sessionFor(editorUser)
    expect(await createBookingFormAction(null, form(fields({ editorId: editorUser.editorProfileId! })))).toMatchObject({ ok: false, error: 'forbidden' })
  })
})

describe('booking mutations', () => {
  it('returns field-level validation errors before touching the database', async () => {
    currentSession = sessionFor(engineer)
    const result = await createBookingFormAction(null, form({ ...fields(), bookingStart: '', bookingEnd: '' }))
    expect(result).toMatchObject({ ok: false, error: 'validation' })
    if (result && !result.ok) expect(result.fieldErrors).toHaveProperty('bookingStart')
    expect(await tx.booking.count({ where: { kitId } })).toBe(0)
  })

  it('lets an ENGINEER create a draft, audited, and redirects to the booking', async () => {
    currentSession = sessionFor(engineer)
    await expect(createBookingFormAction(null, form(fields()))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    const row = await tx.booking.findFirstOrThrow({ where: { kitId } })
    expect(row).toMatchObject({ status: 'DRAFT', purpose: 'Action test', createdById: engineer.id })
    expect(row.bookingNumber).toMatch(/^BK-\d{4}-\d{6}$/)
    createdBookingId = row.id
    expect((await tx.auditLog.findMany({ where: { entityType: 'Booking', entityId: row.id } })).map((entry) => entry.action)).toEqual(['BOOKING_CREATED'])
  })

  it('lets an ADMIN reserve the draft; the window is then held', async () => {
    expect(createdBookingId).not.toBeNull()
    currentSession = sessionFor(admin)
    await expect(reserveBookingFormAction(null, form({ id: createdBookingId! }))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    expect((await tx.booking.findUniqueOrThrow({ where: { id: createdBookingId! } })).status).toBe('RESERVED')

    // Another reservation on the same window is refused with a sentence (pre-check, not the constraint).
    const overlap = await createBookingFormAction(null, form(fields({ intent: 'reserve', bookingStart: '2041-05-11T09:00', bookingEnd: '2041-05-13T09:00' })))
    expect(overlap).toMatchObject({ ok: false, error: 'rejected', message: expect.stringContaining('already booked') })
  })

  it('lets an ENGINEER edit the notes only with a reason, which the audit trail keeps', async () => {
    expect(createdBookingId).not.toBeNull()
    currentSession = sessionFor(engineer)

    // No reason, no edit: the form is sent back, and nothing is written.
    const refused = await updateBookingFormAction(null, form({ ...fields(), id: createdBookingId!, notes: 'Charge the laptop' }))
    expect(refused).toMatchObject({ ok: false, error: 'validation' })
    if (refused && !refused.ok) expect(refused.fieldErrors).toHaveProperty('reason')
    expect((await tx.booking.findUniqueOrThrow({ where: { id: createdBookingId! } })).notes).not.toBe('Charge the laptop')
    expect(await tx.auditLog.count({ where: { entityType: 'Booking', entityId: createdBookingId!, action: 'BOOKING_UPDATED' } })).toBe(0)

    const reason = 'Editor asked for the laptop to arrive charged'
    await expect(updateBookingFormAction(null, form({ ...fields(), id: createdBookingId!, notes: 'Charge the laptop', reason }))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    expect((await tx.booking.findUniqueOrThrow({ where: { id: createdBookingId! } })).notes).toBe('Charge the laptop')

    // The reason is in the summary the activity tab shows and in the structured metadata, never as raw JSON on a page.
    const entries = await tx.auditLog.findMany({ where: { entityType: 'Booking', entityId: createdBookingId!, action: 'BOOKING_UPDATED' } })
    expect(entries).toHaveLength(1)
    expect(entries[0].summary).toContain(`Reason: ${reason}`)
    expect(entries[0].metadata).toMatchObject({ reason })
  })

  it('shows an EDITOR only their own booking through the scoped loaders', async () => {
    currentSession = sessionFor(admin)
    await expect(
      createBookingFormAction(null, form(fields({ editorId: editorUser.editorProfileId!, bookingStart: '2041-06-01T09:00', bookingEnd: '2041-06-02T18:00' }))),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    ownBookingId = (await tx.booking.findFirstOrThrow({ where: { kitId, editorId: editorUser.editorProfileId! } })).id

    currentSession = sessionFor(editorUser)
    const page = await loadBookingList(LIST)
    expect(page.seesAll).toBe(false)
    expect(page.result.rows.map((row) => row.id)).toEqual([ownBookingId])
    expect(await loadBookingWorkspace(tx, actorFor(editorUser), ownBookingId!)).not.toBeNull()
    expect(await loadBookingWorkspace(tx, actorFor(editorUser), createdBookingId!)).toBeNull()
    expect(await loadBookingWorkspace(tx, actorFor(otherEditorUser), ownBookingId!)).toBeNull()
  })

  it('applies cancellation authorization and state rules through the action layer', async () => {
    expect(createdBookingId).not.toBeNull()
    currentSession = sessionFor(viewer)
    expect(await cancelBookingFormAction(null, form({ id: createdBookingId!, reason: 'Nope' }))).toMatchObject({ ok: false, error: 'forbidden' })

    currentSession = sessionFor(admin)
    expect(await cancelBookingFormAction(null, form({ id: createdBookingId!, reason: '' }))).toMatchObject({ ok: false, error: 'validation' })
    await expect(cancelBookingFormAction(null, form({ id: createdBookingId!, reason: 'Client postponed the shoot' }))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    const row = await tx.booking.findUniqueOrThrow({ where: { id: createdBookingId! } })
    expect(row).toMatchObject({ status: 'CANCELLED', cancelReason: 'Client postponed the shoot' })
    expect(row.cancelledAt).not.toBeNull()

    // Terminal: the transition actions answer with a sentence, never a 500.
    expect(await markReadyFormAction(null, form({ id: createdBookingId! }))).toMatchObject({ ok: false, error: 'rejected' })
    expect(await cancelBookingFormAction(null, form({ id: createdBookingId!, reason: 'Again' }))).toMatchObject({ ok: false, error: 'rejected', message: expect.stringContaining('already cancelled') })
  })
})
