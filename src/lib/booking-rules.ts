/**
 * Booking lifecycle and time rules - pure, framework-free, shared by the DAL,
 * the service, the dashboard and the tests. Status values are the literal
 * strings of the Prisma `BookingStatus` enum so this module runs anywhere.
 */

export const BOOKING_STATUSES = [
  'DRAFT',
  'RESERVED',
  'READY_FOR_HANDOVER',
  'CHECKED_OUT',
  'OVERDUE',
  'RETURN_INSPECTION',
  'COMPLETED',
  'CANCELLED',
] as const
export type BookingStatusValue = (typeof BOOKING_STATUSES)[number]

export const BOOKING_STATUS_LABELS: Record<BookingStatusValue, string> = {
  DRAFT: 'Draft',
  RESERVED: 'Reserved',
  READY_FOR_HANDOVER: 'Ready for handover',
  CHECKED_OUT: 'Checked out',
  OVERDUE: 'Overdue',
  RETURN_INSPECTION: 'Return inspection',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

/**
 * Statuses that hold the kit - exactly the set the database exclusion
 * constraint `bookings_no_overlapping_period_per_kit` applies to. A DRAFT
 * does not hold the kit; a CANCELLED or COMPLETED booking has released it.
 */
export const HOLDING_STATUSES = ['RESERVED', 'READY_FOR_HANDOVER', 'CHECKED_OUT', 'OVERDUE', 'RETURN_INSPECTION'] as const satisfies readonly BookingStatusValue[]

/** The kit is physically out of the store. */
export const OUT_STATUSES = ['CHECKED_OUT', 'OVERDUE'] as const satisfies readonly BookingStatusValue[]

/**
 * Manual transitions Phase 7 performs. CHECKED_OUT and beyond belong to the
 * handover and return workflows (Phases 8 and 9); COMPLETED and CANCELLED are
 * terminal.
 */
export const MANUAL_TRANSITIONS: Record<BookingStatusValue, readonly BookingStatusValue[]> = {
  DRAFT: ['RESERVED', 'CANCELLED'],
  RESERVED: ['DRAFT', 'READY_FOR_HANDOVER', 'CANCELLED'],
  READY_FOR_HANDOVER: ['RESERVED', 'CANCELLED'],
  CHECKED_OUT: [],
  OVERDUE: [],
  RETURN_INSPECTION: [],
  COMPLETED: [],
  CANCELLED: [],
}

export function canTransition(from: BookingStatusValue, to: BookingStatusValue): boolean {
  return MANUAL_TRANSITIONS[from].includes(to)
}

export function isHoldingStatus(status: BookingStatusValue): boolean {
  return (HOLDING_STATUSES as readonly string[]).includes(status)
}

/** How much of a booking may be edited in its current status. */
export type EditScope = 'full' | 'restricted' | 'none'

/**
 *  - `full`: editor, kit, schedule, engineer, purpose and notes (DRAFT, RESERVED;
 *    a reservation is revalidated for overlap and readiness).
 *  - `restricted`: engineer, purpose and notes only (READY_FOR_HANDOVER - the
 *    kit is set aside against this booking).
 *  - `none`: the booking is out, being returned, completed or cancelled.
 */
export function editScopeFor(status: BookingStatusValue): EditScope {
  if (status === 'DRAFT' || status === 'RESERVED') return 'full'
  if (status === 'READY_FOR_HANDOVER') return 'restricted'
  return 'none'
}

export function isCancellable(status: BookingStatusValue): boolean {
  return canTransition(status, 'CANCELLED')
}

// -----------------------------------------------------------------------------
// Time
// -----------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000

/**
 * Overdue is derived, never stored ahead of time: a kit that is out and past
 * its expected return, or a booking the return workflow has already marked
 * OVERDUE. `now` is an instant; the business time zone only matters for how it
 * is displayed. The dashboard's `overdueWhere` is the SQL form of this rule.
 */
export function isBookingOverdue(status: BookingStatusValue, expectedReturnDate: Date, now: Date): boolean {
  if (status === 'OVERDUE') return true
  return status === 'CHECKED_OUT' && expectedReturnDate.getTime() < now.getTime()
}

/** `[now, now + hours)` - the window the "Due soon" filter and the dashboard share. */
export function dueSoonWindow(now: Date, hours: number): { from: Date; to: Date } {
  return { from: now, to: new Date(now.getTime() + hours * HOUR_MS) }
}

export function isDueSoon(status: BookingStatusValue, expectedReturnDate: Date, now: Date, hours: number): boolean {
  if (!(OUT_STATUSES as readonly string[]).includes(status)) return false
  const { from, to } = dueSoonWindow(now, hours)
  return expectedReturnDate.getTime() >= from.getTime() && expectedReturnDate.getTime() < to.getTime()
}

/**
 * The booking window is half-open, [start, end): the kit is held from the
 * start instant up to, but not including, the end instant - the same
 * `tstzrange(bookingStart, bookingEnd, '[)')` the database exclusion constraint
 * uses. Two bookings that meet at one instant (10:00-12:00 and 12:00-14:00)
 * are adjacent, not overlapping; any shared moment is an overlap.
 */
export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime()
}

// -----------------------------------------------------------------------------
// Schedule
// -----------------------------------------------------------------------------

export interface BookingSchedule {
  bookingStart: Date
  bookingEnd: Date
  collectionDate: Date | null
  expectedReturnDate: Date
}

/** How early before the booking start a collection may be planned. */
export const COLLECTION_LEAD_HOURS = 24

/** Field errors for an impossible schedule; empty when it is consistent. */
export function scheduleErrors(schedule: BookingSchedule): Record<string, string> {
  const errors: Record<string, string> = {}
  const { bookingStart, bookingEnd, collectionDate, expectedReturnDate } = schedule

  if (bookingEnd.getTime() <= bookingStart.getTime()) errors.bookingEnd = 'The booking must end after it starts.'

  if (collectionDate) {
    if (collectionDate.getTime() < bookingStart.getTime() - COLLECTION_LEAD_HOURS * HOUR_MS)
      errors.collectionDate = `Collection can be planned at most ${COLLECTION_LEAD_HOURS} hours before the booking starts.`
    else if (collectionDate.getTime() > bookingEnd.getTime()) errors.collectionDate = 'Collection cannot be after the booking ends.'
  }

  const earliestReturn = collectionDate ?? bookingStart
  if (expectedReturnDate.getTime() < earliestReturn.getTime())
    errors.expectedReturnDate = collectionDate ? 'The expected return cannot be before collection.' : 'The expected return cannot be before the booking starts.'
  else if (expectedReturnDate.getTime() > bookingEnd.getTime()) errors.expectedReturnDate = 'The expected return cannot be after the booking ends.'

  return errors
}

// -----------------------------------------------------------------------------
// Editor eligibility
// -----------------------------------------------------------------------------

export interface BookableEditorFacts {
  fullName: string
  staffId: string | null
  isExternal: boolean
  isActive: boolean
  deleted: boolean
}

/**
 * Why the editor cannot receive a new booking, or null. External editors may
 * have no staff ID (Phase 7 decision); internal editors must, because it is
 * what the handover document and the account link key on.
 */
export function editorBookingBlocker(editor: BookableEditorFacts): string | null {
  if (editor.deleted) return `${editor.fullName} has been removed from the editor directory.`
  if (!editor.isActive) return `${editor.fullName} is inactive and cannot receive new bookings.`
  if (!editor.isExternal && !editor.staffId) return `${editor.fullName} is an internal editor without a staff ID. Add the staff ID before booking.`
  return null
}
