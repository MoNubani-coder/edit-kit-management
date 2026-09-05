import 'server-only'

import { BookingStatus, type Prisma } from '@prisma/client'

import { businessDayRange, DEFAULT_TIME_ZONE } from '@/lib/datetime'
import { ForbiddenError } from '@/server/auth/errors'
import { can } from '@/server/auth/permissions'
import type { Actor } from '@/server/auth/session'
import { OUT_STATUSES, overdueWhere } from '@/server/dal/dashboard.dal'
import type { Db } from '@/server/db/prisma'

/**
 * Booking reads, scoped to the actor.
 *
 * This is where "an EDITOR sees only their own bookings" is enforced: as a
 * `where` clause derived from the actor, not as a filter applied in a page.
 * Every read goes through `visibilityFor`, so there is no way to list or fetch
 * a booking the actor may not see. Search and quick filters are additional
 * `AND` terms on top of that scope, never a replacement for it.
 *
 * Object-level misses return `null` rather than throwing, so a guessed booking
 * id reveals nothing about whether it exists.
 */

export interface BookingSummary {
  id: string
  bookingNumber: string
  status: BookingStatus
  bookingStart: Date
  bookingEnd: Date
  expectedReturnDate: Date
  kit: { id: string; kitCode: string; name: string }
  editor: { id: string; fullName: string }
  engineer: { id: string; fullName: string }
}

const summarySelect = {
  id: true,
  bookingNumber: true,
  status: true,
  bookingStart: true,
  bookingEnd: true,
  expectedReturnDate: true,
  kit: { select: { id: true, kitCode: true, name: true } },
  editor: { select: { id: true, fullName: true } },
  engineer: { select: { id: true, fullName: true } },
} satisfies Prisma.BookingSelect

/**
 * The `where` fragment expressing what the actor may see.
 *
 *  - `booking.read`     -> every live booking
 *  - `booking.readOwn`  -> bookings whose editor profile belongs to the actor;
 *                          an EDITOR with no profile sees nothing (fail closed)
 *  - neither            -> ForbiddenError
 */
export function visibilityFor(actor: Actor): Prisma.BookingWhereInput {
  if (can(actor, 'booking.read')) {
    return { deletedAt: null }
  }

  if (can(actor, 'booking.readOwn')) {
    // A user without an editor profile has no bookings of their own. An
    // impossible id keeps the query shape identical and guarantees zero rows.
    return { deletedAt: null, editorId: actor.editorProfileId ?? '__no-editor-profile__' }
  }

  throw new ForbiddenError('You do not have permission to view bookings.', 'booking.read')
}

// -----------------------------------------------------------------------------
// List filters
// -----------------------------------------------------------------------------

export const BOOKING_LIST_FILTERS = ['all', 'today', 'reserved', 'checked-out', 'due-soon', 'overdue'] as const
export type BookingListFilter = (typeof BOOKING_LIST_FILTERS)[number]

export const BOOKING_FILTER_LABELS: Record<BookingListFilter, string> = {
  all: 'All',
  today: 'Today',
  reserved: 'Reserved',
  'checked-out': 'Checked out',
  'due-soon': 'Due soon',
  overdue: 'Overdue',
}

export function parseBookingListFilter(value: unknown): BookingListFilter {
  return typeof value === 'string' && (BOOKING_LIST_FILTERS as readonly string[]).includes(value)
    ? (value as BookingListFilter)
    : 'all'
}

const DUE_SOON_HOURS = 48
const MAX_SEARCH_LENGTH = 100

export interface BookingListOptions {
  /** Free text matched against booking number, kit code, kit name and editor. */
  search?: string
  filter?: BookingListFilter
  now?: Date
  timeZone?: string
  limit?: number
}

function filterWhere(filter: BookingListFilter, now: Date, timeZone: string): Prisma.BookingWhereInput | null {
  switch (filter) {
    case 'today': {
      const today = businessDayRange(now, timeZone)
      const inToday = { gte: today.start, lt: today.end }
      return {
        status: { not: BookingStatus.CANCELLED },
        OR: [{ bookingStart: inToday }, { expectedReturnDate: inToday }],
      }
    }
    case 'reserved':
      return { status: { in: [BookingStatus.RESERVED, BookingStatus.READY_FOR_HANDOVER] } }
    case 'checked-out':
      return { status: { in: [BookingStatus.CHECKED_OUT, BookingStatus.RETURN_INSPECTION] } }
    case 'due-soon':
      return {
        status: { in: [...OUT_STATUSES] },
        expectedReturnDate: { gte: now, lt: new Date(now.getTime() + DUE_SOON_HOURS * 60 * 60 * 1000) },
      }
    case 'overdue':
      return overdueWhere(now)
    default:
      return null
  }
}

function searchWhere(search: string): Prisma.BookingWhereInput | null {
  const term = search.trim().slice(0, MAX_SEARCH_LENGTH)
  if (!term) return null
  const contains = { contains: term, mode: 'insensitive' as const }
  return {
    OR: [
      { bookingNumber: contains },
      { kit: { kitCode: contains } },
      { kit: { name: contains } },
      { editor: { fullName: contains } },
    ],
  }
}

export async function listBookingsForActor(
  db: Db,
  actor: Actor,
  options: BookingListOptions = {},
): Promise<BookingSummary[]> {
  const now = options.now ?? new Date()
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE
  const terms: Prisma.BookingWhereInput[] = [visibilityFor(actor)]

  const byFilter = filterWhere(options.filter ?? 'all', now, timeZone)
  if (byFilter) terms.push(byFilter)

  const bySearch = options.search ? searchWhere(options.search) : null
  if (bySearch) terms.push(bySearch)

  return db.booking.findMany({
    where: { AND: terms },
    select: summarySelect,
    orderBy: [{ bookingStart: 'desc' }],
    take: options.limit ?? 100,
  })
}

export async function getBookingForActor(
  db: Db,
  actor: Actor,
  bookingId: string,
): Promise<BookingSummary | null> {
  return db.booking.findFirst({
    where: { AND: [{ id: bookingId }, visibilityFor(actor)] },
    select: summarySelect,
  })
}
