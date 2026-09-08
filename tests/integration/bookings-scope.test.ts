import { randomUUID } from 'node:crypto'

import { BookingStatus, UserRole } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ForbiddenError } from '@/server/auth/errors'
import { getBookingForActor, listBookingsForActor, visibilityFor } from '@/server/dal/bookings.dal'

import { actorFor, createTestUser, deleteTestUsers, testDb, type TestUser } from '../helpers/db'

/**
 * Data scoping for EDITOR: own bookings only, enforced in the DAL query. Uses
 * the seeded kit MBP-02 and engineer profile; creates two editors with one
 * DRAFT booking each (DRAFT bookings do not hold the kit, so the overlap
 * constraint is not in play).
 */

let editorA: TestUser
let editorB: TestUser
let editorNoProfile: TestUser
let engineer: TestUser
let viewer: TestUser
let bookingA: string
let bookingB: string

beforeAll(async () => {
  const kit = await testDb.kit.findUniqueOrThrow({ where: { kitCode: 'MBP-02' }, select: { id: true } })
  const engineerProfile = await testDb.engineerProfile.findFirstOrThrow({ select: { id: true } })

  editorA = await createTestUser(testDb, { role: UserRole.EDITOR, withEditorProfile: true, tag: 'editor-a' })
  editorB = await createTestUser(testDb, { role: UserRole.EDITOR, withEditorProfile: true, tag: 'editor-b' })
  editorNoProfile = await createTestUser(testDb, { role: UserRole.EDITOR, tag: 'editor-none' })
  engineer = await createTestUser(testDb, { role: UserRole.ENGINEER })
  viewer = await createTestUser(testDb, { role: UserRole.VIEWER })

  const year = 2040
  async function draftBooking(editorProfileId: string, month: number): Promise<string> {
    const booking = await testDb.booking.create({
      data: {
        bookingNumber: `BK-TEST-${randomUUID().slice(0, 12)}`,
        kitId: kit.id,
        editorId: editorProfileId,
        engineerId: engineerProfile.id,
        status: BookingStatus.DRAFT,
        bookingStart: new Date(Date.UTC(year, month, 1, 8)),
        bookingEnd: new Date(Date.UTC(year, month, 5, 17)),
        expectedReturnDate: new Date(Date.UTC(year, month, 5, 17)),
        createdById: engineer.id,
      },
      select: { id: true },
    })
    return booking.id
  }

  bookingA = await draftBooking(editorA.editorProfileId!, 0)
  bookingB = await draftBooking(editorB.editorProfileId!, 1)
})

afterAll(async () => {
  await deleteTestUsers(testDb, [editorA, editorB, editorNoProfile, engineer, viewer])
  await testDb.$disconnect()
})

describe('booking visibility', () => {
  it('an EDITOR lists only bookings made in their name', async () => {
    const bookings = await listBookingsForActor(testDb, actorFor(editorA))
    expect(bookings.map((booking) => booking.id)).toEqual([bookingA])
  })

  it('an EDITOR can read their own booking', async () => {
    const booking = await getBookingForActor(testDb, actorFor(editorA), bookingA)
    expect(booking?.id).toBe(bookingA)
    expect(booking?.editor?.id).toBe(editorA.editorProfileId)
  })

  it("an EDITOR cannot read another editor's booking - it is simply not found", async () => {
    expect(await getBookingForActor(testDb, actorFor(editorA), bookingB)).toBeNull()
    expect(await getBookingForActor(testDb, actorFor(editorB), bookingA)).toBeNull()
  })

  it('an EDITOR without an editor profile sees nothing at all', async () => {
    expect(await listBookingsForActor(testDb, actorFor(editorNoProfile))).toEqual([])
    expect(await getBookingForActor(testDb, actorFor(editorNoProfile), bookingA)).toBeNull()
  })

  it('ENGINEER and VIEWER see every booking', async () => {
    for (const user of [engineer, viewer]) {
      const ids = (await listBookingsForActor(testDb, actorFor(user))).map((booking) => booking.id)
      expect(ids).toEqual(expect.arrayContaining([bookingA, bookingB]))
      expect(await getBookingForActor(testDb, actorFor(user), bookingB)).not.toBeNull()
    }
  })

  it('search and quick filters are additional terms inside the actor scope, never a way out of it', async () => {
    const [rowA, rowB] = await Promise.all([
      testDb.booking.findUniqueOrThrow({ where: { id: bookingA }, select: { bookingNumber: true } }),
      testDb.booking.findUniqueOrThrow({ where: { id: bookingB }, select: { bookingNumber: true } }),
    ])

    // Editor A searching for editor B's booking number finds nothing.
    expect(await listBookingsForActor(testDb, actorFor(editorA), { search: rowB.bookingNumber })).toEqual([])
    // ... but finds their own, case-insensitively.
    const own = await listBookingsForActor(testDb, actorFor(editorA), { search: rowA.bookingNumber.toLowerCase() })
    expect(own.map((booking) => booking.id)).toEqual([bookingA])

    // An engineer sees both by kit code.
    const byKit = await listBookingsForActor(testDb, actorFor(engineer), { search: 'MBP-02' })
    expect(byKit.map((booking) => booking.id)).toEqual(expect.arrayContaining([bookingA, bookingB]))

    // Quick filters: both fixtures are DRAFT, so status filters exclude them.
    expect(await listBookingsForActor(testDb, actorFor(engineer), { filter: 'reserved' })).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: bookingA })]),
    )
    expect(await listBookingsForActor(testDb, actorFor(engineer), { filter: 'overdue' })).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: bookingA })]),
    )
    // "Today" for a far-future now excludes them too; "all" keeps them.
    const farFuture = new Date('2090-01-01T00:00:00.000Z')
    expect(await listBookingsForActor(testDb, actorFor(engineer), { filter: 'today', now: farFuture })).toEqual([])
    const all = await listBookingsForActor(testDb, actorFor(engineer), { filter: 'all' })
    expect(all.map((booking) => booking.id)).toEqual(expect.arrayContaining([bookingA, bookingB]))
  })

  it('an actor with neither booking permission is refused with ForbiddenError (fail closed)', () => {
    // Every real role holds booking.read or booking.readOwn, so simulate a
    // role the matrix does not know. It must grant nothing, not crash.
    const stranger = actorFor(engineer, { role: 'NOBODY' as never })
    expect(() => visibilityFor(stranger)).toThrow(ForbiddenError)
  })
})
