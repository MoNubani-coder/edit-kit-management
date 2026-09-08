import { randomUUID } from 'node:crypto'

import { UserRole } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Actor } from '@/server/auth/session'
import { getBookingActivity } from '@/server/dal/bookings.dal'
import { getBookingChecklistItems, getLiveHandover } from '@/server/dal/handover.dal'
import { getLiveReturn } from '@/server/dal/return.dal'
import type { Db } from '@/server/db/prisma'
import { updateChecklistItem } from '@/server/services/admin.service'
import { addAccessory, createAsset } from '@/server/services/assets.service'
import { createBooking, loadBookingWorkspace, markReadyForHandover, prepareChecklist, updateBooking } from '@/server/services/bookings.service'
import { createEditor } from '@/server/services/editors.service'
import { captureSignature, completeHandover, saveChecklistVerification, saveEquipmentVerification, startHandover, verificationVerdict } from '@/server/services/handover.service'
import { addKitAsset, addKitSoftware, createKit, loadAssetCandidates } from '@/server/services/kits.service'
import { captureReturnSignature, completeReturn, saveReturnChecklist, saveReturnEquipment, startReturn } from '@/server/services/return.service'
import { memorySignatureStore } from '@/server/storage/signature-store'

import { actorFor, createTestUser, testDb, type TestUser, withRollback } from '../helpers/db'
import { prepareChecklistFor } from '../helpers/checklist'

/**
 * The workflow the user approved on 2026-09-08, against the real database.
 *
 * The shape of a booking changed: the person a kit is for is typed onto the
 * booking rather than looked up in a directory, the checklist is answered
 * before the kit is set aside rather than during the handover, and who prepared
 * a booking, who handed the kit over and who received it back all come from the
 * authenticated session. Software no longer stands in the way of anything.
 *
 * Everything here runs inside a rolled-back transaction, so no booking number,
 * inspection, signature or audit row survives the suite.
 */

const tag = () => randomUUID().slice(0, 8).toUpperCase()
/** A 1×1 PNG - what the pad sends, minus the drawing. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const local = (day: number, hour: number) => `2043-04-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`
const store = memorySignatureStore()

interface Fixtures {
  admin: TestUser
  actor: Actor
  engineerUser: TestUser
  engineer: Actor
  otherEngineerProfileId: string
  categoryId: string
  softwareId: string
  accessoryTypeId: string
}

async function fixtures(tx: Db): Promise<Fixtures> {
  const admin = await createTestUser(tx, { role: UserRole.ADMIN })
  const engineerUser = await createTestUser(tx, { role: UserRole.ENGINEER })
  const [engineerProfile, category, software, accessoryType] = await Promise.all([
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
    // A profile belonging to somebody else entirely - nothing may attribute work to it.
    otherEngineerProfileId: engineerProfile.id,
    categoryId: category.id,
    softwareId: software.id,
    accessoryTypeId: accessoryType.id,
  }
}

/** A kit with one required asset (and an accessory) and one piece of required software. */
async function readyKit(tx: Db, fx: Fixtures) {
  const t = tag()
  const kit = await createKit(tx, fx.actor, {
    kitCode: `WFC-${t}`,
    name: `Workflow kit ${t}`,
    admBarcode: `ADM-WFCKIT-${t}`,
    description: undefined,
    location: undefined,
    notes: undefined,
    suitcaseStatus: 'GOOD',
    status: 'AVAILABLE',
  })
  const asset = await createAsset(tx, fx.actor, {
    name: `Workflow asset ${t}`,
    categoryId: fx.categoryId,
    manufacturer: 'Testco',
    model: `W-${t}`,
    serialNumber: `SN-WFC-${t}`,
    admBarcode: `ADM-WFCASSET-${t}`,
    location: undefined,
    notes: undefined,
    status: 'AVAILABLE',
  })
  await addAccessory(tx, fx.actor, asset.id, {
    accessoryTypeId: fx.accessoryTypeId,
    label: 'Power adapter',
    quantity: 1,
    serialNumber: undefined,
    admBarcode: undefined,
    isRequired: true,
    notes: undefined,
  })
  await addKitAsset(tx, fx.actor, kit.id, { assetId: asset.id, slotLabel: 'Slot 1', isRequired: true })
  // Required software, which used to block a handover and no longer does.
  await addKitSoftware(tx, fx.actor, kit.id, { softwareApplicationId: fx.softwareId, isRequired: true })
  return { ...kit, assetId: asset.id, assetCode: asset.assetCode }
}

/** What the booking form now sends: the requester, typed in, with no profile behind it. */
function requesterFields(t: string) {
  return {
    requesterName: `Layla Haddad ${t}`,
    requesterStaffId: `ADM-${t}`,
    requesterMobile: '+971 50 111 2222',
    projectName: `Ramadan promo ${t}`,
    workOrder: `WO-${t}`,
  }
}

async function typedBooking(tx: Db, fx: Fixtures, overrides: Record<string, unknown> = {}) {
  const t = tag()
  const kit = await readyKit(tx, fx)
  const booking = await createBooking(tx, fx.actor, {
    kitId: kit.id,
    ...requesterFields(t),
    bookingStart: local(10, 9),
    bookingEnd: local(14, 18),
    collectionDate: undefined,
    expectedReturnDate: local(14, 17),
    purpose: 'Outside broadcast edit',
    notes: undefined,
    intent: 'reserve',
    ...overrides,
  })
  return { booking, kit, t }
}

/** Everything recorded, both parties signed, kit checked out. */
async function handOver(tx: Db, fx: Fixtures, bookingId: string, recipient?: { recipientName?: string; recipientMobile?: string }) {
  await prepareChecklistFor(tx, fx.actor, bookingId)
  await markReadyForHandover(tx, fx.actor, bookingId)
  await startHandover(tx, fx.engineer, bookingId)
  const inspection = (await getLiveHandover(tx, bookingId))!
  await saveEquipmentVerification(tx, fx.engineer, bookingId, {
    suitcaseStatus: 'GOOD',
    generalNotes: 'Packed and checked',
    assets: inspection.lines.map((line) => ({ id: line.id, status: 'INCLUDED' as const, notes: undefined })),
    accessories: inspection.lines.flatMap((line) => line.accessories.map((accessory) => ({ id: accessory.id, status: 'INCLUDED' as const, quantityReceived: accessory.quantityExpected, notes: undefined }))),
  })
  await saveChecklistVerification(tx, fx.engineer, bookingId, {
    checks: inspection.checklist.map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })),
    software: [],
  })
  await captureSignature(tx, fx.engineer, bookingId, 'EDITOR', PNG, store, recipient ?? {})
  await captureSignature(tx, fx.engineer, bookingId, 'ENGINEER', PNG, store)
  await completeHandover(tx, fx.engineer, bookingId)
  return inspection
}

/** Records every returned line and every return check, with the odd override. */
async function accountForEverything(tx: Db, actor: Actor, bookingId: string, overrides: Record<string, 'INCLUDED' | 'DAMAGED' | 'MISSING'> = {}) {
  const inspection = (await getLiveReturn(tx, bookingId))!
  await saveReturnEquipment(tx, actor, bookingId, {
    suitcaseStatus: 'GOOD',
    generalNotes: undefined,
    assets: inspection.lines.map((line) => ({ id: line.id, status: line.wasHandedOver ? (overrides[line.assetCodeSnapshot] ?? 'INCLUDED') : ('NOT_APPLICABLE' as const), notes: undefined })),
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
}

let countersBefore: Array<{ scope: string; current: number }>

beforeAll(async () => {
  countersBefore = await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })
})

afterAll(async () => {
  // Nothing the suite allocated survives: no counter moved, no kit remains.
  expect(await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })).toEqual(countersBefore)
  expect(await testDb.kit.count({ where: { kitCode: { startsWith: 'WFC-' } } })).toBe(0)
  await testDb.$disconnect()
})

describe('a booking typed in by the engineer', () => {
  it('is made for someone with no account and no directory profile', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const profilesBefore = await tx.editorProfile.count()
      const { booking, t } = await typedBooking(tx, fx)

      const row = await tx.booking.findUniqueOrThrow({
        where: { id: booking.id },
        select: { editorId: true, requesterName: true, requesterStaffId: true, requesterMobile: true, projectName: true, workOrder: true, createdById: true, checklistTemplateId: true },
      })
      expect(row).toMatchObject({
        editorId: null,
        requesterName: `Layla Haddad ${t}`,
        requesterStaffId: `ADM-${t}`,
        requesterMobile: '+971 50 111 2222',
        projectName: `Ramadan promo ${t}`,
        workOrder: `WO-${t}`,
      })
      // No editor directory row is created behind the engineer's back.
      expect(await tx.editorProfile.count()).toBe(profilesBefore)
      // The booking carries its own checklist from the moment it exists.
      expect(row.checklistTemplateId).not.toBeNull()
      expect(await tx.bookingChecklistItem.count({ where: { bookingId: booking.id } })).toBeGreaterThan(0)
    })
  })

  it('leaves the staff ID out for someone from outside, and still reads', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { booking } = await typedBooking(tx, fx, { requesterStaffId: undefined })
      const workspace = (await loadBookingWorkspace(tx, fx.actor, booking.id))!
      expect(workspace.booking.requesterStaffId).toBeNull()
      expect(workspace.booking.requesterName).toBeTruthy()
    })
  })

  it('records the authenticated user as the one who prepared it, whoever the kit is for', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { booking, t } = await typedBooking(tx, fx)

      const row = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { createdById: true, createdBy: { select: { name: true } } } })
      expect(row.createdById).toBe(fx.admin.id)
      expect(row.createdBy.name).toBe(fx.admin.name)

      const workspace = (await loadBookingWorkspace(tx, fx.actor, booking.id))!
      expect(workspace.booking.createdBy).toMatchObject({ id: fx.admin.id, name: fx.admin.name })

      const created = (await tx.auditLog.findFirstOrThrow({ where: { entityType: 'Booking', entityId: booking.id, action: 'BOOKING_CREATED' }, select: { summary: true, actorUserId: true } }))
      expect(created.actorUserId).toBe(fx.admin.id)
      expect(created.summary).toContain(`Layla Haddad ${t}`)
      expect(created.summary).toContain(`prepared by ${fx.admin.name}`)
    })
  })

  it('assigns no engineer from anything a request might carry', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      // The actor has no engineer profile of their own, so the booking has none -
      // and nothing lets a request nominate somebody else's profile.
      const { booking } = await typedBooking(tx, fx)
      const row = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { engineerId: true } })
      expect(row.engineerId).toBeNull()
      expect(row.engineerId).not.toBe(fx.otherEngineerProfileId)
    })
  })

  it('will not be changed without a reason, and keeps the reason where the activity tab can read it', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { booking, kit, t } = await typedBooking(tx, fx)
      const reason = 'Editor moved the shoot a day later'

      await updateBooking(tx, fx.actor, booking.id, {
        kitId: kit.id,
        ...requesterFields(t),
        requesterMobile: '+971 50 999 8888',
        bookingStart: local(10, 9),
        bookingEnd: local(14, 18),
        collectionDate: undefined,
        expectedReturnDate: local(14, 17),
        purpose: 'Outside broadcast edit',
        notes: undefined,
        reason,
      })

      const entry = await tx.auditLog.findFirstOrThrow({ where: { entityType: 'Booking', entityId: booking.id, action: 'BOOKING_UPDATED' }, select: { summary: true, metadata: true } })
      expect(entry.summary).toContain(`Reason: ${reason}`)
      expect(entry.metadata).toMatchObject({ reason })

      // The activity tab shows the reason as a sentence, never as raw JSON.
      const activity = await getBookingActivity(tx, booking.id)
      const updated = activity.find((event) => event.detail?.includes(reason))
      expect(updated).toBeTruthy()
      expect(JSON.stringify(activity)).not.toContain('"changed"')
    })
  })
})

describe('the checklist, before the kit is set aside', () => {
  it('has to be answered before the booking can be made ready', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { booking } = await typedBooking(tx, fx)

      await expect(markReadyForHandover(tx, fx.actor, booking.id)).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('checklist is complete') })
      expect((await tx.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('RESERVED')

      const items = await getBookingChecklistItems(tx, booking.id)
      const handoverChecks = items.filter((item) => item.phase !== 'RETURN')
      expect(handoverChecks.length).toBeGreaterThan(0)

      // Answer all but one required check: still refused, and the missing one is named.
      const required = handoverChecks.filter((item) => item.isRequired)
      await prepareChecklist(tx, fx.actor, booking.id, { checks: required.slice(1).map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })) })
      await expect(markReadyForHandover(tx, fx.actor, booking.id)).rejects.toMatchObject({ message: expect.stringContaining(required[0].label) })

      // A failed required check blocks too, until it is fixed or excused.
      await prepareChecklist(tx, fx.actor, booking.id, { checks: [{ id: required[0].id, status: 'FAIL' as const, notes: 'Battery will not hold charge' }] })
      await expect(markReadyForHandover(tx, fx.actor, booking.id)).rejects.toMatchObject({ message: expect.stringContaining('failed') })

      await prepareChecklist(tx, fx.actor, booking.id, { checks: [{ id: required[0].id, status: 'NOT_APPLICABLE' as const, notes: 'Battery swapped for a spare' }] })
      await markReadyForHandover(tx, fx.actor, booking.id)
      expect((await tx.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('READY_FOR_HANDOVER')
    })
  })

  it('records who answered it and when', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { booking } = await typedBooking(tx, fx)
      await prepareChecklistFor(tx, fx.engineer, booking.id)

      const row = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { checklistPreparedAt: true, checklistPreparedById: true } })
      expect(row.checklistPreparedById).toBe(fx.engineerUser.id)
      expect(row.checklistPreparedAt).toBeTruthy()

      const items = await getBookingChecklistItems(tx, booking.id)
      const answered = items.filter((item) => item.preparedStatus !== null)
      expect(answered.length).toBeGreaterThan(0)
      expect(answered.every((item) => item.preparedByName === fx.engineerUser.name && item.preparedAt !== null)).toBe(true)
      expect(await tx.bookingChecklistItem.count({ where: { bookingId: booking.id, preparedById: fx.engineerUser.id } })).toBe(answered.length)
    })
  })

  it('hands its answers to the handover, which reviews rather than re-asks them', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { booking } = await typedBooking(tx, fx)

      const items = (await getBookingChecklistItems(tx, booking.id)).filter((item) => item.phase !== 'RETURN')
      await prepareChecklist(tx, fx.actor, booking.id, {
        checks: items.map((item, index) => ({ id: item.id, status: 'PASS' as const, notes: index === 0 ? 'Charged to 100%' : undefined })),
      })
      await markReadyForHandover(tx, fx.actor, booking.id)
      await startHandover(tx, fx.engineer, booking.id)

      const inspection = (await getLiveHandover(tx, booking.id))!
      expect(inspection.checklist.length).toBe(items.length)
      expect(inspection.checklist.every((line) => line.result?.status === 'PASS')).toBe(true)
      expect(inspection.checklist.some((line) => line.result?.notes === 'Charged to 100%')).toBe(true)
      // Nothing about the checklist stands in the way of completion any more.
      expect(verificationVerdict(inspection).blockers.some((blocker) => blocker.code === 'checklist')).toBe(false)
    })
  })

  it('is no longer preparable from the booking once the handover has started', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { booking } = await typedBooking(tx, fx)
      await prepareChecklistFor(tx, fx.actor, booking.id)
      await markReadyForHandover(tx, fx.actor, booking.id)
      await startHandover(tx, fx.engineer, booking.id)

      const items = await getBookingChecklistItems(tx, booking.id)
      await expect(prepareChecklist(tx, fx.actor, booking.id, { checks: [{ id: items[0].id, status: 'FAIL' as const, notes: undefined }] })).rejects.toMatchObject({
        code: 'lifecycle',
        message: expect.stringContaining('handover page'),
      })
      const workspace = (await loadBookingWorkspace(tx, fx.actor, booking.id))!
      expect(workspace.canPrepareChecklist).toBe(false)
    })
  })

  it('is not rewritten when somebody edits the template afterwards', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { booking } = await typedBooking(tx, fx)
      await prepareChecklistFor(tx, fx.actor, booking.id)

      const before = await getBookingChecklistItems(tx, booking.id)
      const copied = before[0]
      const source = await tx.bookingChecklistItem.findUniqueOrThrow({ where: { id: copied.id }, select: { sourceTemplateItemId: true } })
      expect(source.sourceTemplateItemId).not.toBeNull()

      const template = await tx.checklistTemplateItem.findUniqueOrThrow({ where: { id: source.sourceTemplateItemId! }, select: { description: true, phase: true, sortOrder: true } })
      await updateChecklistItem(tx, fx.actor, source.sourceTemplateItemId!, {
        label: 'Renamed after the booking was prepared',
        description: template.description ?? undefined,
        phase: template.phase,
        isRequired: false,
        sortOrder: template.sortOrder,
      })

      const after = await getBookingChecklistItems(tx, booking.id)
      const same = after.find((item) => item.id === copied.id)!
      expect(same.label).toBe(copied.label)
      expect(same.isRequired).toBe(copied.isRequired)
      expect(same.preparedStatus).toBe(copied.preparedStatus)
    })
  })
})

describe('handing the kit to someone with no account', () => {
  it('keeps the recipient’s typed name and mobile on their signature, with no profile behind it', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { booking } = await typedBooking(tx, fx)
      await handOver(tx, fx, booking.id, { recipientName: 'Runner Rashid', recipientMobile: '+971 52 456 7890' })

      const inspection = await tx.inspection.findFirstOrThrow({ where: { bookingId: booking.id, type: 'HANDOVER' }, select: { id: true } })
      const recipient = await tx.signature.findFirstOrThrow({
        where: { inspectionId: inspection.id, type: 'HANDOVER_EDITOR', voidedAt: null },
        select: { signerName: true, signerMobile: true, signerEditorProfileId: true, signerUserId: true },
      })
      expect(recipient).toMatchObject({ signerName: 'Runner Rashid', signerMobile: '+971 52 456 7890', signerEditorProfileId: null, signerUserId: null })

      // The engineer's half is the authenticated user, never a typed name.
      const engineer = await tx.signature.findFirstOrThrow({
        where: { inspectionId: inspection.id, type: 'HANDOVER_ENGINEER', voidedAt: null },
        select: { signerName: true, signerUserId: true, signerEditorProfileId: true },
      })
      expect(engineer).toMatchObject({ signerName: fx.engineerUser.name, signerUserId: fx.engineerUser.id, signerEditorProfileId: null })
    })
  })

  it('falls back to the booking’s requester when nothing is typed at the pad', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { booking, t } = await typedBooking(tx, fx)
      await handOver(tx, fx, booking.id)

      const inspection = await tx.inspection.findFirstOrThrow({ where: { bookingId: booking.id, type: 'HANDOVER' }, select: { id: true } })
      const recipient = await tx.signature.findFirstOrThrow({ where: { inspectionId: inspection.id, type: 'HANDOVER_EDITOR', voidedAt: null }, select: { signerName: true, signerMobile: true } })
      expect(recipient).toMatchObject({ signerName: `Layla Haddad ${t}`, signerMobile: '+971 50 111 2222' })
    })
  })

  it('lets the handover finish with required software on the kit, and keeps the kit’s software list', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { booking, kit } = await typedBooking(tx, fx)
      await handOver(tx, fx, booking.id)

      expect((await tx.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CHECKED_OUT')
      // Nothing was asked about software, and nothing was recorded about it.
      expect(await tx.softwareCheck.count({ where: { inspection: { bookingId: booking.id } } })).toBe(0)
      // The kit's own software list is untouched history.
      expect(await tx.kitSoftware.count({ where: { kitId: kit.id, softwareApplicationId: fx.softwareId } })).toBe(1)
    })
  })

  it('carries the typed requester, the project and the work order onto the frozen document', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { booking, t } = await typedBooking(tx, fx)
      await handOver(tx, fx, booking.id)

      const inspection = await tx.inspection.findFirstOrThrow({ where: { bookingId: booking.id, type: 'HANDOVER' }, select: { documentSnapshot: true } })
      const snapshot = inspection.documentSnapshot as { editor?: Record<string, unknown>; engineer?: Record<string, unknown> }
      expect(snapshot.editor).toMatchObject({ name: `Layla Haddad ${t}`, projectName: `Ramadan promo ${t}`, workOrder: `WO-${t}`, contactNumber: '+971 50 111 2222' })
      expect(snapshot.engineer).toMatchObject({ handedOverBy: fx.engineerUser.name, preparedBy: fx.admin.name })
    })
  })
})

describe('bringing the kit back', () => {
  it('offers the return only while the kit is actually out', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { booking } = await typedBooking(tx, fx)

      expect((await loadBookingWorkspace(tx, fx.engineer, booking.id))!.canReturnKit).toBe(false)
      await handOver(tx, fx, booking.id)
      expect((await loadBookingWorkspace(tx, fx.engineer, booking.id))!.canReturnKit).toBe(true)

      await startReturn(tx, fx.engineer, booking.id)
      await accountForEverything(tx, fx.engineer, booking.id)
      await captureReturnSignature(tx, fx.engineer, booking.id, 'ENGINEER', PNG, store)
      await completeReturn(tx, fx.engineer, booking.id, 'Runner Rashid')

      // Once it is back, there is nothing left to return.
      expect((await loadBookingWorkspace(tx, fx.engineer, booking.id))!.canReturnKit).toBe(false)
    })
  })

  it('completes a healthy return, frees the kit, and says who received it and who brought it', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { booking, kit } = await typedBooking(tx, fx)
      await handOver(tx, fx, booking.id)
      await startReturn(tx, fx.engineer, booking.id)
      await accountForEverything(tx, fx.engineer, booking.id)
      await captureReturnSignature(tx, fx.engineer, booking.id, 'ENGINEER', PNG, store)

      const before = new Date()
      const completed = await completeReturn(tx, fx.engineer, booking.id, '  Runner Rashid  ')
      expect(completed.kitStatus).toBe('AVAILABLE')

      const row = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { status: true, actualReturnDate: true } })
      expect(row.status).toBe('COMPLETED')
      expect((await tx.kit.findUniqueOrThrow({ where: { id: kit.id } })).status).toBe('AVAILABLE')

      const inspection = await tx.inspection.findFirstOrThrow({
        where: { bookingId: booking.id, type: 'RETURN' },
        select: { returnedByName: true, completedById: true, completedAt: true, documentSnapshot: true },
      })
      // Who brought it back is typed in; who received it is the session; the date is the server's.
      expect(inspection.returnedByName).toBe('Runner Rashid')
      expect(inspection.completedById).toBe(fx.engineerUser.id)
      expect(inspection.completedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(row.actualReturnDate!.getTime()).toBeGreaterThanOrEqual(before.getTime())

      const snapshot = inspection.documentSnapshot as { returnedBy?: string; engineer?: Record<string, unknown> }
      expect(snapshot.returnedBy).toBe('Runner Rashid')
      expect(snapshot.engineer).toMatchObject({ returnReceivedBy: fx.engineerUser.name, preparedBy: fx.admin.name })

      // No issue is raised when everything came back healthy.
      expect(await tx.issue.count({ where: { bookingId: booking.id } })).toBe(0)
    })
  })

  it('defaults the person returning it to the booking’s requester', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { booking, t } = await typedBooking(tx, fx)
      await handOver(tx, fx, booking.id)
      await startReturn(tx, fx.engineer, booking.id)
      await accountForEverything(tx, fx.engineer, booking.id)
      await captureReturnSignature(tx, fx.engineer, booking.id, 'ENGINEER', PNG, store)
      await completeReturn(tx, fx.engineer, booking.id)

      const inspection = await tx.inspection.findFirstOrThrow({ where: { bookingId: booking.id, type: 'RETURN' }, select: { returnedByName: true } })
      expect(inspection.returnedByName).toBe(`Layla Haddad ${t}`)
    })
  })

  it('raises an issue and keeps the kit out of service when something came back damaged', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const { booking, kit } = await typedBooking(tx, fx)
      const handover = await handOver(tx, fx, booking.id)
      const damaged = handover.lines[0].assetCodeSnapshot

      await startReturn(tx, fx.engineer, booking.id)
      await accountForEverything(tx, fx.engineer, booking.id, { [damaged]: 'DAMAGED' })
      await captureReturnSignature(tx, fx.engineer, booking.id, 'ENGINEER', PNG, store)
      const completed = await completeReturn(tx, fx.engineer, booking.id, 'Runner Rashid')

      // The booking is still completed - the kit came back - but the kit is not available.
      expect((await tx.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('COMPLETED')
      expect(completed.kitStatus).not.toBe('AVAILABLE')
      expect((await tx.kit.findUniqueOrThrow({ where: { id: kit.id } })).status).not.toBe('AVAILABLE')
      expect(completed.issueNumbers.length).toBeGreaterThan(0)
      expect(await tx.issue.count({ where: { bookingId: booking.id } })).toBeGreaterThan(0)
    })
  })
})

describe('adding equipment to a kit', () => {
  it('says of every match whether it can join this kit, and why not', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const t = tag()
      const kit = await readyKit(tx, fx)
      const otherKit = await readyKit(tx, fx)

      // A free asset that the same search finds, so the list holds both kinds.
      const free = await createAsset(tx, fx.actor, {
        name: `Workflow asset ${t}`,
        categoryId: fx.categoryId,
        manufacturer: 'Testco',
        model: `W-${t}`,
        serialNumber: `SN-WFC-FREE-${t}`,
        admBarcode: `ADM-WFCFREE-${t}`,
        location: undefined,
        notes: undefined,
        status: 'AVAILABLE',
      })

      const byCode = await loadAssetCandidates(tx, kit.id, kit.assetCode)
      expect(byCode).toHaveLength(1)
      expect(byCode[0]).toMatchObject({ blocker: `${kit.assetCode} is already in this kit.`, scanned: true })
      expect(byCode[0].currentKit?.id).toBe(kit.id)

      // The same asset seen from another kit reads as taken, and says where it is.
      const fromElsewhere = await loadAssetCandidates(tx, otherKit.id, kit.assetCode)
      expect(fromElsewhere[0].blocker).toBe(`${kit.assetCode} is in kit ${kit.kitCode}. Remove it there first.`)

      // A free one has no blocker at all, which is what makes the button appear.
      const freeRow = (await loadAssetCandidates(tx, kit.id, free.assetCode))[0]
      expect(freeRow.blocker).toBeNull()
      expect(freeRow.currentKit).toBeNull()

      // A wider search returns both, so the count the picker prints is honest.
      const wide = await loadAssetCandidates(tx, kit.id, `Workflow asset ${t}`)
      expect(wide.length).toBeGreaterThanOrEqual(1)
      expect(wide.filter((candidate) => !candidate.blocker).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('refuses equipment that is not fit to be issued, and the server holds the same line', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const t = tag()
      const kit = await readyKit(tx, fx)
      const damaged = await createAsset(tx, fx.actor, {
        name: `Workflow damaged ${t}`,
        categoryId: fx.categoryId,
        manufacturer: 'Testco',
        model: `D-${t}`,
        serialNumber: `SN-WFC-DMG-${t}`,
        admBarcode: `ADM-WFCDMG-${t}`,
        location: undefined,
        notes: undefined,
        status: 'DAMAGED',
      })

      const row = (await loadAssetCandidates(tx, kit.id, damaged.assetCode))[0]
      expect(row.blocker).toContain('cannot be issued as part of a kit')
      // The picker's reason is the service's reason, so the two can never disagree.
      await expect(addKitAsset(tx, fx.actor, kit.id, { assetId: damaged.id, slotLabel: undefined, isRequired: false })).rejects.toMatchObject({
        message: expect.stringContaining('cannot be issued as part of a kit'),
      })
    })
  })
})

describe('bookings made the old way', () => {
  it('still read, sign and complete against their directory profile', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const t = tag()
      const kit = await readyKit(tx, fx)
      const editor = await createEditor(tx, fx.actor, {
        fullName: `Legacy Editor ${t}`,
        staffId: `EDT-${t}`,
        email: undefined,
        contactNumber: '+971 55 404 5050',
        department: 'News',
        company: undefined,
        type: 'INTERNAL',
        notes: undefined,
        userId: undefined,
        isActive: true,
      })
      const booking = await createBooking(tx, fx.actor, {
        editorId: editor.id,
        kitId: kit.id,
        bookingStart: local(20, 9),
        bookingEnd: local(22, 18),
        collectionDate: undefined,
        expectedReturnDate: local(22, 17),
        purpose: 'Legacy path',
        notes: undefined,
        intent: 'reserve',
      })

      // The requester is snapshotted from the profile, so the booking reads either way.
      const workspace = (await loadBookingWorkspace(tx, fx.actor, booking.id))!
      expect(workspace.booking.editor?.fullName).toBe(`Legacy Editor ${t}`)
      expect(workspace.booking.requesterName).toBe(`Legacy Editor ${t}`)

      await handOver(tx, fx, booking.id)
      const inspection = await tx.inspection.findFirstOrThrow({ where: { bookingId: booking.id, type: 'HANDOVER' }, select: { id: true } })
      const recipient = await tx.signature.findFirstOrThrow({
        where: { inspectionId: inspection.id, type: 'HANDOVER_EDITOR', voidedAt: null },
        select: { signerName: true, signerEditorProfileId: true },
      })
      expect(recipient).toMatchObject({ signerName: `Legacy Editor ${t}`, signerEditorProfileId: editor.id })
    })
  })
})
