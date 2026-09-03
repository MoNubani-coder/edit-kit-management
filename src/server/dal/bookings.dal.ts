import 'server-only'

import type { BookingStatus, Prisma } from '@prisma/client'

import { ForbiddenError } from '@/server/auth/errors'
import { can } from '@/server/auth/permissions'
import type { Actor } from '@/server/auth/session'
import type { Db } from '@/server/db/prisma'

/**
 * Booking reads, scoped to the actor.
 *
 * This is where "an EDITOR sees only their own bookings" is enforced: as a
 * `where` clause derived from the actor, not as a filter applied in a page.
 * Every read goes through `visibilityFor`, so there is no way to list or fetch
 * a booking the actor may not see.
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

export async function listBookingsForActor(db: Db, actor: Actor): Promise<BookingSummary[]> {
  return db.booking.findMany({
    where: visibilityFor(actor),
    select: summarySelect,
    orderBy: [{ bookingStart: 'desc' }],
    take: 100,
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
