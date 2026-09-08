import { randomUUID } from 'node:crypto'

import { AssetStatus, MaintenanceStatus, MaintenanceType, UserRole } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Actor } from '@/server/auth/session'
import { getBookingActivity, getBookingDetailForActor } from '@/server/dal/bookings.dal'
import { getHandoverBooking, getHandoverSummary, getLiveHandover } from '@/server/dal/handover.dal'
import type { Db } from '@/server/db/prisma'
import { addAccessory, createAsset } from '@/server/services/assets.service'
import { cancelBooking, createBooking, markReadyForHandover } from '@/server/services/bookings.service'
import { createEditor } from '@/server/services/editors.service'
import {
  bookingHandoverBlockers,
  captureSignature,
  completeHandover,
  loadHandoverWorkspace,
  saveChecklistVerification,
  saveEquipmentVerification,
  startHandover,
  verificationVerdict,
} from '@/server/services/handover.service'
import { addKitAsset, addKitSoftware, createKit } from '@/server/services/kits.service'
import { memorySignatureStore } from '@/server/storage/signature-store'

import { actorFor, createTestUser, testDb, type TestUser, withRollback } from '../helpers/db'
import { prepareChecklistFor } from '../helpers/checklist'

/**
 * The handover against the real database, inside rolled-back transactions.
 * Each test builds a kit (two required items with accessories, one optional),
 * a kit software requirement, an external editor with no account and a
 * booking taken to READY_FOR_HANDOVER, then walks the workflow. Signature
 * images go to an in-memory store, so nothing touches the disk and the
 * rollback leaves no inspection, line, signature, checklist row or number.
 *
 * PostgreSQL aborts a transaction after a failed statement, so the test that
 * provokes the immutability trigger does it as its final step.
 */

const tag = () => randomUUID().slice(0, 8).toUpperCase()
/** A 1×1 PNG - what the pad sends, minus the drawing. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const local = (day: number, hour: number) => `2042-04-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`

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
  return { admin, actor: actorFor(admin), engineerUser, engineer: actorFor(engineerUser), engineerProfileId: engineer.id, categoryId: category.id, softwareId: software.id, accessoryTypeId: accessoryType.id }
}

interface Scenario {
  bookingId: string
  bookingNumber: string
  kitId: string
  kitCode: string
  editorId: string
  editorName: string
  assets: Array<{ id: string; assetCode: string; required: boolean }>
}

/** A READY_FOR_HANDOVER booking on a fresh kit: two required items (with one accessory each) and one optional. */
async function scenario(tx: Db, fx: Fixtures, options: { ready?: boolean; intent?: 'draft' | 'reserve'; editorType?: 'EXTERNAL' | 'INTERNAL' } = {}): Promise<Scenario> {
  const t = tag()
  const kit = await createKit(tx, fx.actor, { kitCode: `HOV-${t}`, name: `Handover kit ${t}`, admBarcode: `ADM-HOVKIT-${t}`, description: undefined, location: undefined, notes: undefined, suitcaseStatus: 'GOOD', status: 'AVAILABLE' })
  const assets: Scenario['assets'] = []
  for (const [index, required] of [true, true, false].entries()) {
    const asset = await createAsset(tx, fx.actor, {
      name: `Handover asset ${t}-${index}`,
      categoryId: fx.categoryId,
      manufacturer: 'Testco',
      model: `H-${index}`,
      serialNumber: `SN-HOV-${t}-${index}`,
      admBarcode: `ADM-HOV-${t}-${index}`,
      location: undefined,
      notes: undefined,
      status: 'AVAILABLE',
    })
    if (required) await addAccessory(tx, fx.actor, asset.id, { accessoryTypeId: fx.accessoryTypeId, label: `Cable ${index}`, quantity: 1, serialNumber: undefined, admBarcode: undefined, isRequired: true, notes: undefined })
    await addKitAsset(tx, fx.actor, kit.id, { assetId: asset.id, slotLabel: `Slot ${index + 1}`, isRequired: required })
    assets.push({ id: asset.id, assetCode: asset.assetCode, required })
  }
  await addKitSoftware(tx, fx.actor, kit.id, { softwareApplicationId: fx.softwareId, isRequired: true })
  const editorName = `Handover Editor ${t}`
  const editor = await createEditor(tx, fx.actor, {
    fullName: editorName,
    staffId: options.editorType === 'INTERNAL' ? `EDT-${t}` : undefined,
    email: undefined,
    contactNumber: '+971 50 111 2222',
    department: undefined,
    company: options.editorType === 'INTERNAL' ? undefined : 'Freelance',
    type: options.editorType ?? 'EXTERNAL',
    notes: undefined,
    userId: undefined,
    isActive: true,
  })
  const booking = await createBooking(tx, fx.actor, {
    editorId: editor.id,
    kitId: kit.id,
    engineerId: fx.engineerProfileId,
    bookingStart: local(10, 9),
    bookingEnd: local(14, 18),
    collectionDate: undefined,
    expectedReturnDate: local(14, 17),
    purpose: 'Handover test',
    notes: undefined,
    intent: options.intent ?? 'reserve',
  })
  if (options.ready ?? true) {
    await prepareChecklistFor(tx, fx.actor, booking.id)
    await markReadyForHandover(tx, fx.actor, booking.id)
  }
  return { bookingId: booking.id, bookingNumber: booking.bookingNumber, kitId: kit.id, kitCode: kit.kitCode, editorId: editor.id, editorName, assets }
}

/** Records every line as handed over, every check as passed and the software as installed. */
async function verifyEverything(tx: Db, actor: Actor, bookingId: string) {
  const inspection = (await getLiveHandover(tx, bookingId))!
  await saveEquipmentVerification(tx, actor, bookingId, {
    suitcaseStatus: 'GOOD',
    generalNotes: 'All present',
    assets: inspection.lines.map((line) => ({ id: line.id, status: 'INCLUDED' as const, notes: undefined })),
    accessories: inspection.lines.flatMap((line) => line.accessories.map((accessory) => ({ id: accessory.id, status: 'INCLUDED' as const, quantityReceived: accessory.quantityExpected, notes: undefined }))),
  })
  await saveChecklistVerification(tx, actor, bookingId, {
    checks: inspection.checklist.map((item) => ({ id: item.id, status: 'PASS' as const, notes: undefined })),
    software: inspection.software.map((check) => ({ id: check.id, status: 'INSTALLED' as const, installedVersion: '2025', notes: undefined })),
  })
  return inspection
}

let countersBefore: Array<{ scope: string; current: number }>

beforeAll(async () => {
  countersBefore = await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })
})

afterAll(async () => {
  expect(await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })).toEqual(countersBefore)
  expect(await testDb.inspection.count({ where: { booking: { kit: { kitCode: { startsWith: 'HOV-' } } } } })).toBe(0)
  expect(await testDb.signature.count({ where: { booking: { kit: { kitCode: { startsWith: 'HOV-' } } } } })).toBe(0)
  expect(await testDb.bookingChecklistItem.count({ where: { booking: { kit: { kitCode: { startsWith: 'HOV-' } } } } })).toBe(0)
  expect(await testDb.kit.count({ where: { kitCode: { startsWith: 'HOV-' } } })).toBe(0)
  await testDb.$disconnect()
})

describe('starting a handover', () => {
  it('snapshots equipment, accessories, software and the checklist once, and is idempotent', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const s = await scenario(tx, fx)

      const first = await startHandover(tx, fx.engineer, s.bookingId)
      expect(first.created).toBe(true)
      const second = await startHandover(tx, fx.engineer, s.bookingId)
      expect(second).toEqual({ inspectionId: first.inspectionId, created: false })

      const inspection = (await getLiveHandover(tx, s.bookingId))!
      expect(inspection.status).toBe('IN_PROGRESS')
      expect(inspection.lines).toHaveLength(3)
      expect(inspection.lines.map((line) => line.assetCodeSnapshot)).toEqual(s.assets.map((asset) => asset.assetCode))
      expect(inspection.lines.map((line) => line.isRequired)).toEqual([true, true, false])
      expect(inspection.lines[0]).toMatchObject({ status: 'INCLUDED', slotLabelSnapshot: 'Slot 1', categoryNameSnapshot: 'Other Equipment', manufacturerSnapshot: 'Testco' })
      expect(inspection.lines[0].accessories).toHaveLength(1)
      expect(inspection.lines[0].accessories[0]).toMatchObject({ labelSnapshot: 'Cable 0', accessoryTypeSnapshot: 'Power Cable', quantityExpected: 1, isRequired: true })
      expect(inspection.lines[2].accessories).toHaveLength(0)
      // Software is no longer checked at handover; the kit's software list stays on the kit.
      expect(inspection.software).toHaveLength(0)
      // The default template has 12 items, one of them RETURN-only. The answers
      // come in from the checklist prepared before the handover started.
      expect(inspection.checklist.length).toBe(11)
      expect(inspection.checklist.every((item) => item.result?.status === 'PASS')).toBe(true)
      expect(await tx.bookingChecklistItem.count({ where: { bookingId: s.bookingId } })).toBe(12)
      expect((await tx.booking.findUniqueOrThrow({ where: { id: s.bookingId } })).checklistTemplateId).not.toBeNull()

      expect(await tx.inspection.count({ where: { bookingId: s.bookingId } })).toBe(1)
      expect(await tx.auditLog.count({ where: { entityType: 'Booking', entityId: s.bookingId, action: 'HANDOVER_STARTED' } })).toBe(1)
    })
  })

  it('refuses bookings that are not ready for handover: draft, reserved, cancelled', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const draft = await scenario(tx, fx, { intent: 'draft', ready: false })
      await expect(startHandover(tx, fx.engineer, draft.bookingId)).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('a draft') })
      const reserved = await scenario(tx, fx, { ready: false })
      await expect(startHandover(tx, fx.engineer, reserved.bookingId)).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('reserved') })
      const cancelled = await scenario(tx, fx)
      await cancelBooking(tx, fx.actor, cancelled.bookingId, { reason: 'Test' })
      await expect(startHandover(tx, fx.engineer, cancelled.bookingId)).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('cancelled') })
      await expect(startHandover(tx, fx.engineer, 'no-such-booking')).rejects.toMatchObject({ code: 'not_found' })
      expect(await tx.inspection.count({ where: { bookingId: { in: [draft.bookingId, reserved.bookingId, cancelled.bookingId] } } })).toBe(0)
    })
  })

  it('refuses when the editor, the kit or its required equipment is no longer fit; optional problems only warn', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)

      const inactiveEditor = await scenario(tx, fx)
      // Deactivation is refused while the booking is live, so flip the flag directly - the realistic drift.
      await tx.editorProfile.update({ where: { id: inactiveEditor.editorId }, data: { isActive: false } })
      await expect(startHandover(tx, fx.engineer, inactiveEditor.bookingId)).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('inactive') })

      const notSetAside = await scenario(tx, fx)
      await tx.kit.update({ where: { id: notSetAside.kitId }, data: { status: 'AVAILABLE' } })
      await expect(startHandover(tx, fx.engineer, notSetAside.bookingId)).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('not set aside') })

      const damaged = await scenario(tx, fx)
      await tx.asset.update({ where: { id: damaged.assets[0].id }, data: { status: AssetStatus.DAMAGED } })
      await expect(startHandover(tx, fx.engineer, damaged.bookingId)).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining(damaged.assets[0].assetCode) })

      const maintained = await scenario(tx, fx)
      await tx.maintenanceRecord.create({ data: { maintenanceNumber: `MNT-TEST-${tag()}`, assetId: maintained.assets[1].id, type: MaintenanceType.REPAIR, status: MaintenanceStatus.IN_PROGRESS, title: 'Fan', startedAt: new Date(), createdById: fx.admin.id } })
      await expect(startHandover(tx, fx.engineer, maintained.bookingId)).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('maintenance') })

      const optionalDamaged = await scenario(tx, fx)
      await tx.asset.update({ where: { id: optionalDamaged.assets[2].id }, data: { status: AssetStatus.DAMAGED } })
      const started = await startHandover(tx, fx.engineer, optionalDamaged.bookingId)
      expect(started.created).toBe(true)
      const workspace = await loadHandoverWorkspace(tx, fx.engineer, optionalDamaged.bookingId)
      expect(workspace?.bookingBlockers).toEqual([])
      expect(workspace?.readiness?.warningCount).toBe(1)
    })
  })
})

describe('verification and signatures', () => {
  it('enforces required equipment, the prepared checklist answers and both signatures before completion', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const store = memorySignatureStore()
      const s = await scenario(tx, fx)
      await startHandover(tx, fx.engineer, s.bookingId)

      // The checklist came in prepared, so only the two signatures stand in the way.
      let verdict = verificationVerdict((await getLiveHandover(tx, s.bookingId))!)
      expect(verdict.blockers.map((blocker) => blocker.code)).toEqual(['signature', 'signature'])
      await expect(completeHandover(tx, fx.engineer, s.bookingId)).rejects.toMatchObject({ code: 'lifecycle' })
      expect((await tx.booking.findUniqueOrThrow({ where: { id: s.bookingId } })).status).toBe('READY_FOR_HANDOVER')

      // A required item marked missing blocks; an optional one only warns.
      const inspection = (await getLiveHandover(tx, s.bookingId))!
      await saveEquipmentVerification(tx, fx.engineer, s.bookingId, {
        suitcaseStatus: 'MINOR_DAMAGE',
        generalNotes: undefined,
        assets: inspection.lines.map((line, index) => ({ id: line.id, status: index === 0 ? ('MISSING' as const) : index === 2 ? ('DAMAGED' as const) : ('INCLUDED' as const), notes: index === 2 ? 'Scratched lid' : undefined })),
        accessories: [],
      })
      verdict = verificationVerdict((await getLiveHandover(tx, s.bookingId))!)
      expect(verdict.blockers.some((blocker) => blocker.code === 'equipment' && blocker.reason.includes(s.assets[0].assetCode))).toBe(true)
      expect(verdict.warnings.some((warning) => warning.includes(s.assets[2].assetCode))).toBe(true)

      // Checklist: the answers came in from the preparation before the handover,
      // so nothing is unanswered - but an amended failure still blocks.
      const required = inspection.checklist.filter((item) => item.isRequired)
      expect(verdict.blockers.some((blocker) => blocker.code === 'checklist')).toBe(false)
      // Software is not part of a handover any more: nothing to answer, nothing to block on.
      expect(inspection.software).toHaveLength(0)
      expect(verdict.blockers.some((blocker) => blocker.reason.includes('not installed'))).toBe(false)

      await saveChecklistVerification(tx, fx.engineer, s.bookingId, {
        checks: [{ id: required[0].id, status: 'FAIL' as const, notes: 'Does not boot' }],
        software: [],
      })
      verdict = verificationVerdict((await getLiveHandover(tx, s.bookingId))!)
      expect(verdict.blockers.some((blocker) => blocker.reason.includes(`Check "${required[0].label}" failed`))).toBe(true)

      // Fix everything except the signatures.
      await verifyEverything(tx, fx.engineer, s.bookingId)
      verdict = verificationVerdict((await getLiveHandover(tx, s.bookingId))!)
      expect(verdict.blockers.map((blocker) => blocker.code)).toEqual(['signature', 'signature'])
      expect((await getLiveHandover(tx, s.bookingId))!.status).toBe('PENDING_SIGNATURES')

      await captureSignature(tx, fx.engineer, s.bookingId, 'EDITOR', PNG, store)
      await expect(completeHandover(tx, fx.engineer, s.bookingId)).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('engineer has not signed') })
      await captureSignature(tx, fx.engineer, s.bookingId, 'ENGINEER', PNG, store)
      expect(verificationVerdict((await getLiveHandover(tx, s.bookingId))!).complete).toBe(true)
    })
  })

  it('attributes signatures on the server, rejects bad images, and replaces rather than edits', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const store = memorySignatureStore()
      const s = await scenario(tx, fx)
      await startHandover(tx, fx.engineer, s.bookingId)

      await expect(captureSignature(tx, fx.engineer, s.bookingId, 'EDITOR', 'data:image/jpeg;base64,AAAA', store)).rejects.toMatchObject({ code: 'validation' })
      await expect(captureSignature(tx, fx.engineer, s.bookingId, 'EDITOR', 'data:image/png;base64,AAAAAAAAAAAAAA==', store)).rejects.toMatchObject({ code: 'validation', message: expect.stringContaining('valid PNG') })
      expect(store.files.size).toBe(0)

      // The editor signature belongs to the booking's editor whoever holds the tablet; the engineer signature to the session user.
      const editorSignature = await captureSignature(tx, fx.engineer, s.bookingId, 'EDITOR', PNG, store)
      const engineerSignature = await captureSignature(tx, fx.actor, s.bookingId, 'ENGINEER', PNG, store, { ipAddress: '10.0.0.1', userAgent: 'vitest' })
      const rows = await tx.signature.findMany({ where: { bookingId: s.bookingId }, orderBy: { signedAt: 'asc' } })
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({ id: editorSignature.signatureId, type: 'HANDOVER_EDITOR', signerRole: 'EDITOR', signerEditorProfileId: s.editorId, signerUserId: null, signerName: s.editorName, storageProvider: 'LOCAL', imageMimeType: 'image/png' })
      expect(rows[1]).toMatchObject({ id: engineerSignature.signatureId, type: 'HANDOVER_ENGINEER', signerRole: 'ENGINEER', signerUserId: fx.admin.id, signerEditorProfileId: null, signerName: fx.admin.name, ipAddress: '10.0.0.1' })
      expect(rows[0].imageHash).toMatch(/^[a-f0-9]{64}$/)
      expect(store.files.has(rows[0].imagePath)).toBe(true)

      // Signing again voids the old row; exactly one live signature per type, files kept for the record.
      await captureSignature(tx, fx.engineer, s.bookingId, 'EDITOR', PNG, store)
      const editorRows = await tx.signature.findMany({ where: { bookingId: s.bookingId, type: 'HANDOVER_EDITOR' } })
      expect(editorRows).toHaveLength(2)
      expect(editorRows.filter((row) => row.voidedAt === null)).toHaveLength(1)
      expect(editorRows.find((row) => row.voidedAt)?.voidReason).toBe('Re-signed')
      expect(store.files.size).toBe(3)

      // What the page sees: who and when, never where.
      const text = JSON.stringify(await getLiveHandover(tx, s.bookingId)) + JSON.stringify(await getHandoverSummary(tx, s.bookingId))
      expect(text).not.toMatch(/imagePath|imageHash|ipAddress|userAgent|signatures\//)
      const actions = (await tx.auditLog.findMany({ where: { entityType: 'Booking', entityId: s.bookingId } })).map((row) => row.action)
      expect(actions.filter((action) => action === 'SIGNATURE_SUBMITTED')).toHaveLength(3)
      expect(actions.filter((action) => action === 'SIGNATURE_VOIDED')).toHaveLength(1)
    })
  })
})

describe('completing the handover', () => {
  it('checks out the booking, the kit and the equipment atomically, with a server collection time', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const store = memorySignatureStore()
      const s = await scenario(tx, fx)
      const before = await tx.booking.findUniqueOrThrow({ where: { id: s.bookingId } })
      await startHandover(tx, fx.engineer, s.bookingId)
      const inspection = await verifyEverything(tx, fx.engineer, s.bookingId)
      // The optional item stays behind, damaged.
      await saveEquipmentVerification(tx, fx.engineer, s.bookingId, {
        suitcaseStatus: 'GOOD',
        generalNotes: undefined,
        assets: inspection.lines.map((line, index) => ({ id: line.id, status: index === 2 ? ('DAMAGED' as const) : ('INCLUDED' as const), notes: undefined })),
        accessories: [],
      })
      await captureSignature(tx, fx.engineer, s.bookingId, 'EDITOR', PNG, store)
      await captureSignature(tx, fx.engineer, s.bookingId, 'ENGINEER', PNG, store)

      const startedAt = Date.now()
      const result = await completeHandover(tx, fx.engineer, s.bookingId)
      expect(result.bookingNumber).toBe(s.bookingNumber)

      const booking = await tx.booking.findUniqueOrThrow({ where: { id: s.bookingId } })
      expect(booking.status).toBe('CHECKED_OUT')
      expect(booking.collectionDate).not.toBeNull()
      expect(Math.abs(booking.collectionDate!.getTime() - startedAt)).toBeLessThan(10_000)
      expect(booking.expectedReturnDate.toISOString()).toBe(before.expectedReturnDate.toISOString())
      expect(booking.actualReturnDate).toBeNull()

      expect((await tx.kit.findUniqueOrThrow({ where: { id: s.kitId } })).status).toBe('CHECKED_OUT')
      const assets = await tx.asset.findMany({ where: { id: { in: s.assets.map((asset) => asset.id) } }, orderBy: { assetCode: 'asc' } })
      expect(assets.map((asset) => asset.status)).toEqual(['CHECKED_OUT', 'CHECKED_OUT', 'DAMAGED'])
      const logs = await tx.assetStatusLog.findMany({ where: { bookingId: s.bookingId } })
      expect(logs).toHaveLength(3)
      expect(logs.every((log) => log.changedById === fx.engineerUser.id)).toBe(true)

      const frozen = await tx.inspection.findUniqueOrThrow({ where: { id: inspection.id } })
      expect(frozen).toMatchObject({ status: 'COMPLETED', completedById: fx.engineerUser.id })
      expect(frozen.lockedAt).not.toBeNull()
      const document = frozen.documentSnapshot as { equipment: unknown[]; signatures: unknown[]; editor: { name: string }; collectedAt: string }
      expect(document.equipment).toHaveLength(3)
      expect(document.signatures).toHaveLength(2)
      expect(document.editor.name).toBe(s.editorName)

      const summary = await getHandoverSummary(tx, s.bookingId)
      expect(summary).toMatchObject({ status: 'COMPLETED', completedByName: fx.engineerUser.name, lineCount: 3, includedCount: 2, checklistTotal: 11, checklistPassed: 11 })
      expect(summary?.signatures).toHaveLength(2)

      const actions = (await tx.auditLog.findMany({ where: { entityType: 'Booking', entityId: s.bookingId } })).map((row) => row.action)
      expect(actions).toEqual(expect.arrayContaining(['HANDOVER_STARTED', 'SIGNATURE_SUBMITTED', 'HANDOVER_COMPLETED', 'BOOKING_STATUS_CHANGED']))
      expect(await tx.auditLog.count({ where: { entityType: 'Kit', entityId: s.kitId, action: 'KIT_STATUS_CHANGED' } })).toBeGreaterThanOrEqual(2)
      const activity = await getBookingActivity(tx, s.bookingId)
      const times = activity.map((event) => event.at.getTime())
      expect(times).toEqual([...times].sort((a, b) => b - a))
      expect(activity.map((event) => event.kind)).toEqual(expect.arrayContaining(['created', 'status', 'handover']))
      expect(activity.find((event) => event.title.includes('handed over to'))?.actorName).toBe(fx.engineerUser.name)

      // Idempotent and closed: a second completion, a late edit and a fresh start all answer with sentences.
      await expect(completeHandover(tx, fx.engineer, s.bookingId)).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('already been handed over') })
      await expect(saveEquipmentVerification(tx, fx.engineer, s.bookingId, { suitcaseStatus: 'GOOD', generalNotes: 'late', assets: [], accessories: [] })).rejects.toMatchObject({ code: 'lifecycle' })
      await expect(captureSignature(tx, fx.engineer, s.bookingId, 'EDITOR', PNG, store)).rejects.toMatchObject({ code: 'lifecycle' })
      expect(await startHandover(tx, fx.engineer, s.bookingId)).toEqual({ inspectionId: inspection.id, created: false })
      expect(await tx.signature.count({ where: { bookingId: s.bookingId, voidedAt: null } })).toBe(2)
      expect(await tx.inspection.count({ where: { bookingId: s.bookingId } })).toBe(1)

      // The template can change; the booking's checklist cannot.
      const item = await tx.bookingChecklistItem.findFirstOrThrow({ where: { bookingId: s.bookingId, sourceTemplateItemId: { not: null } } })
      await tx.checklistTemplateItem.update({ where: { id: item.sourceTemplateItemId! }, data: { label: `${item.label} (edited)` } })
      expect((await tx.bookingChecklistItem.findUniqueOrThrow({ where: { id: item.id } })).label).toBe(item.label)

      // Finally the database itself refuses to touch the frozen document.
      await expect(tx.inspection.update({ where: { id: inspection.id }, data: { generalNotes: 'tampered' } })).rejects.toThrow(/locked/)
    })
  })

  it('leaves the booking ready for handover when completion is refused, and re-checks readiness at the last moment', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const store = memorySignatureStore()
      const s = await scenario(tx, fx)
      await startHandover(tx, fx.engineer, s.bookingId)
      await verifyEverything(tx, fx.engineer, s.bookingId)
      await captureSignature(tx, fx.engineer, s.bookingId, 'EDITOR', PNG, store)
      await captureSignature(tx, fx.engineer, s.bookingId, 'ENGINEER', PNG, store)
      expect((await loadHandoverWorkspace(tx, fx.engineer, s.bookingId))?.canComplete).toBe(true)

      // Between signing and completing, a required item goes into maintenance.
      await tx.maintenanceRecord.create({ data: { maintenanceNumber: `MNT-TEST-${tag()}`, assetId: s.assets[0].id, type: MaintenanceType.REPAIR, status: MaintenanceStatus.ON_HOLD, title: 'Part', startedAt: new Date(), createdById: fx.admin.id } })
      await expect(completeHandover(tx, fx.engineer, s.bookingId)).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('maintenance') })

      const booking = await tx.booking.findUniqueOrThrow({ where: { id: s.bookingId } })
      expect(booking.status).toBe('READY_FOR_HANDOVER')
      expect(booking.collectionDate).toBeNull()
      expect((await tx.kit.findUniqueOrThrow({ where: { id: s.kitId } })).status).toBe('RESERVED')
      expect((await tx.inspection.findFirstOrThrow({ where: { bookingId: s.bookingId } })).lockedAt).toBeNull()
      expect((await tx.asset.findUniqueOrThrow({ where: { id: s.assets[0].id } })).status).toBe('AVAILABLE')
      expect((await loadHandoverWorkspace(tx, fx.engineer, s.bookingId))?.canComplete).toBe(false)
    })
  })

  it('works for an internal editor with an account and keeps their own-booking view readable after checkout', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const store = memorySignatureStore()
      const editorUser = await createTestUser(tx, { role: UserRole.EDITOR, withEditorProfile: true })
      await tx.editorProfile.update({ where: { id: editorUser.editorProfileId! }, data: { staffId: `EDT-${tag()}` } })
      const kit = await scenario(tx, fx) // for its kit and equipment builder we still need a fresh kit; reuse by cancelling its booking
      await cancelBooking(tx, fx.actor, kit.bookingId, { reason: 'Reassign to internal editor' })
      const booking = await createBooking(tx, fx.actor, {
        editorId: editorUser.editorProfileId!,
        kitId: kit.kitId,
        engineerId: fx.engineerProfileId,
        bookingStart: local(20, 9),
        bookingEnd: local(22, 18),
        collectionDate: undefined,
        expectedReturnDate: undefined,
        purpose: undefined,
        notes: undefined,
        intent: 'reserve',
      })
      await prepareChecklistFor(tx, fx.actor, booking.id)
      await markReadyForHandover(tx, fx.actor, booking.id)
      await startHandover(tx, fx.engineer, booking.id)
      await verifyEverything(tx, fx.engineer, booking.id)
      await captureSignature(tx, fx.engineer, booking.id, 'EDITOR', PNG, store)
      await captureSignature(tx, fx.engineer, booking.id, 'ENGINEER', PNG, store)
      await completeHandover(tx, fx.engineer, booking.id)

      const signature = await tx.signature.findFirstOrThrow({ where: { bookingId: booking.id, type: 'HANDOVER_EDITOR' } })
      expect(signature.signerEditorProfileId).toBe(editorUser.editorProfileId)
      expect(signature.signerUserId).toBeNull()

      const own = await getBookingDetailForActor(tx, actorFor(editorUser), booking.id)
      expect(own?.status).toBe('CHECKED_OUT')
      expect(own?.collectionDate).not.toBeNull()
      expect(JSON.stringify(own)).not.toMatch(/passwordHash|imagePath|imageHash/)
      // The booking-level blockers helper reads the same rules the workflow uses.
      const handoverBooking = (await getHandoverBooking(tx, booking.id))!
      expect(bookingHandoverBlockers(handoverBooking, null)[0]?.reason).toContain('already been handed over')
    })
  })
})

describe('a kit with no equipment', () => {
  it('cannot be handed over, however ready it otherwise looks', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const t = tag()

      // Readiness passes trivially on an empty kit: no required member can be
      // missing when there are none. Phase 7 will still take the booking to
      // ready for handover, so the handover itself has to refuse.
      const kit = await createKit(tx, fx.actor, {
        kitCode: `HOE-${t}`,
        name: `Empty kit ${t}`,
        admBarcode: `ADM-HOEKIT-${t}`,
        description: undefined,
        location: undefined,
        notes: undefined,
        suitcaseStatus: 'GOOD',
        status: 'AVAILABLE',
      })
      const editor = await createEditor(tx, fx.actor, {
        fullName: `Empty Kit Editor ${t}`,
        staffId: undefined,
        email: undefined,
        contactNumber: '+971 50 333 4444',
        department: undefined,
        company: 'Freelance',
        type: 'EXTERNAL',
        notes: undefined,
        userId: undefined,
        isActive: true,
      })
      const booking = await createBooking(tx, fx.actor, {
        editorId: editor.id,
        kitId: kit.id,
        engineerId: fx.engineerProfileId,
        bookingStart: local(24, 9),
        bookingEnd: local(26, 18),
        collectionDate: undefined,
        expectedReturnDate: local(26, 17),
        purpose: 'Empty kit handover',
        notes: undefined,
        intent: 'reserve',
      })
      await prepareChecklistFor(tx, fx.actor, booking.id)
      await markReadyForHandover(tx, fx.actor, booking.id)

      // The page says why, and offers nothing to start.
      const workspace = (await loadHandoverWorkspace(tx, fx.engineer, booking.id))!
      expect(workspace.bookingBlockers.map((blocker) => blocker.reason).join(' ')).toContain('has no equipment on it')
      // canPerform is the permission, not the go-ahead: the page offers Start
      // only when no blocker stands, and completion stays closed either way.
      expect(workspace.canPerform).toBe(true)
      expect(workspace.canComplete).toBe(false)
      expect(workspace.inspection).toBeNull()

      // And starting one is refused, so no document, line or number is created.
      await expect(startHandover(tx, fx.engineer, booking.id)).rejects.toThrow(/has no equipment on it/)
      expect(await tx.inspection.count({ where: { bookingId: booking.id } })).toBe(0)
      // The prepared checklist is booking data and stays; nothing of the handover itself exists.
      expect(await tx.bookingChecklistItem.count({ where: { bookingId: booking.id } })).toBe(12)
      expect(await tx.checklistResult.count({ where: { checklistItem: { bookingId: booking.id } } })).toBe(0)

      // The same rule guards completion, for an inspection that holds no lines.
      const withEquipment = await scenario(tx, fx)
      await startHandover(tx, fx.engineer, withEquipment.bookingId)
      const inspection = (await getLiveHandover(tx, withEquipment.bookingId))!
      const verdict = verificationVerdict({ ...inspection, lines: [] })
      expect(verdict.complete).toBe(false)
      expect(verdict.blockers.map((blocker) => blocker.reason).join(' ')).toContain('no equipment to verify')
    })
  })
})
