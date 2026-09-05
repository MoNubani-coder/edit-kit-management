import { randomUUID } from 'node:crypto'

import { BookingStatus, KitStatus, MaintenanceStatus, MaintenanceType, UserRole } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { isBookingOverdue, isDueSoon, rangesOverlap, scheduleErrors } from '@/lib/booking-rules'
import { zonedLocalToDate } from '@/lib/datetime'
import type { Actor } from '@/server/auth/session'
import {
  countBookingsByFilter,
  DUE_SOON_HOURS,
  findOverlappingBookings,
  getBookingActivity,
  getBookingDetailForActor,
  listBookingsPage,
} from '@/server/dal/bookings.dal'
import type { Db } from '@/server/db/prisma'
import { createAsset } from '@/server/services/assets.service'
import {
  bookingTimeState,
  cancelBooking,
  createBooking,
  markReadyForHandover,
  reserveBooking,
  returnToDraft,
  revertReadyForHandover,
  translateBookingDbError,
  updateBooking,
} from '@/server/services/bookings.service'
import { createEditor } from '@/server/services/editors.service'
import { DomainError } from '@/server/services/errors'
import { addKitAsset, createKit } from '@/server/services/kits.service'

import { actorFor, createTestUser, testDb, type TestUser, withRollback } from '../helpers/db'

/**
 * Booking rules against the real database, inside rolled-back transactions.
 * Every test builds its own editors, kits (each with one available asset) and
 * bookings; nothing survives - including the BK numbers it allocated.
 *
 * PostgreSQL aborts a transaction after a failed statement, so the test that
 * provokes the exclusion constraint does it as its final step.
 */

const TZ = 'Asia/Dubai'
const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const LIST = { filter: 'all', sort: 'bookingStart', direction: 'asc', page: 1, pageSize: 25, timeZone: TZ } as const

const tag = () => randomUUID().slice(0, 8).toUpperCase()

/** `2040-03-10T09:00` and friends - far enough ahead that "today" never interferes. */
const local = (day: number, hour: number, month = 3, year = 2040) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`

interface Fixtures {
  admin: TestUser
  actor: Actor
  engineerId: string
  categoryId: string
}

async function fixtures(tx: Db): Promise<Fixtures> {
  const admin = await createTestUser(tx, { role: UserRole.ADMIN })
  const engineer = await tx.engineerProfile.findFirstOrThrow({ select: { id: true } })
  const category = await tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' }, select: { id: true } })
  return { admin, actor: actorFor(admin), engineerId: engineer.id, categoryId: category.id }
}

/** A kit with one available required asset - ready to be reserved. */
async function readyKit(tx: Db, fx: Fixtures) {
  const t = tag()
  const kit = await createKit(tx, fx.actor, { kitCode: `BKT-${t}`, name: `Booking test kit ${t}`, admBarcode: `ADM-BKTKIT-${t}`, description: undefined, location: undefined, notes: undefined, suitcaseStatus: 'GOOD', status: 'AVAILABLE' })
  const asset = await createAsset(tx, fx.actor, {
    name: `Booking test asset ${t}`,
    categoryId: fx.categoryId,
    manufacturer: 'Testco',
    model: `B-${t}`,
    serialNumber: `SN-BKT-${t}`,
    admBarcode: `ADM-BKTASSET-${t}`,
    location: undefined,
    notes: undefined,
    status: 'AVAILABLE',
  })
  await addKitAsset(tx, fx.actor, kit.id, { assetId: asset.id, slotLabel: 'Slot 1', isRequired: true })
  return { ...kit, assetId: asset.id, assetCode: asset.assetCode }
}

/** An external editor with no staff ID unless said otherwise. */
async function makeEditor(tx: Db, fx: Fixtures, overrides: Partial<Parameters<typeof createEditor>[2]> = {}) {
  const t = tag()
  const created = await createEditor(tx, fx.actor, {
    fullName: `Booking Editor ${t}`,
    staffId: undefined,
    email: undefined,
    contactNumber: undefined,
    department: undefined,
    company: 'Freelance',
    type: 'EXTERNAL',
    notes: undefined,
    userId: undefined,
    isActive: true,
    ...overrides,
  })
  return { id: created.id, fullName: `Booking Editor ${t}` }
}

type Input = Parameters<typeof createBooking>[2]

function input(fx: Fixtures, editorId: string, kitId: string, overrides: Partial<Input> = {}): Input {
  return {
    editorId,
    kitId,
    engineerId: fx.engineerId,
    bookingStart: local(10, 9),
    bookingEnd: local(12, 18),
    collectionDate: undefined,
    expectedReturnDate: undefined,
    purpose: undefined,
    notes: undefined,
    intent: 'reserve',
    ...overrides,
  }
}

let counterBefore: { asset: number | null; booking: number | null }

async function counters() {
  const rows = await testDb.numberSequence.findMany({ where: { scope: { in: ['ASSET', 'BOOKING'] } }, select: { scope: true, current: true } })
  return { asset: rows.find((row) => row.scope === 'ASSET')?.current ?? null, booking: rows.find((row) => row.scope === 'BOOKING')?.current ?? null }
}

beforeAll(async () => {
  counterBefore = await counters()
})

afterAll(async () => {
  // Nothing the suite allocated may survive: no BK counter row appears, the AST counter is untouched.
  expect(await counters()).toEqual(counterBefore)
  expect(await testDb.booking.count({ where: { bookingNumber: { startsWith: 'BK-' }, kit: { kitCode: { startsWith: 'BKT-' } } } })).toBe(0)
  await testDb.$disconnect()
})

describe('time rules', () => {
  it('converts Dubai wall-clock input to instants and back', () => {
    expect(zonedLocalToDate('2040-03-10T09:00', TZ)?.toISOString()).toBe('2040-03-10T05:00:00.000Z')
    expect(zonedLocalToDate('nonsense', TZ)).toBeNull()
  })

  it('derives overdue and due-soon from status and expected return', () => {
    const now = new Date('2026-09-05T12:00:00.000Z')
    expect(isBookingOverdue('CHECKED_OUT', new Date(now.getTime() - HOUR), now)).toBe(true)
    expect(isBookingOverdue('CHECKED_OUT', new Date(now.getTime() + HOUR), now)).toBe(false)
    expect(isBookingOverdue('OVERDUE', new Date(now.getTime() + DAY), now)).toBe(true)
    expect(isBookingOverdue('RESERVED', new Date(now.getTime() - DAY), now)).toBe(false)
    expect(isDueSoon('CHECKED_OUT', new Date(now.getTime() + 10 * HOUR), now, 48)).toBe(true)
    expect(isDueSoon('CHECKED_OUT', new Date(now.getTime() + 60 * HOUR), now, 48)).toBe(false)
    expect(isDueSoon('RESERVED', new Date(now.getTime() + 10 * HOUR), now, 48)).toBe(false)
    expect(DUE_SOON_HOURS).toBe(48)
  })

  it('treats a shared boundary instant as free, like the half-open database range [start, end)', () => {
    const a = [new Date('2040-03-10T09:00Z'), new Date('2040-03-12T18:00Z')] as const
    expect(rangesOverlap(...a, new Date('2040-03-12T18:00Z'), new Date('2040-03-13T09:00Z'))).toBe(false)
    expect(rangesOverlap(...a, new Date('2040-03-12T17:59Z'), new Date('2040-03-13T09:00Z'))).toBe(true)
    expect(rangesOverlap(...a, new Date('2040-03-08T09:00Z'), new Date('2040-03-10T09:00Z'))).toBe(false)
    expect(rangesOverlap(...a, new Date('2040-03-08T09:00Z'), new Date('2040-03-10T09:01Z'))).toBe(true)
  })

  it('rejects impossible schedules field by field', () => {
    const start = new Date('2040-03-10T05:00Z')
    const end = new Date('2040-03-12T14:00Z')
    expect(scheduleErrors({ bookingStart: start, bookingEnd: end, collectionDate: null, expectedReturnDate: end })).toEqual({})
    expect(scheduleErrors({ bookingStart: end, bookingEnd: start, collectionDate: null, expectedReturnDate: start })).toHaveProperty('bookingEnd')
    expect(scheduleErrors({ bookingStart: start, bookingEnd: end, collectionDate: null, expectedReturnDate: new Date(end.getTime() + HOUR) })).toHaveProperty('expectedReturnDate')
    expect(scheduleErrors({ bookingStart: start, bookingEnd: end, collectionDate: new Date(start.getTime() - 2 * DAY), expectedReturnDate: end })).toHaveProperty('collectionDate')
    expect(scheduleErrors({ bookingStart: start, bookingEnd: end, collectionDate: new Date(end.getTime() + HOUR), expectedReturnDate: end })).toHaveProperty('collectionDate')
    expect(scheduleErrors({ bookingStart: start, bookingEnd: end, collectionDate: new Date(start.getTime() + HOUR), expectedReturnDate: start })).toHaveProperty('expectedReturnDate')
  })
})

describe('creating bookings', () => {
  it('allocates BK-YYYY-NNNNNN in sequence and saves a draft that holds nothing', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const editor = await makeEditor(tx, fx)
      const kit = await readyKit(tx, fx)

      const first = await createBooking(tx, fx.actor, input(fx, editor.id, kit.id, { intent: 'draft', purpose: 'Rough cut' }))
      const second = await createBooking(tx, fx.actor, input(fx, editor.id, kit.id, { intent: 'draft' }))
      const year = String(new Date().getUTCFullYear())
      expect(first.bookingNumber).toMatch(new RegExp(`^BK-${year}-\\d{6}$`))
      expect(Number(second.bookingNumber.slice(-6))).toBe(Number(first.bookingNumber.slice(-6)) + 1)
      expect(first.status).toBe('DRAFT')

      const detail = await getBookingDetailForActor(tx, fx.actor, first.id)
      expect(detail).toMatchObject({
        bookingNumber: first.bookingNumber,
        status: 'DRAFT',
        purpose: 'Rough cut',
        collectionDate: null,
        editor: expect.objectContaining({ id: editor.id, isExternal: true, staffId: null }),
        kit: expect.objectContaining({ kitCode: kit.kitCode }),
      })
      expect(detail?.bookingStart.toISOString()).toBe('2040-03-10T05:00:00.000Z')
      expect(detail?.expectedReturnDate.toISOString()).toBe(detail?.bookingEnd.toISOString())

      // Two drafts on the same kit and window coexist: a draft does not hold the kit.
      expect(await findOverlappingBookings(tx, kit.id, detail!.bookingStart, detail!.bookingEnd)).toEqual([])
      const audit = await tx.auditLog.findMany({ where: { entityType: 'Booking', entityId: first.id } })
      expect(audit.map((row) => row.action)).toEqual(['BOOKING_CREATED'])
      expect(audit[0].summary).toContain(first.bookingNumber)
    })
  })

  it('reserves for an active external editor with no staff ID, audited, without touching the kit status', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const editor = await makeEditor(tx, fx)
      const kit = await readyKit(tx, fx)

      const booking = await createBooking(tx, fx.actor, input(fx, editor.id, kit.id, { collectionDate: local(10, 8), expectedReturnDate: local(12, 17) }))
      expect(booking.status).toBe('RESERVED')
      const row = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } })
      expect(row.collectionDate?.toISOString()).toBe('2040-03-10T04:00:00.000Z')
      expect(row.checklistTemplateId).toBeNull()
      expect((await tx.kit.findUniqueOrThrow({ where: { id: kit.id } })).status).toBe('AVAILABLE')

      const actions = (await tx.auditLog.findMany({ where: { entityType: 'Booking', entityId: booking.id }, orderBy: { createdAt: 'asc' } })).map((row) => row.action)
      expect(actions).toEqual(['BOOKING_CREATED', 'BOOKING_STATUS_CHANGED'])
      expect(await findOverlappingBookings(tx, kit.id, row.bookingStart, row.bookingEnd)).toHaveLength(1)
    })
  })

  it('refuses internal editors without a staff ID, inactive editors, removed editors and unknown editors', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const kit = await readyKit(tx, fx)

      const internalNoId = await makeEditor(tx, fx, { type: 'INTERNAL', company: undefined, department: 'Post' })
      await expect(createBooking(tx, fx.actor, input(fx, internalNoId.id, kit.id))).rejects.toMatchObject({
        code: 'lifecycle',
        fieldErrors: { editorId: expect.stringContaining('staff ID') },
      })
      const internalWithId = await makeEditor(tx, fx, { type: 'INTERNAL', company: undefined, staffId: `EDT-${tag()}` })
      expect((await createBooking(tx, fx.actor, input(fx, internalWithId.id, kit.id, { intent: 'draft' }))).status).toBe('DRAFT')

      const inactive = await makeEditor(tx, fx, { isActive: false })
      await expect(createBooking(tx, fx.actor, input(fx, inactive.id, kit.id))).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('inactive') })

      const removed = await makeEditor(tx, fx)
      await tx.editorProfile.update({ where: { id: removed.id }, data: { deletedAt: new Date() } })
      await expect(createBooking(tx, fx.actor, input(fx, removed.id, kit.id))).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('removed') })

      await expect(createBooking(tx, fx.actor, input(fx, 'no-such-editor', kit.id))).rejects.toMatchObject({ code: 'not_found' })
      await expect(createBooking(tx, fx.actor, input(fx, internalWithId.id, kit.id, { engineerId: 'no-such-engineer' }))).rejects.toMatchObject({ code: 'validation', fieldErrors: { engineerId: expect.any(String) } })
    })
  })

  it('refuses to reserve a kit that is not ready: damaged required equipment, active maintenance, retired kit', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const editor = await makeEditor(tx, fx)

      const damaged = await readyKit(tx, fx)
      await tx.asset.update({ where: { id: damaged.assetId }, data: { status: 'DAMAGED' } })
      await expect(createBooking(tx, fx.actor, input(fx, editor.id, damaged.id))).rejects.toMatchObject({
        code: 'lifecycle',
        message: expect.stringContaining(damaged.assetCode),
      })
      // A draft is still allowed - it holds nothing - but cannot be reserved later.
      const draft = await createBooking(tx, fx.actor, input(fx, editor.id, damaged.id, { intent: 'draft' }))
      await expect(reserveBooking(tx, fx.actor, draft.id)).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('not ready') })

      const maintained = await readyKit(tx, fx)
      await tx.maintenanceRecord.create({
        data: { maintenanceNumber: `MNT-TEST-${tag()}`, assetId: maintained.assetId, type: MaintenanceType.REPAIR, status: MaintenanceStatus.IN_PROGRESS, title: 'Fan', startedAt: new Date(), createdById: fx.admin.id },
      })
      await expect(createBooking(tx, fx.actor, input(fx, editor.id, maintained.id))).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('maintenance') })

      const retired = await readyKit(tx, fx)
      await tx.kit.update({ where: { id: retired.id }, data: { status: KitStatus.RETIRED } })
      await expect(createBooking(tx, fx.actor, input(fx, editor.id, retired.id, { intent: 'draft' }))).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('retired') })
      await expect(createBooking(tx, fx.actor, input(fx, editor.id, 'no-such-kit'))).rejects.toMatchObject({ code: 'not_found' })
    })
  })

  it('rejects impossible schedules before touching the number counter', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const editor = await makeEditor(tx, fx)
      const kit = await readyKit(tx, fx)
      const before = await tx.numberSequence.findUnique({ where: { scope_period: { scope: 'BOOKING', period: String(new Date().getUTCFullYear()) } } })

      await expect(createBooking(tx, fx.actor, input(fx, editor.id, kit.id, { bookingStart: local(12, 18), bookingEnd: local(10, 9) }))).rejects.toMatchObject({ code: 'validation', fieldErrors: { bookingEnd: expect.any(String) } })
      await expect(createBooking(tx, fx.actor, input(fx, editor.id, kit.id, { expectedReturnDate: local(13, 9) }))).rejects.toMatchObject({ code: 'validation', fieldErrors: { expectedReturnDate: expect.any(String) } })
      await expect(createBooking(tx, fx.actor, input(fx, editor.id, kit.id, { collectionDate: local(13, 9) }))).rejects.toMatchObject({ code: 'validation', fieldErrors: { collectionDate: expect.any(String) } })
      await expect(createBooking(tx, fx.actor, input(fx, editor.id, kit.id, { collectionDate: local(8, 9) }))).rejects.toMatchObject({ code: 'validation', fieldErrors: { collectionDate: expect.stringContaining('24 hours') } })
      await expect(createBooking(tx, fx.actor, input(fx, editor.id, kit.id, { collectionDate: local(10, 10), expectedReturnDate: local(10, 9) }))).rejects.toMatchObject({ code: 'validation', fieldErrors: { expectedReturnDate: expect.any(String) } })
      await expect(createBooking(tx, fx.actor, input(fx, editor.id, kit.id, { bookingStart: 'not-a-date' }))).rejects.toMatchObject({ code: 'validation', fieldErrors: { bookingStart: expect.any(String) } })

      const after = await tx.numberSequence.findUnique({ where: { scope_period: { scope: 'BOOKING', period: String(new Date().getUTCFullYear()) } } })
      expect(after?.current ?? null).toBe(before?.current ?? null)
    })
  })
})

describe('overlap and concurrency', () => {
  it('refuses overlapping reservations, allows back-to-back and cancelled ones, and drafts never block', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const editor = await makeEditor(tx, fx)
      const kit = await readyKit(tx, fx)

      const a = await createBooking(tx, fx.actor, input(fx, editor.id, kit.id))
      await expect(createBooking(tx, fx.actor, input(fx, editor.id, kit.id, { bookingStart: local(11, 9), bookingEnd: local(14, 9) }))).rejects.toMatchObject({
        code: 'conflict',
        message: expect.stringContaining(a.bookingNumber),
      })
      // Back to back - starting the instant the previous one ends - is fine (half-open window) ...
      const adjacent = await createBooking(tx, fx.actor, input(fx, editor.id, kit.id, { bookingStart: local(12, 18), bookingEnd: local(13, 18) }))
      expect(adjacent.status).toBe('RESERVED')
      // ... whereas one minute of shared time is not.
      await expect(createBooking(tx, fx.actor, input(fx, editor.id, kit.id, { bookingStart: '2040-03-12T17:59', bookingEnd: local(13, 12) }))).rejects.toMatchObject({ code: 'conflict' })
      // A draft over the same window is accepted and blocks nobody.
      const draft = await createBooking(tx, fx.actor, input(fx, editor.id, kit.id, { intent: 'draft' }))
      expect(draft.status).toBe('DRAFT')
      // Once A is cancelled its window is free again.
      await cancelBooking(tx, fx.actor, a.id, { reason: 'Client postponed' })
      const replacement = await createBooking(tx, fx.actor, input(fx, editor.id, kit.id))
      expect(replacement.status).toBe('RESERVED')
    })
  })

  it('lets the exclusion constraint settle a race and translates it into a friendly conflict', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const editor = await makeEditor(tx, fx)
      const kit = await readyKit(tx, fx)
      await createBooking(tx, fx.actor, input(fx, editor.id, kit.id))

      // The second operator whose pre-check passed before the first commit: write straight past the service.
      let failure: unknown = null
      try {
        await tx.booking.create({
          data: {
            bookingNumber: `BK-TEST-${tag()}`,
            kitId: kit.id,
            editorId: editor.id,
            engineerId: fx.engineerId,
            status: BookingStatus.RESERVED,
            bookingStart: zonedLocalToDate(local(11, 9), TZ)!,
            bookingEnd: zonedLocalToDate(local(14, 9), TZ)!,
            expectedReturnDate: zonedLocalToDate(local(14, 9), TZ)!,
            createdById: fx.admin.id,
          },
        })
      } catch (error) {
        failure = error
      }
      expect(failure).not.toBeNull()
      const translated = translateBookingDbError(failure)
      expect(translated).toBeInstanceOf(DomainError)
      expect(translated).toMatchObject({ code: 'conflict', message: expect.stringContaining('overlapping') })
      expect(translateBookingDbError(new Error('unrelated'))).toBeNull()
    })
  })
})

describe('listing, filters and scope', () => {
  it('searches by booking number, editor name, staff ID, kit code and kit barcode; filters, sorts and paginates', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const marker = tag()
      const externalEditor = await makeEditor(tx, fx, { fullName: `Quorvax ${marker}` })
      const internalEditor = await makeEditor(tx, fx, { type: 'INTERNAL', company: undefined, staffId: `EDT-${marker}` })
      const kitA = await readyKit(tx, fx)
      const kitB = await readyKit(tx, fx)
      const before = await countBookingsByFilter(tx, fx.actor, new Date(), TZ)

      const reserved = await createBooking(tx, fx.actor, input(fx, externalEditor.id, kitA.id))
      const draft = await createBooking(tx, fx.actor, input(fx, internalEditor.id, kitB.id, { intent: 'draft', bookingStart: local(20, 9), bookingEnd: local(21, 9) }))
      const cancelled = await createBooking(tx, fx.actor, input(fx, externalEditor.id, kitB.id, { bookingStart: local(1, 9), bookingEnd: local(2, 9) }))
      await cancelBooking(tx, fx.actor, cancelled.id, { reason: 'Test' })

      const now = new Date()
      const ids = async (query: Partial<Parameters<typeof listBookingsPage>[2]>) =>
        (await listBookingsPage(tx, fx.actor, { ...LIST, now, ...query })).rows.map((row) => row.id)

      expect(await ids({ search: reserved.bookingNumber.toLowerCase() })).toEqual([reserved.id])
      expect(await ids({ search: `quorvax ${marker}`.toLowerCase() })).toEqual([cancelled.id, reserved.id])
      expect(await ids({ search: `edt-${marker}` })).toEqual([draft.id])
      expect(await ids({ search: kitA.kitCode })).toEqual([reserved.id])
      expect(await ids({ search: `ADM-BKTKIT-${kitB.kitCode.slice(4)}` })).toEqual([cancelled.id, draft.id])

      expect(await ids({ filter: 'reserved', search: marker.slice(0, 0) + 'BKT-' })).toContain(reserved.id)
      expect(await ids({ filter: 'draft', search: 'BKT-' })).toEqual([draft.id])
      expect(await ids({ filter: 'cancelled', search: 'BKT-' })).toEqual([cancelled.id])
      expect(await ids({ filter: 'completed', search: 'BKT-' })).toEqual([])

      const page1 = await listBookingsPage(tx, fx.actor, { ...LIST, now, search: 'BKT-', pageSize: 2, page: 1 })
      const page2 = await listBookingsPage(tx, fx.actor, { ...LIST, now, search: 'BKT-', pageSize: 2, page: 2 })
      expect(page1).toMatchObject({ total: 3, pageCount: 2 })
      expect(page1.rows.map((row) => row.id)).toEqual([cancelled.id, reserved.id])
      expect(page2.rows.map((row) => row.id)).toEqual([draft.id])
      expect((await listBookingsPage(tx, fx.actor, { ...LIST, now, search: 'BKT-', sort: 'bookingNumber', direction: 'desc' })).rows[0].id).toBe(cancelled.id)

      const after = await countBookingsByFilter(tx, fx.actor, now, TZ)
      expect(after.all - before.all).toBe(3)
      expect(after.reserved - before.reserved).toBe(1)
      expect(after.draft - before.draft).toBe(1)
      expect(after.cancelled - before.cancelled).toBe(1)
    })
  })

  it('derives due-soon and overdue from the expected return of kits that are out', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const editor = await makeEditor(tx, fx)
      const now = new Date()
      const out = async (offsetHours: number) => {
        const kit = await readyKit(tx, fx)
        return tx.booking.create({
          data: {
            bookingNumber: `BK-TEST-${tag()}`,
            kitId: kit.id,
            editorId: editor.id,
            engineerId: fx.engineerId,
            status: BookingStatus.CHECKED_OUT,
            bookingStart: new Date(now.getTime() - 3 * DAY),
            bookingEnd: new Date(now.getTime() + 5 * DAY),
            collectionDate: new Date(now.getTime() - 3 * DAY),
            expectedReturnDate: new Date(now.getTime() + offsetHours * HOUR),
            createdById: fx.admin.id,
          },
          select: { id: true, status: true, expectedReturnDate: true },
        })
      }
      const dueSoon = await out(10)
      const overdue = await out(-2)
      const later = await out(100)

      const ids = async (filter: 'due-soon' | 'overdue' | 'checked-out') =>
        (await listBookingsPage(tx, fx.actor, { ...LIST, now, filter, search: 'BKT-' })).rows.map((row) => row.id)
      expect(await ids('due-soon')).toEqual([dueSoon.id])
      expect(await ids('overdue')).toEqual([overdue.id])
      expect((await ids('checked-out')).sort()).toEqual([dueSoon.id, overdue.id, later.id].sort())

      expect(bookingTimeState(dueSoon, now)).toEqual({ overdue: false, dueSoon: true })
      expect(bookingTimeState(overdue, now)).toEqual({ overdue: true, dueSoon: false })
      expect(bookingTimeState(later, now)).toEqual({ overdue: false, dueSoon: false })
      const counts = await countBookingsByFilter(tx, fx.actor, now, TZ)
      expect(counts.overdue).toBeGreaterThanOrEqual(1)
      expect(counts['due-soon']).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows an EDITOR their own booking only, and exposes no credentials or internal ids', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const me = await createTestUser(tx, { role: UserRole.EDITOR, withEditorProfile: true })
      const other = await createTestUser(tx, { role: UserRole.EDITOR, withEditorProfile: true })
      await tx.editorProfile.updateMany({ where: { id: { in: [me.editorProfileId!, other.editorProfileId!] } }, data: { staffId: undefined } })
      await tx.editorProfile.update({ where: { id: me.editorProfileId! }, data: { staffId: `EDT-${tag()}` } })
      await tx.editorProfile.update({ where: { id: other.editorProfileId! }, data: { staffId: `EDT-${tag()}` } })
      const kitA = await readyKit(tx, fx)
      const kitB = await readyKit(tx, fx)
      const mine = await createBooking(tx, fx.actor, input(fx, me.editorProfileId!, kitA.id))
      const theirs = await createBooking(tx, fx.actor, input(fx, other.editorProfileId!, kitB.id))

      const asMe = actorFor(me)
      expect((await listBookingsPage(tx, asMe, { ...LIST, now: new Date() })).rows.map((row) => row.id)).toEqual([mine.id])
      expect((await getBookingDetailForActor(tx, asMe, mine.id))?.bookingNumber).toBe(mine.bookingNumber)
      expect(await getBookingDetailForActor(tx, asMe, theirs.id)).toBeNull()
      // Search cannot reach out of the scope.
      expect((await listBookingsPage(tx, asMe, { ...LIST, now: new Date(), search: theirs.bookingNumber })).total).toBe(0)

      const texts = [
        JSON.stringify(await getBookingDetailForActor(tx, fx.actor, mine.id)),
        JSON.stringify(await listBookingsPage(tx, fx.actor, { ...LIST, now: new Date(), search: kitA.kitCode })),
        JSON.stringify(await getBookingActivity(tx, mine.id)),
      ]
      for (const text of texts) expect(text).not.toMatch(/passwordHash|sessionVersion|"email"|createdById|"userId"|editorId":/)
    })
  })
})

describe('editing, transitions and cancellation', () => {
  it('re-validates overlap and readiness when a reservation changes window or kit, and restricts ready bookings', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const editor = await makeEditor(tx, fx)
      const kit = await readyKit(tx, fx)
      const a = await createBooking(tx, fx.actor, input(fx, editor.id, kit.id))
      const b = await createBooking(tx, fx.actor, input(fx, editor.id, kit.id, { bookingStart: local(15, 9), bookingEnd: local(16, 18) }))
      const base = { editorId: editor.id, kitId: kit.id, engineerId: fx.engineerId, bookingStart: local(15, 9), bookingEnd: local(16, 18), collectionDate: undefined, expectedReturnDate: undefined, purpose: undefined, notes: undefined }

      // Moving B onto A's window is refused; moving it elsewhere is fine and audited.
      await expect(updateBooking(tx, fx.actor, b.id, { ...base, bookingStart: local(11, 9), bookingEnd: local(13, 9) })).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining(a.bookingNumber) })
      const moved = await updateBooking(tx, fx.actor, b.id, { ...base, bookingStart: local(20, 9), bookingEnd: local(22, 18), purpose: 'Moved' })
      expect(moved.changed).toEqual(expect.arrayContaining(['bookingStart', 'bookingEnd', 'expectedReturnDate', 'purpose']))
      const audit = await tx.auditLog.findFirst({ where: { entityType: 'Booking', entityId: b.id, action: 'BOOKING_UPDATED' } })
      expect(audit?.summary).toContain('schedule changed')
      expect(await updateBooking(tx, fx.actor, b.id, { ...base, bookingStart: local(20, 9), bookingEnd: local(22, 18), purpose: 'Moved' })).toEqual({ id: b.id, changed: [] })

      // A blocked kit cannot be swapped in.
      const damaged = await readyKit(tx, fx)
      await tx.asset.update({ where: { id: damaged.assetId }, data: { status: 'MISSING' } })
      await expect(updateBooking(tx, fx.actor, b.id, { ...base, kitId: damaged.id, bookingStart: local(20, 9), bookingEnd: local(22, 18), purpose: 'Moved' })).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining(damaged.assetCode) })

      // Ready for handover: engineer and notes only.
      await markReadyForHandover(tx, fx.actor, a.id)
      const aBase = { ...base, bookingStart: local(10, 9), bookingEnd: local(12, 18) }
      await expect(updateBooking(tx, fx.actor, a.id, { ...aBase, bookingEnd: local(12, 20) })).rejects.toMatchObject({ code: 'lifecycle', fieldErrors: { bookingEnd: expect.stringContaining('ready for handover') } })
      const noted = await updateBooking(tx, fx.actor, a.id, { ...aBase, notes: 'Bring the spare cable' })
      expect(noted.changed).toEqual(['notes'])

      // Completed bookings are read-only.
      await tx.booking.update({ where: { id: b.id }, data: { status: BookingStatus.COMPLETED } })
      await expect(updateBooking(tx, fx.actor, b.id, { ...base, notes: 'x' })).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('cannot be edited') })
    })
  })

  it('walks the explicit transitions: reserve, release, ready (kit set aside), revert, cancel (kit released)', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const editor = await makeEditor(tx, fx)
      const kit = await readyKit(tx, fx)
      const booking = await createBooking(tx, fx.actor, input(fx, editor.id, kit.id, { intent: 'draft' }))
      const status = async () => (await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { status: true } })).status
      const kitStatus = async () => (await tx.kit.findUniqueOrThrow({ where: { id: kit.id }, select: { status: true } })).status

      await expect(markReadyForHandover(tx, fx.actor, booking.id)).rejects.toMatchObject({ code: 'lifecycle' })
      await reserveBooking(tx, fx.actor, booking.id)
      expect(await status()).toBe('RESERVED')
      await expect(reserveBooking(tx, fx.actor, booking.id)).rejects.toMatchObject({ code: 'lifecycle' })

      await returnToDraft(tx, fx.actor, booking.id)
      expect(await status()).toBe('DRAFT')
      await reserveBooking(tx, fx.actor, booking.id)

      await markReadyForHandover(tx, fx.actor, booking.id)
      expect(await status()).toBe('READY_FOR_HANDOVER')
      expect(await kitStatus()).toBe('RESERVED')
      expect(await tx.auditLog.count({ where: { entityType: 'Kit', entityId: kit.id, action: 'KIT_STATUS_CHANGED' } })).toBe(1)

      await revertReadyForHandover(tx, fx.actor, booking.id)
      expect(await status()).toBe('RESERVED')
      expect(await kitStatus()).toBe('AVAILABLE')

      await markReadyForHandover(tx, fx.actor, booking.id)
      await expect(cancelBooking(tx, fx.actor, booking.id, { reason: 'Shoot cancelled' })).resolves.toBeUndefined()
      const row = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } })
      expect(row).toMatchObject({ status: 'CANCELLED', cancelReason: 'Shoot cancelled' })
      expect(row.cancelledAt).not.toBeNull()
      expect(await kitStatus()).toBe('AVAILABLE')
      expect(await tx.booking.count({ where: { id: booking.id } })).toBe(1)

      // Terminal: nothing moves a cancelled booking.
      await expect(cancelBooking(tx, fx.actor, booking.id, { reason: 'Again' })).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('already cancelled') })
      await expect(reserveBooking(tx, fx.actor, booking.id)).rejects.toMatchObject({ code: 'lifecycle' })
      // Out with the editor: not cancellable here.
      const out = await createBooking(tx, fx.actor, input(fx, editor.id, kit.id))
      await tx.booking.update({ where: { id: out.id }, data: { status: BookingStatus.CHECKED_OUT, collectionDate: new Date() } })
      await expect(cancelBooking(tx, fx.actor, out.id, { reason: 'No' })).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('return workflow') })

      const events = await getBookingActivity(tx, booking.id)
      const times = events.map((event) => event.at.getTime())
      expect(times).toEqual([...times].sort((x, y) => y - x))
      expect(events[0]).toMatchObject({ kind: 'cancelled', detail: 'Shoot cancelled', actorName: fx.admin.name })
      expect(events.at(-1)?.kind).toBe('created')
      expect(events.map((event) => event.kind)).toEqual(expect.arrayContaining(['created', 'status', 'cancelled']))
      expect(events.every((event) => !event.title.startsWith('{'))).toBe(true)
      const actions = (await tx.auditLog.findMany({ where: { entityType: 'Booking', entityId: booking.id } })).map((row) => row.action)
      expect(actions).toEqual(expect.arrayContaining(['BOOKING_CREATED', 'BOOKING_STATUS_CHANGED', 'BOOKING_CANCELLED']))
    })
  })
})
