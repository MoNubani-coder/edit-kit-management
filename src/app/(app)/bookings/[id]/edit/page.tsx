import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { PageHeader } from '@/components/common/page-header'
import { Alert } from '@/components/ui/alert'
import { BookingForm } from '@/features/bookings/components/booking-form'
import { EditorPicker } from '@/features/bookings/components/editor-picker'
import { KitPicker } from '@/features/bookings/components/kit-picker'
import { bookingFormHref } from '@/features/bookings/hrefs'
import { toZonedLocalInput } from '@/lib/datetime'
import { env } from '@/lib/env'
import { first } from '@/lib/validation/bookings'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { prisma } from '@/server/db/prisma'
import {
  loadBookingWorkspace,
  loadEditorChoice,
  loadEngineerOptions,
  loadKitChoice,
  searchEditorsForBooking,
  searchKitsForBooking,
} from '@/server/services/bookings.service'

export const metadata: Metadata = { title: 'Edit booking' }

export const dynamic = 'force-dynamic'

/**
 * Editing within the lifecycle. Drafts and reservations may change editor,
 * kit and schedule (a reservation is re-validated on save); a booking that is
 * ready for handover may change only the engineer, purpose and notes.
 */
export default async function EditBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
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

  // Picker state: an explicit choice in the URL, "change" (empty value) or the booking's own.
  const editorParam = first(query.editorId)
  const kitParam = first(query.kitId)
  const editorId = editorParam === undefined ? booking.editor.id : editorParam || null
  const kitId = kitParam === undefined ? booking.kit.id : kitParam || null
  const eq = (first(query.eq) ?? '').trim()
  const kq = (first(query.kq) ?? '').trim()
  const window = { start: booking.bookingStart, end: booking.bookingEnd }

  const [selectedEditor, editorResults, selectedKit, kitResults, engineers] = await Promise.all([
    editorId ? loadEditorChoice(prisma, editorId) : Promise.resolve(null),
    full && !editorId && eq ? searchEditorsForBooking(prisma, eq) : Promise.resolve([]),
    kitId ? loadKitChoice(prisma, kitId, window, booking.id) : Promise.resolve(null),
    full && !kitId && kq ? searchKitsForBooking(prisma, kq, window, now) : Promise.resolve([]),
    loadEngineerOptions(prisma),
  ])

  const state = { editorId: editorId ?? '', kitId: kitId ?? '' }
  const hrefWith = (next: Partial<typeof state>) => bookingFormHref(base, { editorId: next.editorId ?? state.editorId, kitId: next.kitId ?? state.kitId })

  return (
    <>
      <PageHeader eyebrow={`Operations / Bookings / ${booking.bookingNumber} / Edit`} title={`Edit ${booking.bookingNumber}`} description={`${booking.editor.fullName} · ${booking.kit.kitCode} ${booking.kit.name}`} />
      <div className="max-w-5xl space-y-6">
        {editScope === 'restricted' ? (
          <Alert variant="info" title="Ready for handover">
            The kit is set aside for this booking. Only the engineer, purpose and notes can change; revert the booking to reserved to change the editor, kit or schedule.
          </Alert>
        ) : booking.status === 'RESERVED' ? (
          <Alert variant="info" title="Reserved">
            Changing the kit or the window re-checks the kit’s readiness and the free window before saving; the database refuses any overlap that slips through.
          </Alert>
        ) : null}

        <EditorPicker
          base={base}
          hidden={{ kitId: state.kitId, editorId: '' }}
          term={eq}
          results={editorResults}
          selected={selectedEditor}
          changeHref={hrefWith({ editorId: '' }).replace(/([?&])editorId=(&|$)/, '$1editorId=$2')}
          selectHref={(next) => hrefWith({ editorId: next })}
          canChange={full}
        />

        <KitPicker
          base={base}
          hidden={{ editorId: state.editorId, kitId: '' }}
          term={kq}
          results={kitResults}
          selected={selectedKit}
          changeHref={hrefWith({ kitId: '' })}
          selectHref={(next) => hrefWith({ kitId: next })}
          timeZone={timeZone}
          canChange={full}
        />

        {selectedEditor && selectedKit ? (
          <BookingForm
            mode="edit"
            values={{
              id: booking.id,
              editorId: selectedEditor.id,
              kitId: selectedKit.id,
              engineerId: booking.engineer.id,
              bookingStart: toZonedLocalInput(booking.bookingStart, timeZone),
              bookingEnd: toZonedLocalInput(booking.bookingEnd, timeZone),
              collectionDate: booking.collectionDate ? toZonedLocalInput(booking.collectionDate, timeZone) : '',
              expectedReturnDate: toZonedLocalInput(booking.expectedReturnDate, timeZone),
              purpose: booking.purpose ?? '',
              notes: booking.notes ?? '',
            }}
            engineers={engineers}
            scope={editScope}
            summary={{ editor: selectedEditor.fullName, kit: `${selectedKit.kitCode} · ${selectedKit.name}` }}
            timeZone={timeZone}
            cancelHref={`/bookings/${booking.id}`}
            ready
          />
        ) : null}
      </div>
    </>
  )
}
