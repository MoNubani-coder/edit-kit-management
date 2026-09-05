import type { Metadata } from 'next'

import { PageHeader } from '@/components/common/page-header'
import { BookingsTable } from '@/features/dashboard/components/bookings-table'
import { SectionCard } from '@/features/dashboard/components/section-card'
import { env } from '@/lib/env'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { can } from '@/server/auth/permissions'
import { listBookingsForActor } from '@/server/dal/bookings.dal'
import { prisma } from '@/server/db/prisma'

export const metadata: Metadata = { title: 'Bookings' }

export const dynamic = 'force-dynamic'

/**
 * Booking list, scoped by the DAL: engineers, admins and viewers see every
 * booking; an editor sees only bookings made in their name. Full booking
 * management arrives in Phase 7.
 */
export default async function BookingsPage() {
  const actor = await requirePermissionForPage(['booking.read', 'booking.readOwn'])
  const bookings = await listBookingsForActor(prisma, actor)
  const seesAll = can(actor, 'booking.read')
  const now = new Date()

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Bookings"
        description={
          seesAll
            ? 'All bookings. Creating and managing bookings arrives in Phase 7.'
            : 'Bookings made in your name. Other editors’ bookings are never shown here.'
        }
      />

      <SectionCard title={seesAll ? 'All bookings' : 'Your bookings'} count={bookings.length}>
        <BookingsTable
          rows={bookings.map((booking) => ({
            id: booking.id,
            bookingNumber: booking.bookingNumber,
            status: booking.status,
            editorName: booking.editor.fullName,
            kitCode: booking.kit.kitCode,
            kitName: booking.kit.name,
            bookingStart: booking.bookingStart,
            bookingEnd: booking.bookingEnd,
            collectionDate: null,
            expectedReturnDate: booking.expectedReturnDate,
            actualReturnDate: null,
          }))}
          variant="history"
          timeZone={env.APP_TIMEZONE}
          now={now}
        />
      </SectionCard>
    </>
  )
}
