import { randomUUID } from 'node:crypto'

import { UserRole } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { returnPunctuality } from '@/lib/booking-rules'
import type { Actor } from '@/server/auth/session'
import { getBookingActivity, getBookingDetailForActor } from '@/server/dal/bookings.dal'
import { getHandoverForReturn, getLiveReturn, getReturnSummary } from '@/server/dal/return.dal'
import type { Db } from '@/server/db/prisma'
import { addAccessory, createAsset } from '@/server/services/assets.service'
import { createBooking, markReadyForHandover } from '@/server/services/bookings.service'
import { createEditor } from '@/server/services/editors.service'
import { captureSignature, completeHandover, saveChecklistVerification, saveEquipmentVerification, startHandover } from '@/server/services/handover.service'
import { addKitAsset, addKitSoftware, createKit } from '@/server/services/kits.service'
import { getLiveHandover } from '@/server/dal/handover.dal'
import {
  bookingReturnBlockers,
  captureReturnSignature,
  completeReturn,
  kitStatusAfterReturn,
  loadReturnWorkspace,
  returnVerdict,
  saveReturnChecklist,
  saveReturnEquipment,
  startReturn,
} from '@/server/services/return.service'
import { memorySignatureStore } from '@/server/storage/signature-store'

import { actorFor, createTestUser, testDb, type TestUser, withRollback } from '../helpers/db'

/**
 * The return inspection against the real database, inside rolled-back
 * transactions.
 *
 * Every test builds a kit (two required items with an accessory each, one
 * optional), an external editor, a booking, and then takes it all the way
 * through a completed handover, so the return has a real historical document
 * to be measured against. Signature images go to an in-memory store, so
 * nothing touches the disk and the rollback leaves no inspection, line,
 * signature, issue or number behind.
 *
 * PostgreSQL aborts a transaction after a failed statement, so any test that
 * provokes a database refusal does it as its final step.
 */

const tag = () => randomUUID().slice(0, 8).toUpperCase()
/** A 1×1 PNG - what the pad sends, minus the drawing. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const local = (day: number, hour: number) => `2042-06-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`
const store = memorySignatureStore()

interface Fixtures {
  admin: TestUser
  actor: Actor
  engineerUser: TestUser
  engineer: Actor
  engineerProfileId: string
  categoryId: string
  softwareId: string
  accessoryTypeId: string
}

async function fixtures(tx: Db): Promise<Fixtures> {
  const admin = await createTestUser(tx, { role: UserRole.ADMIN })
  const engineerUser = await createTestUser(tx, { role: UserRole.ENGINEER })
  const [engineer, category, software, accessoryType] = await Promise.all([
    tx.engineerProfile.findFirstOrThrow({ select: { id: true } }),
    tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' }, select: { id: true } }),
    tx.softwareApplication.findFirstOrThrow({ where: { deletedAt: null, isActive: true }, select: { id: true } }),
    tx.accessoryType.findFirstOrThrow({ where: { code: 'POWER_CABLE' }, select: { id: true } }),
  ])
  return {
    admin,
    actor: actorFor(admin),
    engineerUser,
    engineer: actorFor(engineerUser),
    engineerProfileId: engineer.id,
    categoryId: category.id,
    softwareId: software.id,
    accessoryTypeId: accessoryType.id,
  }
}

interface Scenario {
  bookingId: string
  bookingNumber: string
  kitId: string
  kitCode: string
  editorId: string
  editorName: string
  assets: Array<{ id: string; assetCode: string; required: boolean; kitAssetId: string }>
}

/**
 * A booking on a fresh kit, taken to whatever stage the test needs.
 * `expectedReturn` in the past makes a late return; `editorType: 'INTERNAL'`
 * gives the editor an account so their own-booking view can be checked.
 */
async function scenario(
  tx: Db,
  fx: Fixtures,
  options: { stage?: 'reserved' | 'ready' | 'checked-out'; expectedReturn?: string; editorType?: 'EXTERNAL' | 'INTERNAL'; editorUserId?: string; optionalDamagedAtHandover?: boolean } = {},
): Promise<Scenario> {
  const t = tag()
  const kit = await createKit(tx, fx.actor, {
    kitCode: `RET-${t}`,
    name: `Return kit ${t}`,
    admBarcode: `ADM-RETKIT-${t}`,
    description: undefined,
    location: undefined,
    notes: undefined,
    suitcaseStatus: 'GOOD',
    status: 'AVAILABLE',
  })

  const assets: Scenario['assets'] = []
  for (const [index, required] of [true, true, false].entries()) {
    const asset = await createAsset(tx, fx.actor, {
      name: `Return asset ${t}-${index}`,
      categoryId: fx.categoryId,
      manufacturer: 'Testco',
      model: `R-${index}`,
      serialNumber: `SN-RET-${t}-${index}`,
      admBarcode: `ADM-RET-${t}-${index}`,
      location: undefined,
      notes: undefined,
      status: 'AVAILABLE',
    })
    if (required) {
      await addAccessory(tx, fx.actor, asset.id, {
        accessoryTypeId: fx.accessoryTypeId,
        label: `Adapter ${index}`,
        quantity: 1,
        serialNumber: undefined,
        admBarcode: undefined,
        isRequired: true,
        notes: undefined,
      })
    }
    const membership = await addKitAsset(tx, fx.actor, kit.id, { assetId: asset.id, slotLabel: `Slot ${index + 1}`, isRequired: required })
    assets.push({ id: asset.id, assetCode: asset.assetCode, required, kitAssetId: membership.kitAssetId })
  }
  await addKitSoftware(tx, fx.actor, kit.id, { softwareApplicationId: fx.softwareId, isRequired: true })

  const editorName = `Return Editor ${t}`
  const editor = await createEditor(tx, fx.actor, {
    fullName: editorName,
    staffId: options.editorType === 'INTERNAL' ? `EDT-${t}` : undefined,
    email: undefined,
    contactNumber: '+971 50 777 8888',
    department: undefined,
    company: options.editorType === 'INTERNAL' ? undefined : 'Freelance',
    type: options.editorType ?? 'EXTERNAL',
    notes: undefined,
    userId: options.editorUserId,
    isActive: true,
  })

  const booking = await createBooking(tx, fx.actor, {
    editorId: editor.id,
    kitId: kit.id,
    engineerId: fx.engineerProfileId,
    bookingStart: local(10, 9),
    bookingEnd: local(14, 18),
    collectionDate: undefined,
    expectedReturnDate: options.expectedReturn ?? local(14, 17),
    purpose: 'Return test',
    notes: undefined,
    intent: 'reserve',
  })

  const result: Scenario = {
    bookingId: booking.id,
    bookingNumber: booking.bookingNumber,
    kitId: kit.id,
    kitCode: kit.kitCode,
    editorId: editor.id,
    editorName,
    assets,
  }
  const stage = options.stage ?? 'checked-out'
  if (stage === 'reserved') return result

  await markReadyForHandover(tx, fx.actor, booking.id)
  if (stage === 'ready') return result

  // A complete handover: everything recorded, both signatures, checked out.
  await startHandover(tx, fx.engineer, booking.id)
  const inspection = (await getLiveHandover(tx, booking.id))!
  await saveEquipmentVerification(tx, fx.engineer, booking.id, {
    suitcaseStatus: 'GOOD',
    generalNotes: 'All present at handover',
    assets: inspection.lines.map((line) => ({
      id: line.id,
      // An optional item can be recorded damaged at handover and still complete;
      // it then never went out, which the return has to respect.
      status: options.optionalDamagedAtHandover && !line.isRequired ? ('DAMAGED' as const) : ('INCLUDED' as const),
      notes: undefined,
    })),
    accessories: inspection.lines.flatMap((line) =>
      line.accessories.map((accessory) => ({ id: accessory.id, status: 'INCLUDED' as const, quantityReceived: accessory.quantityExpected, notes: undefined })),
    ),
  })
  await saveChecklistVerification(tx, fx.engineer, booking.id, {
    checks: inspection.checklist.map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })),
    software: inspection.software.map((check) => ({ id: check.id, status: 'INSTALLED' as const, installedVersion: '2025', notes: undefined })),
  })
  await captureSignature(tx, fx.engineer, booking.id, 'EDITOR', PNG, store)
  await captureSignature(tx, fx.engineer, booking.id, 'ENGINEER', PNG, store)
  await completeHandover(tx, fx.engineer, booking.id)
  return result
}

/** Records every handed-over line as returned, and every return check as passed. */
async function accountForEverything(tx: Db, actor: Actor, bookingId: string, overrides: Record<string, 'INCLUDED' | 'DAMAGED' | 'MISSING'> = {}) {
  const inspection = (await getLiveReturn(tx, bookingId))!
  await saveReturnEquipment(tx, actor, bookingId, {
    suitcaseStatus: 'GOOD',
    generalNotes: 'Returned complete',
    assets: inspection.lines.map((line) => ({
      id: line.id,
      status: line.wasHandedOver ? (overrides[line.assetCodeSnapshot] ?? 'INCLUDED') : ('NOT_APPLICABLE' as const),
      notes: undefined,
    })),
    accessories: inspection.lines.flatMap((line) =>
      line.accessories.map((accessory) => ({
        id: accessory.id,
        status: accessory.wasHandedOver ? ('INCLUDED' as const) : ('NOT_APPLICABLE' as const),
        quantityReceived: accessory.wasHandedOver ? accessory.quantityExpected : undefined,
        notes: undefined,
      })),
    ),
  })
  const withChecks = (await getLiveReturn(tx, bookingId))!
  if (withChecks.checklist.length > 0) {
    await saveReturnChecklist(tx, actor, bookingId, { checks: withChecks.checklist.map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })) })
  }
  return inspection
}

let countersBefore: Array<{ scope: string; current: number }>

beforeAll(async () => {
  countersBefore = await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })
})

afterAll(async () => {
  // Nothing this suite wrote may survive: counters included.
  expect(await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })).toEqual(countersBefore)
  expect(await testDb.kit.count({ where: { kitCode: { startsWith: 'RET-' } } })).toBe(0)
  expect(await testDb.inspection.count({ where: { booking: { kit: { kitCode: { startsWith: 'RET-' } } } } })).toBe(0)
  expect(await testDb.signature.count({ where: { booking: { kit: { kitCode: { startsWith: 'RET-' } } } } })).toBe(0)
  expect(await testDb.issue.count({ where: { kit: { kitCode: { startsWith: 'RET-' } } } })).toBe(0)
  expect(await testDb.bookingChecklistItem.count({ where: { booking: { kit: { kitCode: { startsWith: 'RET-' } } } } })).toBe(0)
  await testDb.$disconnect()
})

describe('starting a return inspection', () => {
  it('copies the handover document once and moves the booking to return inspection', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx)

      const first = await startReturn(tx, fx.engineer, s.bookingId)
      expect(first.created).toBe(true)

      const booking = await tx.booking.findUniqueOrThrow({ where: { id: s.bookingId }, select: { status: true, actualReturnDate: true } })
      expect(booking.status).toBe('RETURN_INSPECTION')
      expect(booking.actualReturnDate).toBeNull()

      const inspection = (await getLiveReturn(tx, s.bookingId))!
      expect(inspection.lines).toHaveLength(3)
      // Everything that went out starts unaccounted for.
      expect(inspection.lines.every((line) => line.status === 'NOT_APPLICABLE')).toBe(true)
      expect(inspection.lines.filter((line) => line.wasHandedOver)).toHaveLength(3)
      expect(inspection.lines.flatMap((line) => line.accessories)).toHaveLength(2)
      expect(inspection.lines.flatMap((line) => line.accessories).every((accessory) => accessory.wasHandedOver && accessory.quantityExpected === 1)).toBe(true)
      // The handover's own condition per line is carried through for context.
      expect(inspection.lines.every((line) => line.handoverStatus === 'INCLUDED')).toBe(true)

      // Pressing Start again reuses the same document, and a reload never copies.
      const second = await startReturn(tx, fx.engineer, s.bookingId)
      expect(second).toEqual({ inspectionId: first.inspectionId, created: false })
      expect(await tx.inspection.count({ where: { bookingId: s.bookingId, type: 'RETURN' } })).toBe(1)
      expect(await tx.assetInspection.count({ where: { inspectionId: first.inspectionId } })).toBe(3)

      const activity = await getBookingActivity(tx, s.bookingId)
      expect(activity.some((event) => event.kind === 'return' && /return inspection started/i.test(event.title))).toBe(true)
      expect(activity.some((event) => /Checked out → Return inspection/.test(event.title))).toBe(true)
    })
  })

  it('expects back what actually went out, not what the kit holds today', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx)
      const removed = s.assets[1]

      // The kit's composition is frozen while it is out (Phase 5), so this
      // writes the membership rows directly - the state the kit would be in if
      // an administrator changed it later, or through a data fix. The point is
      // that the return reads the handover document, not these rows.
      await tx.kitAsset.update({ where: { id: removed.kitAssetId }, data: { removedAt: new Date() } })
      const late = await createAsset(tx, fx.actor, {
        name: 'Added after handover',
        categoryId: fx.categoryId,
        manufacturer: 'Testco',
        model: 'LATE',
        serialNumber: `SN-LATE-${tag()}`,
        admBarcode: `ADM-LATE-${tag()}`,
        location: undefined,
        notes: undefined,
        status: 'AVAILABLE',
      })
      await tx.kitAsset.create({ data: { kitId: s.kitId, assetId: late.id, slotLabel: 'Slot 9', isRequired: true, sortOrder: 9 } })

      await startReturn(tx, fx.engineer, s.bookingId)
      const inspection = (await getLiveReturn(tx, s.bookingId))!

      const codes = inspection.lines.map((line) => line.assetCodeSnapshot)
      expect(codes).toContain(removed.assetCode)
      expect(codes).not.toContain(late.assetCode)
      expect(inspection.lines).toHaveLength(3)

      // The removed item is still owed, and the page says so.
      const stillOwed = inspection.lines.find((line) => line.assetCodeSnapshot === removed.assetCode)!
      expect(stillOwed.wasHandedOver).toBe(true)
      expect(stillOwed.current.stillInKit).toBe(false)
    })
  })

  it('leaves an item that never went out off the list of things to account for', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx, { optionalDamagedAtHandover: true })

      await startReturn(tx, fx.engineer, s.bookingId)
      const inspection = (await getLiveReturn(tx, s.bookingId))!

      const optional = inspection.lines.find((line) => line.assetCodeSnapshot === s.assets[2].assetCode)!
      expect(optional.handoverStatus).toBe('DAMAGED')
      expect(optional.wasHandedOver).toBe(false)
      expect(inspection.lines.filter((line) => line.wasHandedOver)).toHaveLength(2)

      // And it is not one of the answers completion waits for.
      const verdict = returnVerdict(inspection)
      expect(verdict.blockers.some((blocker) => blocker.reason.includes(optional.assetCodeSnapshot))).toBe(false)
    })
  })
})

describe('return eligibility', () => {
  it('refuses a booking that is not out', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)

      const draft = await createBooking(tx, fx.actor, {
        editorId: (await createEditor(tx, fx.actor, { fullName: `Draft Editor ${tag()}`, staffId: undefined, email: undefined, contactNumber: '+971 50 1 2', department: undefined, company: 'Freelance', type: 'EXTERNAL', notes: undefined, userId: undefined, isActive: true })).id,
        kitId: (await createKit(tx, fx.actor, { kitCode: `RET-${tag()}`, name: 'Draft kit', admBarcode: undefined, description: undefined, location: undefined, notes: undefined, suitcaseStatus: 'GOOD', status: 'AVAILABLE' })).id,
        engineerId: fx.engineerProfileId,
        bookingStart: local(20, 9),
        bookingEnd: local(22, 18),
        collectionDate: undefined,
        expectedReturnDate: local(22, 17),
        purpose: undefined,
        notes: undefined,
        intent: 'draft',
      })
      await expect(startReturn(tx, fx.engineer, draft.id)).rejects.toThrow(/only a kit that is out can be returned/i)

      const reserved = await scenario(tx, fx, { stage: 'reserved' })
      await expect(startReturn(tx, fx.engineer, reserved.bookingId)).rejects.toThrow(/only a kit that is out can be returned/i)

      const ready = await scenario(tx, fx, { stage: 'ready' })
      await expect(startReturn(tx, fx.engineer, ready.bookingId)).rejects.toThrow(/only a kit that is out can be returned/i)

      expect(await tx.inspection.count({ where: { type: 'RETURN' } })).toBe(0)
    })
  })

  it('refuses a booking whose handover is missing or unfinished', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      // Out with no handover at all: nothing to measure a return against.
      const bare = await scenario(tx, fx, { stage: 'ready' })
      await tx.booking.update({ where: { id: bare.bookingId }, data: { status: 'CHECKED_OUT' } })
      await expect(startReturn(tx, fx.engineer, bare.bookingId)).rejects.toThrow(/no handover on record/i)

      // Out with a handover that was started but never finished.
      const s = await scenario(tx, fx, { stage: 'ready' })
      await startHandover(tx, fx.engineer, s.bookingId)
      await tx.booking.update({ where: { id: s.bookingId }, data: { status: 'CHECKED_OUT' } })
      await expect(startReturn(tx, fx.engineer, s.bookingId)).rejects.toThrow(/never completed/i)

      const booking = (await getBookingDetailForActor(tx, fx.actor, s.bookingId))!
      expect(booking.status).toBe('CHECKED_OUT')
    })
  })

  it('refuses a second return once the booking is completed, and an unknown booking', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx)

      await startReturn(tx, fx.engineer, s.bookingId)
      await accountForEverything(tx, fx.engineer, s.bookingId)
      await captureReturnSignature(tx, fx.engineer, s.bookingId, 'ENGINEER', PNG, store)
      await completeReturn(tx, fx.engineer, s.bookingId)

      await expect(startReturn(tx, fx.engineer, s.bookingId)).rejects.toThrow(/already been returned/i)
      await expect(completeReturn(tx, fx.engineer, s.bookingId)).rejects.toThrow(/already been returned/i)
      expect(await tx.inspection.count({ where: { bookingId: s.bookingId, type: 'RETURN' } })).toBe(1)

      await expect(startReturn(tx, fx.engineer, 'no-such-booking')).rejects.toThrow(/not found/i)
    })
  })

  it('is refused while the kit is out and overdue only because it has no handover, not because it is late', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx, { expectedReturn: local(11, 9) })

      // OVERDUE is derived at read time; the persisted status may also be set.
      await tx.booking.update({ where: { id: s.bookingId }, data: { status: 'OVERDUE' } })
      const started = await startReturn(tx, fx.engineer, s.bookingId)
      expect(started.created).toBe(true)

      const activity = await getBookingActivity(tx, s.bookingId)
      expect(activity.some((event) => /Overdue → Return inspection/.test(event.title))).toBe(true)
    })
  })
})

describe('what completion insists on', () => {
  it('refuses to complete while a handed-over item has no answer, and while the engineer has not signed', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx)
      await startReturn(tx, fx.engineer, s.bookingId)

      await expect(completeReturn(tx, fx.engineer, s.bookingId)).rejects.toThrow(/no return answer/i)

      // Answer two of three: still refused, and it names what is outstanding.
      const inspection = (await getLiveReturn(tx, s.bookingId))!
      await saveReturnEquipment(tx, fx.engineer, s.bookingId, {
        suitcaseStatus: 'GOOD',
        generalNotes: undefined,
        assets: inspection.lines.slice(0, 2).map((line) => ({ id: line.id, status: 'INCLUDED' as const, notes: undefined })),
        accessories: [],
      })
      const partial = returnVerdict((await getLiveReturn(tx, s.bookingId))!)
      expect(partial.unanswered).toBe(1)
      expect(partial.blockers.some((blocker) => blocker.reason.includes(inspection.lines[2].assetCodeSnapshot))).toBe(true)

      await accountForEverything(tx, fx.engineer, s.bookingId)
      await expect(completeReturn(tx, fx.engineer, s.bookingId)).rejects.toThrow(/engineer receiving the kit has not signed/i)

      // Nothing has moved.
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: s.bookingId }, select: { status: true, actualReturnDate: true } })
      expect(booking.status).toBe('RETURN_INSPECTION')
      expect(booking.actualReturnDate).toBeNull()
    })
  })

  it('refuses to complete while a required return check is unanswered or failed, and treats the editor signature as optional', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx)
      await startReturn(tx, fx.engineer, s.bookingId)

      const inspection = (await getLiveReturn(tx, s.bookingId))!
      await saveReturnEquipment(tx, fx.engineer, s.bookingId, {
        suitcaseStatus: 'GOOD',
        generalNotes: undefined,
        assets: inspection.lines.map((line) => ({ id: line.id, status: 'INCLUDED' as const, notes: undefined })),
        accessories: inspection.lines.flatMap((line) => line.accessories.map((accessory) => ({ id: accessory.id, status: 'INCLUDED' as const, quantityReceived: 1, notes: undefined }))),
      })
      await captureReturnSignature(tx, fx.engineer, s.bookingId, 'ENGINEER', PNG, store)

      const required = inspection.checklist.filter((item) => item.isRequired)
      if (required.length > 0) {
        await expect(completeReturn(tx, fx.engineer, s.bookingId)).rejects.toThrow(/required return check/i)
        // A failed required check is recorded and warned about, not a blocker:
        // the kit is back either way and the problem is on the document.
        await saveReturnChecklist(tx, fx.engineer, s.bookingId, {
          checks: inspection.checklist.map((item, index) => ({ id: item.id, status: index === 0 ? ('FAIL' as const) : ('PASS' as const), notes: index === 0 ? 'Case scratched' : undefined })),
        })
        const verdict = returnVerdict((await getLiveReturn(tx, s.bookingId))!)
        expect(verdict.warnings.some((warning) => /failed/i.test(warning))).toBe(true)
        expect(verdict.complete).toBe(true)
      }

      // The editor never signed, and that does not stand in the way.
      const workspace = (await loadReturnWorkspace(tx, fx.engineer, s.bookingId))!
      expect(workspace.verdict?.warnings.some((warning) => /editor has not signed/i.test(warning))).toBe(true)
      expect(workspace.canComplete).toBe(true)
      await expect(completeReturn(tx, fx.engineer, s.bookingId)).resolves.toMatchObject({ bookingNumber: s.bookingNumber })
    })
  })

  it('refuses a line id that does not belong to this return', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx)
      await startReturn(tx, fx.engineer, s.bookingId)

      await expect(
        saveReturnEquipment(tx, fx.engineer, s.bookingId, { suitcaseStatus: 'GOOD', generalNotes: undefined, assets: [{ id: 'not-a-line', status: 'INCLUDED', notes: undefined }], accessories: [] }),
      ).rejects.toThrow(/equipment list changed/i)
    })
  })
})

describe('a clean return', () => {
  it('completes the booking, restores the equipment and frees the kit', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx)
      const before = await tx.booking.findUniqueOrThrow({ where: { id: s.bookingId }, select: { collectionDate: true, expectedReturnDate: true } })

      await startReturn(tx, fx.engineer, s.bookingId)
      await accountForEverything(tx, fx.engineer, s.bookingId)
      await captureReturnSignature(tx, fx.engineer, s.bookingId, 'EDITOR', PNG, store)
      await captureReturnSignature(tx, fx.engineer, s.bookingId, 'ENGINEER', PNG, store)

      const completed = await completeReturn(tx, fx.engineer, s.bookingId)
      expect(completed.kitStatus).toBe('AVAILABLE')
      expect(completed.issueNumbers).toEqual([])

      const booking = await tx.booking.findUniqueOrThrow({ where: { id: s.bookingId }, select: { status: true, collectionDate: true, expectedReturnDate: true, actualReturnDate: true } })
      expect(booking.status).toBe('COMPLETED')
      // The server clock decides the actual return; the other two are untouched.
      expect(booking.actualReturnDate).toBeInstanceOf(Date)
      expect(booking.actualReturnDate!.getTime()).toBe(completed.returnedAt.getTime())
      expect(booking.collectionDate?.toISOString()).toBe(before.collectionDate?.toISOString())
      expect(booking.expectedReturnDate.toISOString()).toBe(before.expectedReturnDate.toISOString())

      // Every item is back on the shelf, with a status log to say why.
      const assets = await tx.asset.findMany({ where: { id: { in: s.assets.map((asset) => asset.id) } }, select: { assetCode: true, status: true } })
      expect(assets.every((asset) => asset.status === 'AVAILABLE')).toBe(true)
      const logs = await tx.assetStatusLog.findMany({ where: { bookingId: s.bookingId, toStatus: 'AVAILABLE' }, select: { reason: true } })
      expect(logs).toHaveLength(3)
      expect(logs.every((log) => log.reason?.includes(s.bookingNumber))).toBe(true)

      expect((await tx.kit.findUniqueOrThrow({ where: { id: s.kitId }, select: { status: true } })).status).toBe('AVAILABLE')
      expect(await tx.issue.count({ where: { bookingId: s.bookingId } })).toBe(0)

      // The return document is frozen and complete.
      const inspection = await tx.inspection.findFirstOrThrow({ where: { bookingId: s.bookingId, type: 'RETURN' }, select: { status: true, lockedAt: true, documentSnapshot: true, completedById: true } })
      expect(inspection.status).toBe('COMPLETED')
      expect(inspection.lockedAt).not.toBeNull()
      expect(inspection.completedById).toBe(fx.engineerUser.id)
      expect(JSON.stringify(inspection.documentSnapshot)).toContain(s.assets[0].assetCode)

      // The handover document and its signatures are exactly as they were.
      const handover = (await getHandoverForReturn(tx, s.bookingId))!
      expect(handover.completed).toBe(true)
      expect(handover.signatures).toHaveLength(2)
      const handoverSignatures = await tx.signature.findMany({ where: { bookingId: s.bookingId, type: { in: ['HANDOVER_EDITOR', 'HANDOVER_ENGINEER'] } }, select: { voidedAt: true } })
      expect(handoverSignatures).toHaveLength(2)
      expect(handoverSignatures.every((signature) => signature.voidedAt === null)).toBe(true)
      // And the return added its own two, which is four live signatures in all.
      expect(await tx.signature.count({ where: { bookingId: s.bookingId, voidedAt: null } })).toBe(4)

      const activity = await getBookingActivity(tx, s.bookingId)
      const titles = activity.map((event) => event.title)
      expect(titles.some((title) => /returned by/i.test(title))).toBe(true)
      expect(titles.some((title) => /Return inspection → Completed/.test(title))).toBe(true)
      // Newest first, so the completion is above the start.
      expect(titles.findIndex((title) => /Return inspection → Completed/.test(title))).toBeLessThan(titles.findIndex((title) => /return inspection started/i.test(title)))
    })
  })

  it('records the return as on time, early or late from the two timestamps alone', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx)

      // Move the collection and expected return into the past - the schedule
      // check constraint only requires the return not to precede collection -
      // so "now" is genuinely after the kit was due back.
      const day = 24 * 60 * 60 * 1000
      await tx.booking.update({
        where: { id: s.bookingId },
        data: { collectionDate: new Date(Date.now() - 3 * day), expectedReturnDate: new Date(Date.now() - day) },
      })

      await startReturn(tx, fx.engineer, s.bookingId)
      await accountForEverything(tx, fx.engineer, s.bookingId)
      await captureReturnSignature(tx, fx.engineer, s.bookingId, 'ENGINEER', PNG, store)
      const completed = await completeReturn(tx, fx.engineer, s.bookingId)

      const booking = await tx.booking.findUniqueOrThrow({ where: { id: s.bookingId }, select: { status: true, expectedReturnDate: true, actualReturnDate: true } })
      // Completed, so no longer operationally overdue...
      expect(booking.status).toBe('COMPLETED')
      // ...but the history still says it came back late.
      expect(returnPunctuality(booking.expectedReturnDate, booking.actualReturnDate!)).toBe('late')
      expect(completed.punctuality).toBe('late')

      const activity = await getBookingActivity(tx, s.bookingId)
      expect(activity.some((event) => /minutes late/i.test(event.title))).toBe(true)
    })
  })
})

describe('a return with problems', () => {
  it('records missing and damaged equipment, raises issues and keeps the kit out of service', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx)
      const [damagedAsset, missingAsset, healthyAsset] = s.assets

      await startReturn(tx, fx.engineer, s.bookingId)
      const inspection = (await getLiveReturn(tx, s.bookingId))!
      await saveReturnEquipment(tx, fx.engineer, s.bookingId, {
        suitcaseStatus: 'MINOR_DAMAGE',
        generalNotes: 'Monitor casing scratched; mouse missing',
        assets: inspection.lines.map((line) => ({
          id: line.id,
          status: line.assetCodeSnapshot === damagedAsset.assetCode ? ('DAMAGED' as const) : line.assetCodeSnapshot === missingAsset.assetCode ? ('MISSING' as const) : ('INCLUDED' as const),
          notes: line.assetCodeSnapshot === damagedAsset.assetCode ? 'Lid cracked' : undefined,
        })),
        // The adapter that went out with the damaged item did not come back.
        accessories: inspection.lines.flatMap((line) =>
          line.accessories.map((accessory) => {
            const lost = line.assetCodeSnapshot === damagedAsset.assetCode
            return {
              id: accessory.id,
              status: lost ? ('MISSING' as const) : ('INCLUDED' as const),
              quantityReceived: lost ? 0 : accessory.quantityExpected,
              notes: lost ? 'Adapter not in the case' : undefined,
            }
          }),
        ),
      })
      const withChecks = (await getLiveReturn(tx, s.bookingId))!
      if (withChecks.checklist.length > 0) {
        await saveReturnChecklist(tx, fx.engineer, s.bookingId, { checks: withChecks.checklist.map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })) })
      }

      // Problems are stated but do not block: the kit is back and the booking
      // has to close with the truth on it.
      const verdict = returnVerdict((await getLiveReturn(tx, s.bookingId))!)
      expect(verdict.warnings.some((warning) => warning.includes(missingAsset.assetCode))).toBe(true)
      expect(verdict.warnings.some((warning) => warning.includes(damagedAsset.assetCode))).toBe(true)

      await captureReturnSignature(tx, fx.engineer, s.bookingId, 'ENGINEER', PNG, store)
      const completed = await completeReturn(tx, fx.engineer, s.bookingId)

      // Each asset carries the state its condition implies.
      const assets = await tx.asset.findMany({ where: { id: { in: s.assets.map((asset) => asset.id) } }, select: { id: true, assetCode: true, status: true } })
      expect(assets.find((asset) => asset.assetCode === damagedAsset.assetCode)!.status).toBe('DAMAGED')
      expect(assets.find((asset) => asset.assetCode === missingAsset.assetCode)!.status).toBe('MISSING')
      expect(assets.find((asset) => asset.assetCode === healthyAsset.assetCode)!.status).toBe('AVAILABLE')

      // An issue per problem, through the existing issue model, numbered.
      const issues = await tx.issue.findMany({ where: { bookingId: s.bookingId }, select: { issueNumber: true, type: true, severity: true, status: true, title: true, assetId: true, accessoryId: true, inspectionId: true, kitId: true } })
      expect(issues).toHaveLength(3)
      expect(completed.issueNumbers).toHaveLength(3)
      expect(issues.every((issue) => issue.issueNumber.startsWith('ISS-'))).toBe(true)
      expect(issues.every((issue) => issue.status === 'OPEN')).toBe(true)
      expect(issues.every((issue) => issue.kitId === s.kitId)).toBe(true)
      expect(issues.every((issue) => issue.inspectionId !== null)).toBe(true)
      const missingIssue = issues.find((issue) => issue.assetId === missingAsset.id && issue.accessoryId === null)!
      expect(missingIssue.type).toBe('MISSING')
      expect(missingIssue.severity).toBe('HIGH')
      const damagedIssue = issues.find((issue) => issue.assetId === damagedAsset.id && issue.accessoryId === null)!
      expect(damagedIssue.type).toBe('DAMAGED')
      expect(damagedIssue.severity).toBe('MEDIUM')
      const accessoryIssue = issues.find((issue) => issue.accessoryId !== null)!
      expect(accessoryIssue.type).toBe('MISSING')
      expect(accessoryIssue.severity).toBe('LOW')

      // The kit does not become available just because the booking closed.
      expect(completed.kitStatus).toBe('DAMAGED')
      expect((await tx.kit.findUniqueOrThrow({ where: { id: s.kitId }, select: { status: true } })).status).toBe('DAMAGED')

      // Accessory master data is untouched by a return problem.
      const accessory = await tx.accessory.findUniqueOrThrow({ where: { id: accessoryIssue.accessoryId! }, select: { deletedAt: true, isRequired: true, quantity: true } })
      expect(accessory).toEqual({ deletedAt: null, isRequired: true, quantity: 1 })

      const activity = await getBookingActivity(tx, s.bookingId)
      expect(activity.some((event) => /not returned/i.test(event.title))).toBe(true)
      expect(activity.some((event) => /returned damaged/i.test(event.title))).toBe(true)
      expect(activity.some((event) => /unavailable after/i.test(event.title) || /available again/i.test(event.title))).toBe(false)
      // The kit event is recorded against the kit, not the booking.
      expect(await tx.auditLog.count({ where: { entityType: 'Kit', entityId: s.kitId, action: 'KIT_STATUS_CHANGED' } })).toBeGreaterThan(0)
      expect(await tx.auditLog.count({ where: { entityType: 'Asset', entityId: damagedAsset.id, action: 'ASSET_STATUS_CHANGED' } })).toBeGreaterThan(0)

      const summary = (await getReturnSummary(tx, s.bookingId))!
      expect(summary.damagedCount).toBe(1)
      expect(summary.missingCount).toBe(1)
      expect(summary.returnedCount).toBe(1)
      expect(summary.accessoryProblemCount).toBe(1)
      expect(summary.issues).toHaveLength(3)
      expect(summary.generalNotes).toContain('mouse missing')
      // Nothing about where a signature is stored ever leaves the DAL.
      expect(JSON.stringify(summary)).not.toMatch(/imagePath|imageHash|passwordHash/)
    })
  })

  it('keeps the kit in maintenance when a returned item is already under repair', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx)

      await startReturn(tx, fx.engineer, s.bookingId)
      await accountForEverything(tx, fx.engineer, s.bookingId)
      await captureReturnSignature(tx, fx.engineer, s.bookingId, 'ENGINEER', PNG, store)

      // A repair is opened on a required item while the return is being recorded.
      await tx.maintenanceRecord.create({
        data: {
          maintenanceNumber: `MNT-TEST-${tag()}`,
          assetId: s.assets[0].id,
          type: 'REPAIR',
          status: 'IN_PROGRESS',
          title: 'Bench repair',
          description: 'Opened during the return',
          startedAt: new Date(),
          createdById: fx.admin.id,
        },
      })

      const completed = await completeReturn(tx, fx.engineer, s.bookingId)
      expect(completed.kitStatus).toBe('MAINTENANCE')
      expect((await tx.kit.findUniqueOrThrow({ where: { id: s.kitId }, select: { status: true } })).status).toBe('MAINTENANCE')
      // The booking still closed: the kit's state is a separate question.
      expect((await tx.booking.findUniqueOrThrow({ where: { id: s.bookingId }, select: { status: true } })).status).toBe('COMPLETED')
    })
  })
})

describe('safety of the completing transaction', () => {
  it('leaves everything as it was when completion is refused at the last moment', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx)

      await startReturn(tx, fx.engineer, s.bookingId)
      await accountForEverything(tx, fx.engineer, s.bookingId)
      await captureReturnSignature(tx, fx.engineer, s.bookingId, 'ENGINEER', PNG, store)

      // The engineer's signature is withdrawn after everything else was in place.
      await tx.signature.updateMany({ where: { bookingId: s.bookingId, type: 'RETURN_ENGINEER' }, data: { voidedAt: new Date(), voidedById: fx.engineerUser.id, voidReason: 'Withdrawn' } })

      await expect(completeReturn(tx, fx.engineer, s.bookingId)).rejects.toThrow(/has not signed/i)

      // No partial completion: not the booking, not the assets, not the kit.
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: s.bookingId }, select: { status: true, actualReturnDate: true } })
      expect(booking.status).toBe('RETURN_INSPECTION')
      expect(booking.actualReturnDate).toBeNull()
      const assets = await tx.asset.findMany({ where: { id: { in: s.assets.map((asset) => asset.id) } }, select: { status: true } })
      expect(assets.every((asset) => asset.status === 'CHECKED_OUT')).toBe(true)
      expect((await tx.kit.findUniqueOrThrow({ where: { id: s.kitId }, select: { status: true } })).status).toBe('CHECKED_OUT')
      const inspection = await tx.inspection.findFirstOrThrow({ where: { bookingId: s.bookingId, type: 'RETURN' }, select: { status: true, lockedAt: true, documentSnapshot: true } })
      expect(inspection.lockedAt).toBeNull()
      expect(inspection.documentSnapshot).toBeNull()
      expect(await tx.issue.count({ where: { bookingId: s.bookingId } })).toBe(0)
    })
  })

  it('refuses to change a completed return, and the database refuses too', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx)

      await startReturn(tx, fx.engineer, s.bookingId)
      await accountForEverything(tx, fx.engineer, s.bookingId)
      await captureReturnSignature(tx, fx.engineer, s.bookingId, 'ENGINEER', PNG, store)
      await completeReturn(tx, fx.engineer, s.bookingId)

      const inspection = await tx.inspection.findFirstOrThrow({ where: { bookingId: s.bookingId, type: 'RETURN' }, select: { id: true } })
      await expect(
        saveReturnEquipment(tx, fx.engineer, s.bookingId, { suitcaseStatus: 'GOOD', generalNotes: 'after the fact', assets: [], accessories: [] }),
      ).rejects.toThrow(/already been returned/i)
      await expect(captureReturnSignature(tx, fx.engineer, s.bookingId, 'ENGINEER', PNG, store)).rejects.toThrow(/already been returned/i)

      // Last: the trigger aborts the transaction, so nothing may follow it.
      await expect(tx.inspection.update({ where: { id: inspection.id }, data: { generalNotes: 'tampered' } })).rejects.toThrow(/locked|immutable/i)
    })
  })
})

describe('what other people see afterwards', () => {
  it('keeps an internal editor’s own completed booking readable, without storage details', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const editorUser = await createTestUser(tx, { role: UserRole.EDITOR })
      const s = await scenario(tx, fx, { editorType: 'INTERNAL', editorUserId: editorUser.id })

      await startReturn(tx, fx.engineer, s.bookingId)
      await accountForEverything(tx, fx.engineer, s.bookingId)
      await captureReturnSignature(tx, fx.engineer, s.bookingId, 'ENGINEER', PNG, store)
      await completeReturn(tx, fx.engineer, s.bookingId)

      const linked = await tx.editorProfile.findFirstOrThrow({ where: { userId: editorUser.id }, select: { id: true } })
      const own = await getBookingDetailForActor(tx, actorFor(editorUser, { editorProfileId: linked.id }), s.bookingId)
      expect(own?.status).toBe('COMPLETED')
      expect(own?.actualReturnDate).not.toBeNull()
      expect(JSON.stringify(own)).not.toMatch(/imagePath|imageHash|passwordHash/)

      const workspace = (await loadReturnWorkspace(tx, fx.engineer, s.bookingId))!
      expect(workspace.completed).toBe(true)
      expect(workspace.canComplete).toBe(false)
      expect(JSON.stringify(workspace)).not.toMatch(/imagePath|imageHash|passwordHash/)
    })
  })

  it('reports the eligibility of a booking that is out through the pure rule', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx)

      const workspace = (await loadReturnWorkspace(tx, fx.engineer, s.bookingId))!
      expect(workspace.bookingBlockers).toEqual([])
      expect(workspace.canPerform).toBe(true)
      expect(workspace.inspection).toBeNull()
      expect(workspace.handover?.completed).toBe(true)

      // The same helper the workflow uses, given a handover that is not there.
      expect(bookingReturnBlockers(workspace.booking, null, false).map((blocker) => blocker.code)).toContain('handover')
    })
  })
})

describe('the kit status rule on its own', () => {
  it('maps readiness onto a kit status without touching the database', () => {
    expect(kitStatusAfterReturn({ available: true, state: 'ready', reasons: [], blockingCount: 0, warningCount: 0, memberCount: 3, requiredCount: 2 }).status).toBe('AVAILABLE')

    const maintenance = kitStatusAfterReturn({
      available: false,
      state: 'unavailable',
      reasons: [{ code: 'asset_maintenance', severity: 'blocking', assetId: 'a', assetCode: 'AST-000001', slotLabel: null, reason: 'AST-000001 has maintenance in progress or on hold.' }],
      blockingCount: 1,
      warningCount: 0,
      memberCount: 3,
      requiredCount: 2,
    })
    expect(maintenance.status).toBe('MAINTENANCE')

    const damaged = kitStatusAfterReturn({
      available: false,
      state: 'unavailable',
      reasons: [{ code: 'asset_status', severity: 'blocking', assetId: 'a', assetCode: 'AST-000002', slotLabel: null, reason: 'AST-000002 is damaged.' }],
      blockingCount: 1,
      warningCount: 0,
      memberCount: 3,
      requiredCount: 2,
    })
    expect(damaged.status).toBe('DAMAGED')

    // Unknown readiness is not treated as "fine".
    expect(kitStatusAfterReturn(null).status).toBe('MAINTENANCE')
  })
})
