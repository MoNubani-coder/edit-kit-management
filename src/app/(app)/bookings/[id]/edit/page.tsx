import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { PageHeader } from '@/components/common/page-header'
import { Alert } from '@/components/ui/alert'
import { BookingForm } from '@/features/bookings/components/booking-form'
import { KitPicker } from '@/features/bookings/components/kit-picker'
import { bookingFormHref } from '@/features/bookings/hrefs'
import { requesterOf } from '@/lib/booking-requester'
import { toZonedLocalInput } from '@/lib/datetime'
import { env } from '@/lib/env'
import { first } from '@/lib/validation/bookings'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { prisma } from '@/server/db/prisma'
import { loadBookingWorkspace, loadKitChoice, searchKitsForBooking } from '@/server/services/bookings.service'

export const metadata: Metadata = { title: 'Edit booking' }

export const dynamic = 'force-dynamic'

/**
 * Editing within the lifecycle, with a reason. Drafts and reservations may
 * change the kit and the schedule (a reservation is re-validated on save); a
 * booking that is ready for handover may change only the requester's details,
 * the purpose and the notes. A booking made against a directory profile keeps
 * that profile; its typed details are edited like any other.
 */
export default async function EditBookingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePermissionForPage('booking.update')
  const { id } = await params
  const query = await searchParams
  const now = new Date()

  const workspace = await loadBookingWorkspace(prisma, actor, id, now)
  if (!workspace) notFound()
  if (workspace.editScope === 'none') redirect(`/bookings/${id}`)

  const { booking, editScope } = workspace
  const base = `/bookings/${id}/edit`
  const full = editScope === 'full'
  const timeZone = env.APP_TIMEZONE
  const requester = requesterOf(booking)

  // Picker state: an explicit choice in the URL, "change" (empty value) or the booking's own kit.
  const kitParam = first(query.kitId)
  const kitId = kitParam === undefined ? booking.kit.id : kitParam || null
  const kq = (first(query.kq) ?? '').trim()
  const window = { start: booking.bookingStart, end: booking.bookingEnd }

  const [selectedKit, kitResults] = await Promise.all([
    kitId ? loadKitChoice(prisma, kitId, window, booking.id) : Promise.resolve(null),
    full && !kitId && kq ? searchKitsForBooking(prisma, kq, window, now) : Promise.resolve([]),
  ])

  return (
    <>
      <PageHeader eyebrow={`Operations / Bookings / ${booking.bookingNumber} / Edit`} title={`Edit ${booking.bookingNumber}`} description={`${requester.name} · ${booking.kit.kitCode} ${booking.kit.name}`} />
      <div className="max-w-5xl space-y-6">
        {editScope === 'restricted' ? (
          <Alert variant="info" title="Ready for handover">
            The kit is set aside for this booking. Only the requester’s details, the purpose and the notes can change; revert the booking to reserved to change the kit or schedule.
          </Alert>
        ) : booking.status === 'RESERVED' ? (
          <Alert variant="info" title="Reserved">
            Changing the kit or the window re-checks the kit’s readiness and the free window before saving; the database refuses any overlap that slips through. Changing the kit replaces the checklist unless it has already been answered.
          </Alert>
        ) : null}

        <KitPicker
          base={base}
          hidden={{ kitId: '' }}
          term={kq}
          results={kitResults}
          selected={selectedKit}
          changeHref={bookingFormHref(base, { kitId: '' }).replace(/([?&])kitId=(&|$)/, '$1kitId=$2')}
          selectHref={(next) => bookingFormHref(base, { kitId: next })}
          timeZone={timeZone}
          canChange={full}
        />

        {selectedKit ? (
          <BookingForm
            mode="edit"
            values={{
              id: booking.id,
              kitId: selectedKit.id,
              editorId: booking.editor?.id,
              requesterName: requester.name,
              requesterStaffId: requester.staffId ?? '',
              requesterMobile: requester.mobile ?? '',
              projectName: requester.projectName ?? '',
              workOrder: requester.workOrder ?? '',
              bookingStart: toZonedLocalInput(booking.bookingStart, timeZone),
              bookingEnd: toZonedLocalInput(booking.bookingEnd, timeZone),
              collectionDate: booking.collectionDate ? toZonedLocalInput(booking.collectionDate, timeZone) : '',
              expectedReturnDate: toZonedLocalInput(booking.expectedReturnDate, timeZone),
              purpose: booking.purpose ?? '',
              notes: booking.notes ?? '',
            }}
            scope={editScope}
            kitLabel={`${selectedKit.kitCode} · ${selectedKit.name}`}
            preparedBy={booking.createdBy.name}
            timeZone={timeZone}
            cancelHref={`/bookings/${booking.id}`}
            ready
          />
        ) : null}
      </div>
    </>
  )
}
