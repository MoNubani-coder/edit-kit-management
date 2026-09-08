/**
 * Who a booking is for, read the same way everywhere.
 *
 * Two generations of booking coexist. Older ones point at an EditorProfile;
 * newer ones carry the requester as typed booking data (name, staff ID,
 * mobile, project, work order). Every list, panel, document and report asks
 * this one function rather than reaching for `booking.editor.fullName`, which
 * is null on a new booking.
 *
 * Booking data wins over the profile when both exist, because the booking's
 * copy is what was true when it was made and never changes afterwards.
 * Pure: no Prisma, no server-only, usable in client components.
 */

export interface RequesterSource {
  requesterName?: string | null
  requesterStaffId?: string | null
  requesterMobile?: string | null
  projectName?: string | null
  workOrder?: string | null
  editor?: { fullName: string; staffId?: string | null; contactNumber?: string | null; isExternal?: boolean } | null
}

export interface Requester {
  name: string
  staffId: string | null
  mobile: string | null
  projectName: string | null
  workOrder: string | null
  /** `profile` when only a directory entry names the person; `booking` when the booking carries its own copy. */
  source: 'booking' | 'profile'
  /** Known only for profile-backed bookings; a typed requester has no such flag. */
  isExternal: boolean | null
}

export const UNNAMED_REQUESTER = 'Unnamed requester'

export function requesterOf(booking: RequesterSource): Requester {
  const profile = booking.editor ?? null
  const fromBooking = Boolean(booking.requesterName)
  return {
    name: booking.requesterName ?? profile?.fullName ?? UNNAMED_REQUESTER,
    staffId: booking.requesterStaffId ?? profile?.staffId ?? null,
    mobile: booking.requesterMobile ?? profile?.contactNumber ?? null,
    projectName: booking.projectName ?? null,
    workOrder: booking.workOrder ?? null,
    source: fromBooking ? 'booking' : 'profile',
    isExternal: profile?.isExternal ?? null,
  }
}
