import type { Metadata } from 'next'

import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { env } from '@/lib/env'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { can } from '@/server/auth/permissions'
import { listBookingsForActor } from '@/server/dal/bookings.dal'
import { prisma } from '@/server/db/prisma'

export const metadata: Metadata = { title: 'Bookings' }

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: env.APP_TIMEZONE,
  dateStyle: 'medium',
})

/**
 * Booking list, scoped by the DAL: engineers, admins and viewers see every
 * booking; an editor sees only bookings made in their name. Full booking
 * management arrives in Phase 7.
 */
export default async function BookingsPage() {
  const actor = await requirePermissionForPage(['booking.read', 'booking.readOwn'])
  const bookings = await listBookingsForActor(prisma, actor)
  const seesAll = can(actor, 'booking.read')

  return (
    <>
      <PageHeader
        title="Bookings"
        description={
          seesAll
            ? 'All bookings. Creating and managing bookings arrives in Phase 7.'
            : 'Bookings made in your name. Other editors’ bookings are never shown here.'
        }
      />

      {bookings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <p className="text-sm font-medium text-slate-700">No bookings yet</p>
          <p className="mt-1 text-sm text-slate-500">
            {seesAll
              ? 'Bookings will appear here once the booking workflow is delivered.'
              : 'You have no bookings on record.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Booking</th>
                <th className="px-4 py-3">Kit</th>
                <th className="px-4 py-3">Editor</th>
                <th className="px-4 py-3">Engineer</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bookings.map((booking) => (
                <tr key={booking.id}>
                  <td className="px-4 py-3 font-mono text-xs text-slate-900">{booking.bookingNumber}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {booking.kit.kitCode} · {booking.kit.name}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{booking.editor.fullName}</td>
                  <td className="px-4 py-3 text-slate-700">{booking.engineer.fullName}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {dateFormat.format(booking.bookingStart)} – {dateFormat.format(booking.bookingEnd)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge>{booking.status.replaceAll('_', ' ')}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
