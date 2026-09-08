import { randomUUID } from 'node:crypto'

import { AuditAction, BookingStatus, InspectionType, MaintenanceStatus, MaintenanceType, NumberScope, SignatureType, SignerRole, UserRole } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import type { Db } from '@/server/db/prisma'
import { nextNumber } from '@/server/services/numbering.service'

import { createTestUser, testDb, withRollback } from '../helpers/db'

/**
 * The database's own guarantees, proved against real PostgreSQL.
 *
 * `scripts/db/verify-constraints.sql` has always checked these by hand. This
 * suite is the automated form the roadmap asks for: every structural check it
 * makes, run by `npm test`, with fixtures each test builds for itself. That
 * independence matters - the SQL script's seed-shape checks fail the moment
 * somebody adds equipment by hand, while these assert only what a migration
 * promises.
 *
 * Two rules make it safe:
 *
 *  - Each test runs in its own transaction, which is always rolled back. A
 *    refused statement aborts that transaction and nothing else, so provoking
 *    a refusal cannot cascade into the next test. Nothing reaches the
 *    development data, the numbering counters or the append-only audit log.
 *  - The database comes from `DATABASE_URL`. Under Testcontainers or a compose
 *    service in CI, that variable points at the container and this file runs
 *    unchanged.
 */

const tag = () => randomUUID().slice(0, 8).toUpperCase()

/** Runs the write and returns the message PostgreSQL refused it with. */
async function refuses(fn: (tx: Db) => Promise<unknown>): Promise<string> {
  let message: string | null = null
  try {
    await withRollback(async (tx) => {
      await fn(tx)
    })
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  if (message === null) throw new Error('Expected the database to refuse this write, but it was accepted.')
  return message
}

/** Runs the write and rolls it back. Any refusal fails the test. */
async function accepts(fn: (tx: Db) => Promise<unknown>): Promise<void> {
  await withRollback(async (tx) => {
    await fn(tx)
  })
}

interface Fixture {
  userId: string
  kitId: string
  editorId: string
  engineerId: string
  categoryId: string
}

/** The smallest graph a booking needs, built with plain writes. */
async function fixture(tx: Db): Promise<Fixture> {
  const t = tag()
  const user = await createTestUser(tx, { role: UserRole.ADMIN, tag: `con-${t}` })
  const [engineer, category] = await Promise.all([
    tx.engineerProfile.findFirstOrThrow({ select: { id: true } }),
    tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' }, select: { id: true } }),
  ])
  const kit = await tx.kit.create({ data: { kitCode: `CON-${t}`, name: `Constraint kit ${t}` }, select: { id: true } })
  const editor = await tx.editorProfile.create({ data: { fullName: `Constraint editor ${t}`, isExternal: true }, select: { id: true } })

  return { userId: user.id, kitId: kit.id, editorId: editor.id, engineerId: engineer.id, categoryId: category.id }
}

async function makeAsset(tx: Db, fx: Fixture, overrides: { status?: 'AVAILABLE' | 'DAMAGED' | 'MAINTENANCE' } = {}): Promise<string> {
  const t = tag()
  const asset = await tx.asset.create({
    data: { assetCode: `CON-${t}`, categoryId: fx.categoryId, name: `Constraint asset ${t}`, serialNumber: `CON-SN-${t}`, status: overrides.status ?? 'AVAILABLE' },
    select: { id: true },
  })
  return asset.id
}

const DAY = 24 * 60 * 60 * 1000
const BASE = new Date('2042-06-10T06:00:00.000Z')
const at = (days: number) => new Date(BASE.getTime() + days * DAY)

async function makeBooking(
  tx: Db,
  fx: Fixture,
  options: { start?: Date; end?: Date; status?: BookingStatus; kitId?: string; expectedReturn?: Date; collection?: Date | null } = {},
): Promise<string> {
  const start = options.start ?? at(0)
  const end = options.end ?? at(2)
  const booking = await tx.booking.create({
    data: {
      bookingNumber: `CON-BK-${tag()}`,
      kitId: options.kitId ?? fx.kitId,
      editorId: fx.editorId,
      engineerId: fx.engineerId,
      status: options.status ?? BookingStatus.RESERVED,
      bookingStart: start,
      bookingEnd: end,
      collectionDate: options.collection === undefined ? start : options.collection,
      expectedReturnDate: options.expectedReturn ?? end,
      createdById: fx.userId,
    },
    select: { id: true },
  })
  return booking.id
}

/**
 * A booking that names its requester the way the form now does, with no editor
 * profile behind it - or, with `requester: null`, one that names nobody, which
 * the CHECK has to refuse.
 */
async function makeTypedBooking(tx: Db, fx: Fixture, options: { requester?: string | null } = {}): Promise<string> {
  const requester = options.requester === undefined ? `Typed requester ${tag()}` : options.requester
  const booking = await tx.booking.create({
    data: {
      bookingNumber: `CON-BK-${tag()}`,
      kitId: fx.kitId,
      status: BookingStatus.RESERVED,
      bookingStart: at(20),
      bookingEnd: at(22),
      collectionDate: at(20),
      expectedReturnDate: at(22),
      createdById: fx.userId,
      requesterName: requester,
      requesterMobile: requester ? '+971 50 111 2222' : null,
      projectName: requester ? 'Constraint project' : null,
      workOrder: requester ? `WO-${tag()}` : null,
    },
    select: { id: true },
  })
  return booking.id
}

async function makeInspection(tx: Db, fx: Fixture, bookingId: string, options: { type?: InspectionType; locked?: boolean; voided?: boolean } = {}): Promise<string> {
  const inspection = await tx.inspection.create({
    data: {
      bookingId,
      type: options.type ?? InspectionType.HANDOVER,
      startedById: fx.userId,
      generalNotes: 'as recorded at the counter',
      lockedAt: options.locked ? new Date() : null,
      completedAt: options.locked ? new Date() : null,
      completedById: options.locked ? fx.userId : null,
      status: options.locked ? 'COMPLETED' : 'IN_PROGRESS',
      voidedAt: options.voided ? new Date() : null,
      voidedById: options.voided ? fx.userId : null,
      voidReason: options.voided ? 'redone' : null,
    },
    select: { id: true },
  })
  return inspection.id
}

async function makeSignature(tx: Db, fx: Fixture, bookingId: string, inspectionId: string, type: SignatureType = SignatureType.HANDOVER_ENGINEER): Promise<string> {
  const signature = await tx.signature.create({
    data: {
      bookingId,
      inspectionId,
      type,
      signerRole: type.endsWith('EDITOR') ? SignerRole.EDITOR : SignerRole.ENGINEER,
      signerName: 'Constraint signatory',
      imagePath: `constraints/${tag()}.png`,
      imageHash: randomUUID().replace(/-/g, ''),
    },
    select: { id: true },
  })
  return signature.id
}

async function makeMaintenance(
  tx: Db,
  fx: Fixture,
  assetId: string,
  data: Partial<{ status: MaintenanceStatus; startedAt: Date | null; completedAt: Date | null; cancelledAt: Date | null; cost: string; currency: string; issueId: string | null }> = {},
): Promise<string> {
  const record = await tx.maintenanceRecord.create({
    data: {
      maintenanceNumber: `CON-MNT-${tag()}`,
      assetId,
      type: MaintenanceType.REPAIR,
      title: 'Constraint check',
      status: data.status ?? MaintenanceStatus.SCHEDULED,
      startedAt: data.startedAt ?? null,
      completedAt: data.completedAt ?? null,
      cancelledAt: data.cancelledAt ?? null,
      cost: data.cost ?? null,
      currency: data.currency ?? 'AED',
      issueId: data.issueId ?? null,
      createdById: fx.userId,
    },
    select: { id: true },
  })
  return record.id
}

// -----------------------------------------------------------------------------
// 1. One kit, one booking at a time
// -----------------------------------------------------------------------------

describe('the booking window', () => {
  it('refuses a second live booking overlapping the same kit', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      await makeBooking(tx, fx, { start: at(0), end: at(4) })
      await makeBooking(tx, fx, { start: at(2), end: at(6) })
    })
    expect(message).toMatch(/bookings_no_overlapping_period_per_kit|exclusion constraint/i)
  })

  it('refuses an overlap even when one booking merely contains the other', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      await makeBooking(tx, fx, { start: at(0), end: at(10) })
      await makeBooking(tx, fx, { start: at(3), end: at(4) })
    })
    expect(message).toMatch(/bookings_no_overlapping_period_per_kit|exclusion constraint/i)
  })

  it('allows an overlapping booking on a different kit', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      const other = await tx.kit.create({ data: { kitCode: `CON-B-${tag()}`, name: 'Second kit' }, select: { id: true } })
      await makeBooking(tx, fx, { start: at(0), end: at(4) })
      await makeBooking(tx, fx, { start: at(1), end: at(3), kitId: other.id })
    })
  })

  it('allows a cancelled booking to overlap, because it no longer holds the kit', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      await makeBooking(tx, fx, { start: at(0), end: at(4) })
      await makeBooking(tx, fx, { start: at(1), end: at(3), status: BookingStatus.CANCELLED })
    })
  })

  it('allows a draft booking to overlap, because a draft holds nothing', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      await makeBooking(tx, fx, { start: at(0), end: at(4) })
      await makeBooking(tx, fx, { start: at(1), end: at(3), status: BookingStatus.DRAFT })
    })
  })

  it('allows a completed booking to overlap, because the kit is already back', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      await makeBooking(tx, fx, { start: at(0), end: at(4), status: BookingStatus.COMPLETED })
      await makeBooking(tx, fx, { start: at(1), end: at(3) })
    })
  })

  it('allows a booking that starts the instant the previous one ends', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      await makeBooking(tx, fx, { start: at(0), end: at(2) })
      await makeBooking(tx, fx, { start: at(2), end: at(4) })
    })
  })

  it.each([
    [BookingStatus.RESERVED],
    [BookingStatus.READY_FOR_HANDOVER],
    [BookingStatus.CHECKED_OUT],
    [BookingStatus.OVERDUE],
    [BookingStatus.RETURN_INSPECTION],
  ])('treats %s as holding the kit', async (status) => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      await makeBooking(tx, fx, { start: at(0), end: at(4), status })
      await makeBooking(tx, fx, { start: at(1), end: at(3) })
    })
    expect(message).toMatch(/bookings_no_overlapping_period_per_kit|exclusion constraint/i)
  })

  it('refuses a zero-length booking, which would collide with nothing', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      await makeBooking(tx, fx, { start: at(0), end: at(0) })
    })
    expect(message).toMatch(/bookings_period_is_ordered/i)
  })

  it('refuses a booking whose dates are the wrong way round', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      await makeBooking(tx, fx, { start: at(4), end: at(1) })
    })
    expect(message).toMatch(/bookings_period_is_ordered/i)
  })

  it('refuses an expected return earlier than the collection', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      await makeBooking(tx, fx, { start: at(0), end: at(4), collection: at(2), expectedReturn: at(1) })
    })
    expect(message).toMatch(/bookings_return_after_collection/i)
  })

  it('allows an expected return before the window ends when there is no collection date yet', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      await makeBooking(tx, fx, { start: at(0), end: at(4), collection: null, expectedReturn: at(1) })
    })
  })

  it('keeps booking numbers unique', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const number = `CON-DUP-${tag()}`
      const base = { kitId: fx.kitId, editorId: fx.editorId, engineerId: fx.engineerId, createdById: fx.userId, bookingStart: at(0), bookingEnd: at(1), expectedReturnDate: at(1), status: BookingStatus.DRAFT }
      await tx.booking.create({ data: { ...base, bookingNumber: number } })
      await tx.booking.create({ data: { ...base, bookingNumber: number, bookingStart: at(5), bookingEnd: at(6), expectedReturnDate: at(6) } })
    })
    expect(message).toMatch(/bookingNumber|unique/i)
  })
})

// -----------------------------------------------------------------------------
// 2. One live inspection of each type per booking
// -----------------------------------------------------------------------------

describe('inspections', () => {
  it('refuses a second live handover on one booking', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const bookingId = await makeBooking(tx, fx, { status: BookingStatus.CHECKED_OUT })
      await makeInspection(tx, fx, bookingId)
      await makeInspection(tx, fx, bookingId)
    })
    expect(message).toMatch(/inspections_one_live_per_booking_and_type|unique/i)
  })

  it('allows a handover and a return to be live at the same time', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      const bookingId = await makeBooking(tx, fx, { status: BookingStatus.RETURN_INSPECTION })
      await makeInspection(tx, fx, bookingId, { type: InspectionType.HANDOVER })
      await makeInspection(tx, fx, bookingId, { type: InspectionType.RETURN })
    })
  })

  it('allows a new handover once the previous one has been voided', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      const bookingId = await makeBooking(tx, fx, { status: BookingStatus.READY_FOR_HANDOVER })
      await makeInspection(tx, fx, bookingId, { voided: true })
      await makeInspection(tx, fx, bookingId)
    })
  })

  it('refuses to change the notes on a locked inspection', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const bookingId = await makeBooking(tx, fx, { status: BookingStatus.CHECKED_OUT })
      const inspectionId = await makeInspection(tx, fx, bookingId, { locked: true })
      await tx.inspection.update({ where: { id: inspectionId }, data: { generalNotes: 'rewritten afterwards' } })
    })
    expect(message).toMatch(/locked and cannot be modified/i)
  })

  it('refuses to change the frozen document on a locked inspection', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const bookingId = await makeBooking(tx, fx, { status: BookingStatus.CHECKED_OUT })
      const inspectionId = await makeInspection(tx, fx, bookingId, { locked: true })
      await tx.inspection.update({ where: { id: inspectionId }, data: { documentSnapshot: { tampered: true } } })
    })
    expect(message).toMatch(/locked and cannot be modified/i)
  })

  it('refuses to unlock a locked inspection', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const bookingId = await makeBooking(tx, fx, { status: BookingStatus.CHECKED_OUT })
      const inspectionId = await makeInspection(tx, fx, bookingId, { locked: true })
      await tx.inspection.update({ where: { id: inspectionId }, data: { lockedAt: null } })
    })
    expect(message).toMatch(/locked and cannot be modified/i)
  })

  it('refuses to move a locked inspection to another booking', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const bookingId = await makeBooking(tx, fx, { status: BookingStatus.CHECKED_OUT })
      const otherKit = await tx.kit.create({ data: { kitCode: `CON-C-${tag()}`, name: 'Another kit' }, select: { id: true } })
      const otherBooking = await makeBooking(tx, fx, { kitId: otherKit.id, status: BookingStatus.CHECKED_OUT })
      const inspectionId = await makeInspection(tx, fx, bookingId, { locked: true })
      await tx.inspection.update({ where: { id: inspectionId }, data: { bookingId: otherBooking } })
    })
    expect(message).toMatch(/locked and cannot be modified/i)
  })

  it('still allows a locked inspection to be voided, which is how a redo works', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      const bookingId = await makeBooking(tx, fx, { status: BookingStatus.CHECKED_OUT })
      const inspectionId = await makeInspection(tx, fx, bookingId, { locked: true })
      await tx.inspection.update({ where: { id: inspectionId }, data: { voidedAt: new Date(), voidedById: fx.userId, voidReason: 'wrong kit' } })
    })
  })

  it('allows an open inspection to be edited freely', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      const bookingId = await makeBooking(tx, fx, { status: BookingStatus.READY_FOR_HANDOVER })
      const inspectionId = await makeInspection(tx, fx, bookingId)
      await tx.inspection.update({ where: { id: inspectionId }, data: { generalNotes: 'still being filled in' } })
    })
  })
})

// -----------------------------------------------------------------------------
// 3. Signatures
// -----------------------------------------------------------------------------

describe('signatures', () => {
  it('refuses a second live signature of the same type on one inspection', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const bookingId = await makeBooking(tx, fx, { status: BookingStatus.CHECKED_OUT })
      const inspectionId = await makeInspection(tx, fx, bookingId)
      await makeSignature(tx, fx, bookingId, inspectionId)
      await makeSignature(tx, fx, bookingId, inspectionId)
    })
    expect(message).toMatch(/signatures_one_live_per_inspection_and_type|unique/i)
  })

  it('allows the editor and the engineer to sign the same inspection', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      const bookingId = await makeBooking(tx, fx, { status: BookingStatus.CHECKED_OUT })
      const inspectionId = await makeInspection(tx, fx, bookingId)
      await makeSignature(tx, fx, bookingId, inspectionId, SignatureType.HANDOVER_EDITOR)
      await makeSignature(tx, fx, bookingId, inspectionId, SignatureType.HANDOVER_ENGINEER)
    })
  })

  it('refuses to repoint a signature at another image', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const bookingId = await makeBooking(tx, fx, { status: BookingStatus.CHECKED_OUT })
      const inspectionId = await makeInspection(tx, fx, bookingId)
      const signatureId = await makeSignature(tx, fx, bookingId, inspectionId)
      await tx.signature.update({ where: { id: signatureId }, data: { imagePath: 'somewhere/else.png' } })
    })
    expect(message).toMatch(/is immutable/i)
  })

  it('refuses to rewrite the hash, the signer or the time a signature was given', async () => {
    for (const data of [{ imageHash: 'rewritten' }, { signerName: 'Someone Else' }, { signedAt: new Date('2020-01-01T00:00:00.000Z') }]) {
      const message = await refuses(async (tx) => {
        const fx = await fixture(tx)
        const bookingId = await makeBooking(tx, fx, { status: BookingStatus.CHECKED_OUT })
        const inspectionId = await makeInspection(tx, fx, bookingId)
        const signatureId = await makeSignature(tx, fx, bookingId, inspectionId)
        await tx.signature.update({ where: { id: signatureId }, data })
      })
      expect(message).toMatch(/is immutable/i)
    }
  })

  it('still allows a signature to be voided, which is how a mistake is corrected', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      const bookingId = await makeBooking(tx, fx, { status: BookingStatus.CHECKED_OUT })
      const inspectionId = await makeInspection(tx, fx, bookingId)
      const signatureId = await makeSignature(tx, fx, bookingId, inspectionId)
      await tx.signature.update({ where: { id: signatureId }, data: { voidedAt: new Date(), voidedById: fx.userId, voidReason: 'signed on the wrong line' } })
      await makeSignature(tx, fx, bookingId, inspectionId)
    })
  })
})

// -----------------------------------------------------------------------------
// 3b. Every booking names somebody, and the new frozen columns stay frozen
// -----------------------------------------------------------------------------

describe('who a booking is for', () => {
  it('accepts a booking that carries its own requester and no editor profile', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      const bookingId = await makeTypedBooking(tx, fx)
      const row = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { editorId: true, requesterName: true } })
      expect(row.editorId).toBeNull()
      expect(row.requesterName).toBeTruthy()
    })
  })

  it('still accepts the legacy shape: an editor profile and no typed requester', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      await makeBooking(tx, fx, { start: at(30), end: at(32), expectedReturn: at(32) })
    })
  })

  it('refuses a booking that names nobody at all', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      await makeTypedBooking(tx, fx, { requester: null })
    })
    expect(message).toMatch(/bookings_requester_identified/i)
  })

  it('refuses to erase the requester from a booking that has no profile either', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const bookingId = await makeTypedBooking(tx, fx)
      await tx.booking.update({ where: { id: bookingId }, data: { requesterName: null } })
    })
    expect(message).toMatch(/bookings_requester_identified/i)
  })
})

describe('the columns the workflow changes added', () => {
  it('refuses to rewrite who returned the kit once the inspection is locked', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const bookingId = await makeBooking(tx, fx, { status: BookingStatus.COMPLETED })
      const inspectionId = await makeInspection(tx, fx, bookingId, { type: InspectionType.RETURN, locked: true })
      await tx.inspection.update({ where: { id: inspectionId }, data: { returnedByName: 'Somebody Else' } })
    })
    expect(message).toMatch(/is locked and cannot be modified/i)
  })

  it('records who returned the kit while the inspection is still open', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      const bookingId = await makeBooking(tx, fx, { status: BookingStatus.RETURN_INSPECTION })
      const inspectionId = await makeInspection(tx, fx, bookingId, { type: InspectionType.RETURN })
      await tx.inspection.update({ where: { id: inspectionId }, data: { returnedByName: 'Runner Rashid' } })
    })
  })

  it("refuses to rewrite a recipient's typed mobile or staff ID after they signed", async () => {
    for (const data of [{ signerMobile: '+971 50 000 0000' }, { signerStaffId: 'REWRITTEN' }]) {
      const message = await refuses(async (tx) => {
        const fx = await fixture(tx)
        const bookingId = await makeBooking(tx, fx, { status: BookingStatus.CHECKED_OUT })
        const inspectionId = await makeInspection(tx, fx, bookingId)
        const signatureId = await makeSignature(tx, fx, bookingId, inspectionId, SignatureType.HANDOVER_EDITOR)
        await tx.signature.update({ where: { id: signatureId }, data })
      })
      expect(message).toMatch(/is immutable/i)
    }
  })
})

// -----------------------------------------------------------------------------
// 4. Kit membership
// -----------------------------------------------------------------------------

describe('kit membership', () => {
  it('refuses to put one asset in two kits at once', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const assetId = await makeAsset(tx, fx)
      const other = await tx.kit.create({ data: { kitCode: `CON-D-${tag()}`, name: 'Rival kit' }, select: { id: true } })
      await tx.kitAsset.create({ data: { kitId: fx.kitId, assetId } })
      await tx.kitAsset.create({ data: { kitId: other.id, assetId } })
    })
    expect(message).toMatch(/kit_assets_one_active_kit_per_asset|unique/i)
  })

  it('allows a second membership once the first has been removed, keeping the history', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      const assetId = await makeAsset(tx, fx)
      const other = await tx.kit.create({ data: { kitCode: `CON-E-${tag()}`, name: 'Later kit' }, select: { id: true } })
      const first = await tx.kitAsset.create({ data: { kitId: fx.kitId, assetId }, select: { id: true } })
      await tx.kitAsset.update({ where: { id: first.id }, data: { removedAt: new Date() } })
      await tx.kitAsset.create({ data: { kitId: other.id, assetId } })
      expect(await tx.kitAsset.count({ where: { assetId } })).toBe(2)
    })
  })

  it('keeps asset codes and serial numbers unique', async () => {
    const code = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const shared = `CON-X-${tag()}`
      await tx.asset.create({ data: { assetCode: shared, categoryId: fx.categoryId, name: 'First' } })
      await tx.asset.create({ data: { assetCode: shared, categoryId: fx.categoryId, name: 'Second' } })
    })
    expect(code).toMatch(/assetCode|unique/i)

    const serial = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const shared = `CON-SN-${tag()}`
      await tx.asset.create({ data: { assetCode: `CON-Y-${tag()}`, categoryId: fx.categoryId, name: 'First', serialNumber: shared } })
      await tx.asset.create({ data: { assetCode: `CON-Z-${tag()}`, categoryId: fx.categoryId, name: 'Second', serialNumber: shared } })
    })
    expect(serial).toMatch(/serialNumber|unique/i)
  })
})

// -----------------------------------------------------------------------------
// 5. The audit log is append-only
// -----------------------------------------------------------------------------

describe('the audit log', () => {
  it('refuses an update', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const row = await tx.auditLog.create({
        data: { action: AuditAction.BOOKING_CREATED, entityType: 'Booking', entityId: 'constraint-test', actorName: 'Constraint suite', actorUserId: fx.userId, summary: 'written once' },
        select: { id: true },
      })
      await tx.auditLog.update({ where: { id: row.id }, data: { summary: 'rewritten' } })
    })
    expect(message).toMatch(/append-only/i)
  })

  it('refuses a delete', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const row = await tx.auditLog.create({
        data: { action: AuditAction.BOOKING_CREATED, entityType: 'Booking', entityId: 'constraint-test', actorName: 'Constraint suite', actorUserId: fx.userId },
        select: { id: true },
      })
      await tx.auditLog.delete({ where: { id: row.id } })
    })
    expect(message).toMatch(/append-only/i)
  })

  it('refuses a bulk delete of the whole table', async () => {
    const message = await refuses(async (tx) => {
      await tx.auditLog.deleteMany({ where: { entityType: 'Booking' } })
    })
    expect(message).toMatch(/append-only/i)
  })

  it('accepts an insert, which is the only thing it allows', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      const row = await tx.auditLog.create({
        data: { action: AuditAction.BOOKING_CREATED, entityType: 'Booking', entityId: 'constraint-test', actorName: 'Constraint suite', actorUserId: fx.userId },
        select: { id: true, createdAt: true },
      })
      expect(row.createdAt).toBeInstanceOf(Date)
    })
  })
})

// -----------------------------------------------------------------------------
// 6. Numbering
// -----------------------------------------------------------------------------

describe('reference numbering', () => {
  it('increments a scope atomically, with no gap between two allocations', async () => {
    await accepts(async (tx) => {
      const first = await nextNumber(tx, NumberScope.BOOKING)
      const second = await nextNumber(tx, NumberScope.BOOKING)
      const serial = (value: string) => Number(value.split('-').at(-1))
      expect(serial(second)).toBe(serial(first) + 1)
    })
  })

  it('counts every scope separately', async () => {
    await accepts(async (tx) => {
      const booking = await nextNumber(tx, NumberScope.BOOKING)
      const issue = await nextNumber(tx, NumberScope.ISSUE)
      const maintenance = await nextNumber(tx, NumberScope.MAINTENANCE)
      expect(booking.startsWith('BK-')).toBe(true)
      expect(issue.startsWith('ISS-')).toBe(true)
      expect(maintenance.startsWith('MNT-')).toBe(true)
    })
  })

  it('creates the counter on first use for a period that has never been used', async () => {
    await accepts(async (tx) => {
      const future = new Date('2099-04-01T00:00:00.000Z')
      expect(await nextNumber(tx, NumberScope.BOOKING, future)).toBe('BK-2099-000001')
      expect(await nextNumber(tx, NumberScope.BOOKING, future)).toBe('BK-2099-000002')
    })
  })

  it('rolls the allocation back with the transaction, so a failed insert burns no number', async () => {
    const before = await testDb.numberSequence.findUnique({ where: { scope_period: { scope: NumberScope.BOOKING, period: '2042' } }, select: { current: true } })
    await accepts(async (tx) => {
      await nextNumber(tx, NumberScope.BOOKING, at(0))
      await nextNumber(tx, NumberScope.BOOKING, at(0))
    })
    const after = await testDb.numberSequence.findUnique({ where: { scope_period: { scope: NumberScope.BOOKING, period: '2042' } }, select: { current: true } })
    expect(after?.current ?? null).toBe(before?.current ?? null)
  })

  it('keeps one counter row per scope and period', async () => {
    const message = await refuses(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "number_sequences" ("id", "scope", "period", "current", "updatedAt")
        VALUES (gen_random_uuid()::text, 'BOOKING'::"NumberScope", '2098', 1, now())
      `
      await tx.$executeRaw`
        INSERT INTO "number_sequences" ("id", "scope", "period", "current", "updatedAt")
        VALUES (gen_random_uuid()::text, 'BOOKING'::"NumberScope", '2098', 1, now())
      `
    })
    expect(message).toMatch(/scope|period|unique/i)
  })
})

// -----------------------------------------------------------------------------
// 7. Maintenance records
// -----------------------------------------------------------------------------

describe('maintenance records', () => {
  it('refuses work that finished before it started', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const assetId = await makeAsset(tx, fx)
      await makeMaintenance(tx, fx, assetId, { status: MaintenanceStatus.COMPLETED, startedAt: at(3), completedAt: at(1) })
    })
    expect(message).toMatch(/maintenance_records_completed_after_started/i)
  })

  it('refuses a completed record with no completion date', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const assetId = await makeAsset(tx, fx)
      await makeMaintenance(tx, fx, assetId, { status: MaintenanceStatus.COMPLETED, startedAt: at(1), completedAt: null })
    })
    expect(message).toMatch(/maintenance_records_status_matches_timestamps/i)
  })

  it('refuses a completion date on a record that is not completed', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const assetId = await makeAsset(tx, fx)
      await makeMaintenance(tx, fx, assetId, { status: MaintenanceStatus.IN_PROGRESS, startedAt: at(1), completedAt: at(2) })
    })
    expect(message).toMatch(/maintenance_records_status_matches_timestamps/i)
  })

  it('refuses work in progress with no start date', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const assetId = await makeAsset(tx, fx)
      await makeMaintenance(tx, fx, assetId, { status: MaintenanceStatus.IN_PROGRESS, startedAt: null })
    })
    expect(message).toMatch(/maintenance_records_status_matches_timestamps/i)
  })

  it('refuses a cancelled record with no cancellation date, and the reverse', async () => {
    const missing = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const assetId = await makeAsset(tx, fx)
      await makeMaintenance(tx, fx, assetId, { status: MaintenanceStatus.CANCELLED, cancelledAt: null })
    })
    expect(missing).toMatch(/maintenance_records_status_matches_timestamps/i)

    const spurious = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const assetId = await makeAsset(tx, fx)
      await makeMaintenance(tx, fx, assetId, { status: MaintenanceStatus.SCHEDULED, cancelledAt: at(1) })
    })
    expect(spurious).toMatch(/maintenance_records_status_matches_timestamps/i)
  })

  it('refuses a negative cost', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const assetId = await makeAsset(tx, fx)
      await makeMaintenance(tx, fx, assetId, { cost: '-1.00' })
    })
    expect(message).toMatch(/maintenance_records_cost_not_negative/i)
  })

  it('accepts a zero cost, which is what a warranty repair costs', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      const assetId = await makeAsset(tx, fx)
      await makeMaintenance(tx, fx, assetId, { cost: '0.00' })
    })
  })

  it.each([['aed'], ['AE'], ['A1D'], ['']])('refuses %s as a currency code', async (currency) => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const assetId = await makeAsset(tx, fx)
      await makeMaintenance(tx, fx, assetId, { currency })
    })
    expect(message).toMatch(/maintenance_records_currency_is_iso4217/i)
  })

  it('refuses a currency code wider than three characters at the column itself', async () => {
    // Prisma stops this one before it leaves the client, so the width of the
    // column is asserted with a statement the client does not inspect.
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const assetId = await makeAsset(tx, fx)
      await tx.$executeRawUnsafe(
        `INSERT INTO "maintenance_records" ("id", "maintenanceNumber", "assetId", "type", "status", "title", "currency", "createdById", "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, 'CON-MNT-WIDE', $1, 'REPAIR', 'SCHEDULED', 'Too wide', 'AEDD', $2, now(), now())`,
        assetId,
        fx.userId,
      )
    })
    expect(message).toMatch(/value too long|character varying/i)
  })

  it('refuses a second actively-underway record on one asset', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const assetId = await makeAsset(tx, fx)
      await makeMaintenance(tx, fx, assetId, { status: MaintenanceStatus.IN_PROGRESS, startedAt: at(0) })
      await makeMaintenance(tx, fx, assetId, { status: MaintenanceStatus.ON_HOLD })
    })
    expect(message).toMatch(/maintenance_records_one_active_per_asset|unique/i)
  })

  it('allows several scheduled records alongside the one underway', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      const assetId = await makeAsset(tx, fx)
      await makeMaintenance(tx, fx, assetId, { status: MaintenanceStatus.IN_PROGRESS, startedAt: at(0) })
      await makeMaintenance(tx, fx, assetId, { status: MaintenanceStatus.SCHEDULED })
      await makeMaintenance(tx, fx, assetId, { status: MaintenanceStatus.SCHEDULED })
      expect(await tx.maintenanceRecord.count({ where: { assetId } })).toBe(3)
    })
  })

  it('refuses to delete an asset that has maintenance history', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const assetId = await makeAsset(tx, fx)
      await makeMaintenance(tx, fx, assetId, { status: MaintenanceStatus.SCHEDULED })
      await tx.asset.delete({ where: { id: assetId } })
    })
    expect(message).toMatch(/foreign key|constraint|Restrict|referential/i)
  })

  it('keeps a maintenance record when the issue it came from is removed', async () => {
    await accepts(async (tx) => {
      const fx = await fixture(tx)
      const assetId = await makeAsset(tx, fx)
      const issue = await tx.issue.create({
        data: { issueNumber: `CON-ISS-${tag()}`, title: 'Constraint issue', description: 'Raised by the constraint suite.', type: 'DAMAGED', severity: 'MEDIUM', assetId, reportedById: fx.userId },
        select: { id: true },
      })
      const recordId = await makeMaintenance(tx, fx, assetId, { status: MaintenanceStatus.SCHEDULED, issueId: issue.id })
      await tx.issue.delete({ where: { id: issue.id } })
      const kept = await tx.maintenanceRecord.findUnique({ where: { id: recordId }, select: { issueId: true } })
      expect(kept).not.toBeNull()
      expect(kept?.issueId).toBeNull()
    })
  })

  it('keeps maintenance numbers unique', async () => {
    const message = await refuses(async (tx) => {
      const fx = await fixture(tx)
      const assetId = await makeAsset(tx, fx)
      const shared = `CON-MNT-${tag()}`
      const base = { assetId, type: MaintenanceType.REPAIR, title: 'Duplicate', createdById: fx.userId }
      await tx.maintenanceRecord.create({ data: { ...base, maintenanceNumber: shared } })
      await tx.maintenanceRecord.create({ data: { ...base, maintenanceNumber: shared } })
    })
    expect(message).toMatch(/maintenanceNumber|unique/i)
  })
})

// -----------------------------------------------------------------------------
// 8. Nothing here touched the development data
// -----------------------------------------------------------------------------

describe('isolation', () => {
  it('leaves no row behind from anything above', async () => {
    const [bookings, kits, assets, editors, maintenance, inspections, signatures, issues] = await Promise.all([
      testDb.booking.count({ where: { bookingNumber: { startsWith: 'CON-' } } }),
      testDb.kit.count({ where: { kitCode: { startsWith: 'CON-' } } }),
      testDb.asset.count({ where: { assetCode: { startsWith: 'CON-' } } }),
      testDb.editorProfile.count({ where: { fullName: { startsWith: 'Constraint editor' } } }),
      testDb.maintenanceRecord.count({ where: { maintenanceNumber: { startsWith: 'CON-' } } }),
      testDb.inspection.count({ where: { generalNotes: 'as recorded at the counter' } }),
      testDb.signature.count({ where: { signerName: 'Constraint signatory' } }),
      testDb.issue.count({ where: { issueNumber: { startsWith: 'CON-' } } }),
    ])
    expect({ bookings, kits, assets, editors, maintenance, inspections, signatures, issues }).toEqual({
      bookings: 0,
      kits: 0,
      assets: 0,
      editors: 0,
      maintenance: 0,
      inspections: 0,
      signatures: 0,
      issues: 0,
    })
  })

  it('leaves no audit row behind, even though the log cannot be cleaned up', async () => {
    expect(await testDb.auditLog.count({ where: { entityId: 'constraint-test' } })).toBe(0)
  })

  it('leaves no test user behind', async () => {
    expect(await testDb.user.count({ where: { email: { startsWith: 'test-con-' } } })).toBe(0)
  })
})
