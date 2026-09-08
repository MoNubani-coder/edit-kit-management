import { describe, expect, it } from 'vitest'

import { requesterOf, UNNAMED_REQUESTER } from '@/lib/booking-requester'
import { createBookingSchema, updateBookingSchema } from '@/lib/validation/bookings'

/**
 * Who a booking is for, and what a request is allowed to say about it.
 *
 * A booking now carries the requester as typed data. Two things have to hold
 * everywhere: an older booking that only points at a directory profile still
 * reads, and nothing a client posts can decide who prepared the booking or
 * which engineer it belongs to.
 */

describe('the requester of a booking', () => {
  it('prefers what the booking itself records', () => {
    expect(
      requesterOf({
        requesterName: 'Layla Haddad',
        requesterStaffId: 'ADM-4821',
        requesterMobile: '+971 50 111 2222',
        projectName: 'Ramadan promo',
        workOrder: 'WO-2026-118',
        editor: { fullName: 'Someone Else', staffId: 'OLD-1', contactNumber: '+971 50 000 0000', isExternal: true },
      }),
    ).toEqual({
      name: 'Layla Haddad',
      staffId: 'ADM-4821',
      mobile: '+971 50 111 2222',
      projectName: 'Ramadan promo',
      workOrder: 'WO-2026-118',
      source: 'booking',
      isExternal: true,
    })
  })

  it('falls back to the linked profile, so historical bookings still read', () => {
    const requester = requesterOf({ editor: { fullName: 'Omar Faris', staffId: 'ADM-2201', contactNumber: '+971 55 909 1234', isExternal: false } })
    expect(requester).toMatchObject({ name: 'Omar Faris', staffId: 'ADM-2201', mobile: '+971 55 909 1234', source: 'profile', isExternal: false })
  })

  it('never renders a blank where a name belongs', () => {
    expect(requesterOf({})).toMatchObject({ name: UNNAMED_REQUESTER, staffId: null, mobile: null, source: 'profile', isExternal: null })
  })

  it('reads a staff ID or mobile from the profile when the booking left them out', () => {
    const requester = requesterOf({ requesterName: 'Nadia Kamal', editor: { fullName: 'Nadia K', staffId: 'ADM-77', contactNumber: '+971 50 222 3333' } })
    expect(requester).toMatchObject({ name: 'Nadia Kamal', staffId: 'ADM-77', mobile: '+971 50 222 3333', source: 'booking' })
  })
})

describe('what a booking form may say', () => {
  const base = {
    kitId: 'kit-1',
    bookingStart: '2041-05-10T09:00',
    bookingEnd: '2041-05-12T18:00',
    requesterName: 'Layla Haddad',
    requesterMobile: '+971 50 111 2222',
    projectName: 'Ramadan promo',
    workOrder: 'WO-2026-118',
  }

  it('accepts a booking for someone with no profile at all', () => {
    const parsed = createBookingSchema.safeParse(base)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.editorId).toBeUndefined()
      expect(parsed.data).toMatchObject({ requesterName: 'Layla Haddad', projectName: 'Ramadan promo', workOrder: 'WO-2026-118' })
    }
  })

  it('leaves the staff ID optional, for someone from outside', () => {
    expect(createBookingSchema.safeParse({ ...base, requesterStaffId: undefined }).success).toBe(true)
  })

  it('insists on a name, a mobile, a project and a work order when no profile is chosen', () => {
    const parsed = createBookingSchema.safeParse({ kitId: 'kit-1', bookingStart: base.bookingStart, bookingEnd: base.bookingEnd })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.join('.'))
      expect(paths).toEqual(expect.arrayContaining(['requesterName', 'requesterMobile', 'projectName', 'workOrder']))
    }
  })

  it('still accepts a legacy booking made against a directory profile', () => {
    expect(createBookingSchema.safeParse({ kitId: 'kit-1', editorId: 'editor-1', bookingStart: base.bookingStart, bookingEnd: base.bookingEnd }).success).toBe(true)
  })

  it('drops anything a client posts about who prepared it or which engineer it is', () => {
    const parsed = createBookingSchema.safeParse({
      ...base,
      engineerId: 'engineer-profile-of-someone-else',
      createdById: 'another-user',
      preparedBy: 'Mr Nobody',
      status: 'CHECKED_OUT',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty('engineerId')
      expect(parsed.data).not.toHaveProperty('createdById')
      expect(parsed.data).not.toHaveProperty('preparedBy')
      expect(parsed.data).not.toHaveProperty('status')
    }
  })

  it('will not change a booking without a reason', () => {
    const without = updateBookingSchema.safeParse({ ...base, id: 'booking-1' })
    expect(without.success).toBe(false)
    if (!without.success) expect(without.error.issues.some((issue) => issue.path.join('.') === 'reason')).toBe(true)

    expect(updateBookingSchema.safeParse({ ...base, reason: 'ok' }).success).toBe(false)
    expect(updateBookingSchema.safeParse({ ...base, reason: 'Editor asked for a later collection' }).success).toBe(true)
  })
})
