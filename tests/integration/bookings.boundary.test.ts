import { randomUUID } from 'node:crypto'

import { BookingStatus, UserRole } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

import { rangesOverlap } from '@/lib/booking-rules'
import { zonedLocalToDate } from '@/lib/datetime'
import { findOverlappingBookings } from '@/server/dal/bookings.dal'
import { createAsset } from '@/server/services/assets.service'
import { createBooking } from '@/server/services/bookings.service'
import { createEditor } from '@/server/services/editors.service'
import { addKitAsset, createKit } from '@/server/services/kits.service'

import { actorFor, createTestUser, testDb, withRollback } from '../helpers/db'

/**
 * The exact adjacent-booking requirement, for one kit:
 *
 *   Booking A  10:00 -> 12:00
 *   Booking B  12:00 -> 14:00
 *
 * Both must be allowed and must not be considered overlapping - half-open
 * [start, end) semantics - by the service pre-check, by the pure rule and by
 * the database exclusion constraint itself (a direct insert that bypasses the
 * service). Bookings that genuinely share time are still refused everywhere.
 */

const TZ = 'Asia/Dubai'
const tag = () => randomUUID().slice(0, 8).toUpperCase()
const at = (hour: number) => `2041-03-10T${String(hour).padStart(2, '0')}:00`

afterAll(async () => {
  await testDb.$disconnect()
})

describe('adjacent bookings on one kit', () => {
  it('rangesOverlap treats a shared boundary instant as free', () => {
    const a = [new Date('2041-03-10T06:00Z'), new Date('2041-03-10T08:00Z')] as const
    expect(rangesOverlap(...a, new Date('2041-03-10T08:00Z'), new Date('2041-03-10T10:00Z'))).toBe(false)
    expect(rangesOverlap(...a, new Date('2041-03-10T04:00Z'), new Date('2041-03-10T06:00Z'))).toBe(false)
    expect(rangesOverlap(...a, new Date('2041-03-10T07:59Z'), new Date('2041-03-10T10:00Z'))).toBe(true)
    expect(rangesOverlap(...a, new Date('2041-03-10T04:00Z'), new Date('2041-03-10T06:01Z'))).toBe(true)
  })

  it('allows A 10:00-12:00 and B 12:00-14:00 through the service, the pre-check and the database', async () => {
    await withRollback(async (tx) => {
      const admin = await createTestUser(tx, { role: UserRole.ADMIN })
      const actor = actorFor(admin)
      const engineer = await tx.engineerProfile.findFirstOrThrow({ select: { id: true } })
      const category = await tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' }, select: { id: true } })
      const t = tag()
      const kit = await createKit(tx, actor, { kitCode: `BND-${t}`, name: `Boundary kit ${t}`, admBarcode: undefined, description: undefined, location: undefined, notes: undefined, suitcaseStatus: 'GOOD', status: 'AVAILABLE' })
      const asset = await createAsset(tx, actor, { name: `Boundary asset ${t}`, categoryId: category.id, manufacturer: 'Testco', model: 'X', serialNumber: `SN-BND-${t}`, admBarcode: `ADM-BND-${t}`, location: undefined, notes: undefined, status: 'AVAILABLE' })
      await addKitAsset(tx, actor, kit.id, { assetId: asset.id, slotLabel: undefined, isRequired: true })
      const editor = await createEditor(tx, actor, { fullName: `Boundary Editor ${t}`, staffId: undefined, email: undefined, contactNumber: undefined, department: undefined, company: 'Freelance', type: 'EXTERNAL', notes: undefined, userId: undefined, isActive: true })
      const base = { editorId: editor.id, kitId: kit.id, engineerId: engineer.id, collectionDate: undefined, expectedReturnDate: undefined, purpose: undefined, notes: undefined, intent: 'reserve' as const }

      // A: 10:00 -> 12:00
      const a = await createBooking(tx, actor, { ...base, bookingStart: at(10), bookingEnd: at(12) })
      expect(a.status).toBe('RESERVED')

      // The pre-check sees no conflict for 12:00 -> 14:00 ...
      expect(await findOverlappingBookings(tx, kit.id, zonedLocalToDate(at(12), TZ)!, zonedLocalToDate(at(14), TZ)!)).toEqual([])
      // ... nor for 08:00 -> 10:00 ...
      expect(await findOverlappingBookings(tx, kit.id, zonedLocalToDate(at(8), TZ)!, zonedLocalToDate(at(10), TZ)!)).toEqual([])
      // ... but does for 11:00 -> 13:00.
      expect(await findOverlappingBookings(tx, kit.id, zonedLocalToDate(at(11), TZ)!, zonedLocalToDate(at(13), TZ)!)).toHaveLength(1)

      // B: 12:00 -> 14:00 through the service.
      const b = await createBooking(tx, actor, { ...base, bookingStart: at(12), bookingEnd: at(14) })
      expect(b.status).toBe('RESERVED')

      // C: 08:00 -> 10:00 written straight past the service - the constraint itself must allow it.
      const c = await tx.booking.create({
        data: {
          bookingNumber: `BK-TEST-${tag()}`,
          kitId: kit.id,
          editorId: editor.id,
          engineerId: engineer.id,
          status: BookingStatus.RESERVED,
          bookingStart: zonedLocalToDate(at(8), TZ)!,
          bookingEnd: zonedLocalToDate(at(10), TZ)!,
          expectedReturnDate: zonedLocalToDate(at(10), TZ)!,
          createdById: admin.id,
        },
        select: { id: true },
      })
      expect(c.id).toBeTruthy()
      expect(await tx.booking.count({ where: { kitId: kit.id, status: 'RESERVED' } })).toBe(3)

      // A genuine overlap (11:00 -> 13:00) is still refused - by the service ...
      await expect(createBooking(tx, actor, { ...base, bookingStart: at(11), bookingEnd: at(13) })).rejects.toMatchObject({ code: 'conflict' })
      // ... and, bypassing it, by the database (last statement: it aborts the transaction).
      await expect(
        tx.booking.create({
          data: {
            bookingNumber: `BK-TEST-${tag()}`,
            kitId: kit.id,
            editorId: editor.id,
            engineerId: engineer.id,
            status: BookingStatus.RESERVED,
            bookingStart: zonedLocalToDate(at(11), TZ)!,
            bookingEnd: zonedLocalToDate(at(13), TZ)!,
            expectedReturnDate: zonedLocalToDate(at(13), TZ)!,
            createdById: admin.id,
          },
        }),
      ).rejects.toThrow()
    })
  })
})
