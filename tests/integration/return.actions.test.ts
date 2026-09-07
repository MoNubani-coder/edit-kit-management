import { randomUUID } from 'node:crypto'

import { UserRole } from '@prisma/client'
import type { Session } from 'next-auth'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/server/auth/session'
import type { Db } from '@/server/db/prisma'

import { actorFor, createTestUser, testDb, type TestUser } from '../helpers/db'

/**
 * The return Server Actions and their authorization, exercised through the
 * `action()` wrapper.
 *
 * Same isolation trick as the handover action suite: one long-lived
 * transaction that is rolled back at the end, with `@/server/db/prisma`
 * proxied onto it, so the actions write where the assertions can see it and
 * nothing survives. The signature store is swapped for the in-memory one.
 *
 * Because every write shares that one transaction, no test here may provoke a
 * database-level refusal - PostgreSQL would abort the transaction and take the
 * rest of the file with it. Domain-level refusals are what this suite is about.
 */

const tag = () => randomUUID().slice(0, 8).toUpperCase()
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const local = (day: number, hour: number) => `2043-06-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`

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

/** The session the actions see; the real session module resolves it. */
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

const { createAsset, addAccessory } = await import('@/server/services/assets.service')
const { createBooking, markReadyForHandover } = await import('@/server/services/bookings.service')
const { createEditor } = await import('@/server/services/editors.service')
const { addKitAsset, addKitSoftware, createKit } = await import('@/server/services/kits.service')
const { captureSignature, completeHandover, saveChecklistVerification, saveEquipmentVerification, startHandover } = await import('@/server/services/handover.service')
const { getLiveHandover } = await import('@/server/dal/handover.dal')
const { getLiveReturn } = await import('@/server/dal/return.dal')
const {
  captureReturnSignatureFormAction,
  completeReturnFormAction,
  saveReturnChecklistFormAction,
  saveReturnEquipmentFormAction,
  startReturnFormAction,
} = await import('@/server/actions/return.actions')

function sessionFor(user: TestUser | null): Session | null {
  return user ? { expires: new Date(Date.now() + 60_000).toISOString(), user: { id: user.id, name: user.name, email: user.email, role: user.role } } : null
}

function formData(entries: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.append(key, value)
  return data
}

/** A redirect is how a successful action reports itself. */
function isRedirect(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'digest' in error && String((error as { digest?: unknown }).digest).startsWith('NEXT_REDIRECT'))
}

async function run(action: (previous: never, data: FormData) => Promise<unknown>, entries: Record<string, string>) {
  try {
    const result = await action(null as never, formData(entries))
    return { ok: true, result }
  } catch (error) {
    if (isRedirect(error)) return { ok: true, result: { redirected: true } }
    throw error
  }
}

let admin: TestUser
let engineer: TestUser
let viewer: TestUser
let editorUser: TestUser
let adminActor: Actor
let engineerActor: Actor
let categoryId: string
let softwareId: string
let accessoryTypeId: string
let engineerProfileId: string
let countersBefore: Array<{ scope: string; current: number }>

/** A booking that is out, with a completed handover behind it. */
async function checkedOutBooking(): Promise<{ id: string; number: string; kitId: string; assetCodes: string[] }> {
  const t = tag()
  const kit = await createKit(tx, adminActor, { kitCode: `RTA-${t}`, name: `Return action kit ${t}`, admBarcode: `ADM-RTAKIT-${t}`, description: undefined, location: undefined, notes: undefined, suitcaseStatus: 'GOOD', status: 'AVAILABLE' })
  const assetCodes: string[] = []
  for (const [index, required] of [true, false].entries()) {
    const asset = await createAsset(tx, adminActor, {
      name: `Return action asset ${t}-${index}`,
      categoryId,
      manufacturer: 'Testco',
      model: `A-${index}`,
      serialNumber: `SN-RTA-${t}-${index}`,
      admBarcode: `ADM-RTA-${t}-${index}`,
      location: undefined,
      notes: undefined,
      status: 'AVAILABLE',
    })
    if (required) await addAccessory(tx, adminActor, asset.id, { accessoryTypeId, label: `Cable ${index}`, quantity: 1, serialNumber: undefined, admBarcode: undefined, isRequired: true, notes: undefined })
    await addKitAsset(tx, adminActor, kit.id, { assetId: asset.id, slotLabel: `Slot ${index + 1}`, isRequired: required })
    assetCodes.push(asset.assetCode)
  }
  await addKitSoftware(tx, adminActor, kit.id, { softwareApplicationId: softwareId, isRequired: true })

  const editor = await createEditor(tx, adminActor, {
    fullName: `Return Action Editor ${t}`,
    staffId: undefined,
    email: undefined,
    contactNumber: '+971 50 222 3333',
    department: undefined,
    company: 'Freelance',
    type: 'EXTERNAL',
    notes: undefined,
    userId: undefined,
    isActive: true,
  })
  const booking = await createBooking(tx, adminActor, {
    editorId: editor.id,
    kitId: kit.id,
    engineerId: engineerProfileId,
    bookingStart: local(10, 9),
    bookingEnd: local(14, 18),
    collectionDate: undefined,
    expectedReturnDate: local(14, 17),
    purpose: 'Return action test',
    notes: undefined,
    intent: 'reserve',
  })
  await markReadyForHandover(tx, adminActor, booking.id)
  await startHandover(tx, engineerActor, booking.id)
  const handover = (await getLiveHandover(tx, booking.id))!
  await saveEquipmentVerification(tx, engineerActor, booking.id, {
    suitcaseStatus: 'GOOD',
    generalNotes: undefined,
    assets: handover.lines.map((line) => ({ id: line.id, status: 'INCLUDED' as const, notes: undefined })),
    accessories: handover.lines.flatMap((line) => line.accessories.map((accessory) => ({ id: accessory.id, status: 'INCLUDED' as const, quantityReceived: 1, notes: undefined }))),
  })
  await saveChecklistVerification(tx, engineerActor, booking.id, {
    checks: handover.checklist.map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })),
    software: handover.software.map((check) => ({ id: check.id, status: 'INSTALLED' as const, installedVersion: '2025', notes: undefined })),
  })
  await captureSignature(tx, engineerActor, booking.id, 'EDITOR', PNG, (await import('@/server/storage/signature-store')).signatureStore)
  await captureSignature(tx, engineerActor, booking.id, 'ENGINEER', PNG, (await import('@/server/storage/signature-store')).signatureStore)
  await completeHandover(tx, engineerActor, booking.id)
  return { id: booking.id, number: booking.bookingNumber, kitId: kit.id, assetCodes }
}

beforeAll(async () => {
  await ready
  countersBefore = await tx.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })
  admin = await createTestUser(tx, { role: UserRole.ADMIN })
  engineer = await createTestUser(tx, { role: UserRole.ENGINEER })
  viewer = await createTestUser(tx, { role: UserRole.VIEWER })
  editorUser = await createTestUser(tx, { role: UserRole.EDITOR, withEditorProfile: true })
  adminActor = actorFor(admin)
  engineerActor = actorFor(engineer)
  const [profile, category, software, accessoryType] = await Promise.all([
    tx.engineerProfile.findFirstOrThrow({ select: { id: true } }),
    tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' }, select: { id: true } }),
    tx.softwareApplication.findFirstOrThrow({ where: { deletedAt: null, isActive: true }, select: { id: true } }),
    tx.accessoryType.findFirstOrThrow({ where: { code: 'POWER_CABLE' }, select: { id: true } }),
  ])
  engineerProfileId = profile.id
  categoryId = category.id
  softwareId = software.id
  accessoryTypeId = accessoryType.id
})

afterAll(async () => {
  // Counters must be untouched even before the rollback: every number this
  // suite allocated came from inside the transaction.
  const countersAfter = await tx.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })
  releaseTransaction?.()
  await transaction
  expect(await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })).toEqual(countersBefore)
  expect(await testDb.kit.count({ where: { kitCode: { startsWith: 'RTA-' } } })).toBe(0)
  expect(await testDb.inspection.count({ where: { booking: { kit: { kitCode: { startsWith: 'RTA-' } } } } })).toBe(0)
  expect(await testDb.issue.count({ where: { kit: { kitCode: { startsWith: 'RTA-' } } } })).toBe(0)
  expect(countersAfter.length).toBeGreaterThan(0)
  await testDb.$disconnect()
})

describe('authorization', () => {
  it('refuses an anonymous caller, a VIEWER and an EDITOR', async () => {
    const booking = await checkedOutBooking()

    currentSession = null
    expect(await run(startReturnFormAction, { bookingId: booking.id })).toMatchObject({ result: { ok: false, error: 'unauthorized' } })

    currentSession = sessionFor(viewer)
    expect(await run(startReturnFormAction, { bookingId: booking.id })).toMatchObject({ result: { ok: false, error: 'forbidden' } })

    // An internal editor keeps their own booking view and gains nothing here.
    currentSession = sessionFor(editorUser)
    expect(await run(startReturnFormAction, { bookingId: booking.id })).toMatchObject({ result: { ok: false, error: 'forbidden' } })

    expect(await tx.inspection.count({ where: { bookingId: booking.id, type: 'RETURN' } })).toBe(0)
  })

  it('lets an ENGINEER start once however often the button is pressed', async () => {
    const booking = await checkedOutBooking()
    currentSession = sessionFor(engineer)

    expect(await run(startReturnFormAction, { bookingId: booking.id })).toMatchObject({ ok: true })
    expect(await run(startReturnFormAction, { bookingId: booking.id })).toMatchObject({ ok: true })

    expect(await tx.inspection.count({ where: { bookingId: booking.id, type: 'RETURN' } })).toBe(1)
    expect((await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { status: true } })).status).toBe('RETURN_INSPECTION')
  })

  it('refuses a VIEWER and an EDITOR on every other step too', async () => {
    const booking = await checkedOutBooking()
    currentSession = sessionFor(engineer)
    await run(startReturnFormAction, { bookingId: booking.id })
    const inspection = (await getLiveReturn(tx, booking.id))!
    const line = inspection.lines[0]

    for (const user of [viewer, editorUser]) {
      currentSession = sessionFor(user)
      expect(
        await run(saveReturnEquipmentFormAction, { bookingId: booking.id, suitcaseStatus: 'GOOD', [`asset.${line.id}.status`]: 'INCLUDED' }),
      ).toMatchObject({ result: { ok: false, error: 'forbidden' } })
      expect(await run(captureReturnSignatureFormAction, { bookingId: booking.id, role: 'ENGINEER', image: PNG })).toMatchObject({ result: { ok: false, error: 'forbidden' } })
      expect(await run(completeReturnFormAction, { bookingId: booking.id, confirm: 'true' })).toMatchObject({ result: { ok: false, error: 'forbidden' } })
    }

    // Nothing was recorded by either of them.
    expect((await getLiveReturn(tx, booking.id))!.lines.every((row) => row.status === 'NOT_APPLICABLE')).toBe(true)
    expect(await tx.signature.count({ where: { bookingId: booking.id, type: { in: ['RETURN_ENGINEER', 'RETURN_EDITOR'] } } })).toBe(0)
  })
})

describe('recording a return through the forms', () => {
  it('saves posted line fields and refuses a line that is not part of this return', async () => {
    const booking = await checkedOutBooking()
    currentSession = sessionFor(engineer)
    await run(startReturnFormAction, { bookingId: booking.id })
    const inspection = (await getLiveReturn(tx, booking.id))!
    const [first, second] = inspection.lines
    const accessory = inspection.lines.flatMap((line) => line.accessories)[0]

    expect(
      await run(saveReturnEquipmentFormAction, {
        bookingId: booking.id,
        suitcaseStatus: 'MINOR_DAMAGE',
        generalNotes: 'Corner scuffed',
        [`asset.${first.id}.status`]: 'INCLUDED',
        [`asset.${first.id}.notes`]: 'Fine',
        [`asset.${second.id}.status`]: 'DAMAGED',
        [`asset.${second.id}.notes`]: 'Bent bracket',
        [`accessory.${accessory.id}.status`]: 'INCLUDED',
        [`accessory.${accessory.id}.quantityReceived`]: '1',
      }),
    ).toMatchObject({ ok: true })

    const saved = (await getLiveReturn(tx, booking.id))!
    expect(saved.lines.find((line) => line.id === first.id)!.status).toBe('INCLUDED')
    expect(saved.lines.find((line) => line.id === second.id)!.status).toBe('DAMAGED')
    expect(saved.lines.find((line) => line.id === second.id)!.notes).toBe('Bent bracket')
    expect(saved.suitcaseStatus).toBe('MINOR_DAMAGE')
    expect(saved.generalNotes).toBe('Corner scuffed')

    expect(await run(saveReturnEquipmentFormAction, { bookingId: booking.id, suitcaseStatus: 'GOOD', ['asset.not-a-line.status']: 'INCLUDED' })).toMatchObject({
      result: { ok: false, error: 'rejected' },
    })
  })

  it('attributes the return signature to the session, whatever the form says', async () => {
    const booking = await checkedOutBooking()
    currentSession = sessionFor(engineer)
    await run(startReturnFormAction, { bookingId: booking.id })

    // The form carries no signer identity, and adding one changes nothing.
    expect(
      await run(captureReturnSignatureFormAction, {
        bookingId: booking.id,
        role: 'ENGINEER',
        image: PNG,
        signerUserId: admin.id,
        signerName: 'Someone Else',
      }),
    ).toMatchObject({ ok: true })

    const signature = await tx.signature.findFirstOrThrow({ where: { bookingId: booking.id, type: 'RETURN_ENGINEER', voidedAt: null }, select: { signerUserId: true, signerName: true, signerRole: true } })
    expect(signature.signerUserId).toBe(engineer.id)
    expect(signature.signerName).toBe(engineer.name)
    expect(signature.signerRole).toBe('ENGINEER')

    // The editor signature is attributed to the booking's editor, not the session.
    expect(await run(captureReturnSignatureFormAction, { bookingId: booking.id, role: 'EDITOR', image: PNG })).toMatchObject({ ok: true })
    const editorSignature = await tx.signature.findFirstOrThrow({ where: { bookingId: booking.id, type: 'RETURN_EDITOR', voidedAt: null }, select: { signerUserId: true, signerEditorProfileId: true } })
    expect(editorSignature.signerUserId).toBeNull()
    expect(editorSignature.signerEditorProfileId).not.toBeNull()

    // A malformed image is refused and stores nothing.
    expect(await run(captureReturnSignatureFormAction, { bookingId: booking.id, role: 'ENGINEER', image: 'data:image/jpeg;base64,/9j/4AAQ' })).toMatchObject({
      result: { ok: false, error: 'validation' },
    })
    expect(await run(captureReturnSignatureFormAction, { bookingId: booking.id, role: 'SOMEONE', image: PNG })).toMatchObject({ result: { ok: false, error: 'validation' } })
    expect(await tx.signature.count({ where: { bookingId: booking.id, type: 'RETURN_ENGINEER', voidedAt: null } })).toBe(1)
  })
})

describe('completing through the form', () => {
  it('completes once for an ADMIN and treats a second submit as a friendly refusal', async () => {
    const booking = await checkedOutBooking()
    currentSession = sessionFor(engineer)
    await run(startReturnFormAction, { bookingId: booking.id })

    const inspection = (await getLiveReturn(tx, booking.id))!
    const fields: Record<string, string> = { bookingId: booking.id, suitcaseStatus: 'GOOD' }
    for (const line of inspection.lines) fields[`asset.${line.id}.status`] = 'INCLUDED'
    for (const accessory of inspection.lines.flatMap((line) => line.accessories)) {
      fields[`accessory.${accessory.id}.status`] = 'INCLUDED'
      fields[`accessory.${accessory.id}.quantityReceived`] = '1'
    }
    await run(saveReturnEquipmentFormAction, fields)

    const checks: Record<string, string> = { bookingId: booking.id }
    for (const item of inspection.checklist) checks[`check.${item.id}.status`] = 'PASS'
    await run(saveReturnChecklistFormAction, checks)

    await run(captureReturnSignatureFormAction, { bookingId: booking.id, role: 'ENGINEER', image: PNG })

    // Completion needs the confirmation box.
    expect(await run(completeReturnFormAction, { bookingId: booking.id })).toMatchObject({ result: { ok: false, error: 'validation' } })

    currentSession = sessionFor(admin)
    expect(await run(completeReturnFormAction, { bookingId: booking.id, confirm: 'true' })).toMatchObject({ ok: true })

    const completed = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { status: true, actualReturnDate: true } })
    expect(completed.status).toBe('COMPLETED')
    expect(completed.actualReturnDate).not.toBeNull()

    // A second submit - a double click, a refresh, another tab - changes nothing.
    const again = await run(completeReturnFormAction, { bookingId: booking.id, confirm: 'true' })
    expect(again).toMatchObject({ result: { ok: false, error: 'rejected' } })
    expect(await tx.inspection.count({ where: { bookingId: booking.id, type: 'RETURN' } })).toBe(1)
    expect(await tx.inspection.count({ where: { bookingId: booking.id, type: 'RETURN', status: 'COMPLETED' } })).toBe(1)

    // And a VIEWER still cannot complete what is already done.
    currentSession = sessionFor(viewer)
    expect(await run(completeReturnFormAction, { bookingId: booking.id, confirm: 'true' })).toMatchObject({ result: { ok: false, error: 'forbidden' } })
  })

  it('refuses to complete when something handed over has no answer', async () => {
    const booking = await checkedOutBooking()
    currentSession = sessionFor(engineer)
    await run(startReturnFormAction, { bookingId: booking.id })
    await run(captureReturnSignatureFormAction, { bookingId: booking.id, role: 'ENGINEER', image: PNG })

    const result = await run(completeReturnFormAction, { bookingId: booking.id, confirm: 'true' })
    expect(result).toMatchObject({ result: { ok: false, error: 'rejected' } })
    expect((await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { status: true } })).status).toBe('RETURN_INSPECTION')
    expect(await tx.issue.count({ where: { bookingId: booking.id } })).toBe(0)
  })
})
