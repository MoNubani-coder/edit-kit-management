import type { Metadata } from 'next'

import { PageHeader } from '@/components/common/page-header'
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
  loadEditorChoice,
  loadEngineerOptions,
  loadKitChoice,
  searchEditorsForBooking,
  searchKitsForBooking,
} from '@/server/services/bookings.service'

export const metadata: Metadata = { title: 'New booking' }

export const dynamic = 'force-dynamic'

const BASE = '/bookings/new'
const HOUR = 60 * 60 * 1000

/**
 * Four sections, one URL. Editor and kit are chosen through GET searches whose
 * selections land in the query string; the schedule and review section is the
 * POST form. Nothing is written until "Save as draft" or "Reserve kit".
 */
export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const actor = await requirePermissionForPage('booking.create')
  const query = await searchParams
  const editorId = first(query.editorId)
  const kitId = first(query.kitId)
  const eq = (first(query.eq) ?? '').trim()
  const kq = (first(query.kq) ?? '').trim()
  const now = new Date()

  const [selectedEditor, editorResults, selectedKit, kitResults, engineers] = await Promise.all([
    editorId ? loadEditorChoice(prisma, editorId) : Promise.resolve(null),
    !editorId && eq ? searchEditorsForBooking(prisma, eq) : Promise.resolve([]),
    kitId ? loadKitChoice(prisma, kitId, null) : Promise.resolve(null),
    editorId && !kitId && kq ? searchKitsForBooking(prisma, kq, null, now) : Promise.resolve([]),
    loadEngineerOptions(prisma),
  ])

  const state = { editorId: selectedEditor?.id, kitId: selectedKit?.id }
  const defaultStart = new Date(Math.ceil(now.getTime() / HOUR) * HOUR + HOUR)
  const defaultEnd = new Date(defaultStart.getTime() + 3 * 24 * HOUR)
  const ready = Boolean(selectedEditor && !selectedEditor.blocker && selectedKit?.readiness.available)

  return (
    <>
      <PageHeader
        eyebrow="Operations / Bookings / New"
        title="New booking"
        description="Choose the editor and the kit, set the window, then reserve. The booking number is allocated on save."
      />
      <div className="max-w-5xl space-y-6">
        <EditorPicker
          base={BASE}
          hidden={{ kitId: state.kitId }}
          term={eq}
          results={editorResults}
          selected={selectedEditor}
          changeHref={bookingFormHref(BASE, { kitId: state.kitId })}
          selectHref={(id) => bookingFormHref(BASE, { editorId: id, kitId: state.kitId })}
        />

        <KitPicker
          base={BASE}
          hidden={{ editorId: state.editorId }}
          term={kq}
          results={kitResults}
          selected={selectedKit}
          changeHref={bookingFormHref(BASE, { editorId: state.editorId })}
          selectHref={(id) => bookingFormHref(BASE, { editorId: state.editorId, kitId: id })}
          timeZone={env.APP_TIMEZONE}
          enabled={Boolean(selectedEditor)}
        />

        {selectedEditor && selectedKit ? (
          <BookingForm
            mode="create"
            values={{
              editorId: selectedEditor.id,
              kitId: selectedKit.id,
              engineerId: engineers.find((engineer) => engineer.id === actor.engineerProfileId)?.id ?? (engineers.length === 1 ? engineers[0].id : ''),
              bookingStart: toZonedLocalInput(defaultStart, env.APP_TIMEZONE),
              bookingEnd: toZonedLocalInput(defaultEnd, env.APP_TIMEZONE),
              collectionDate: '',
              expectedReturnDate: '',
              purpose: '',
              notes: '',
            }}
            engineers={engineers}
            summary={{ editor: selectedEditor.fullName, kit: `${selectedKit.kitCode} · ${selectedKit.name}` }}
            timeZone={env.APP_TIMEZONE}
            cancelHref="/bookings"
            ready={ready}
          />
        ) : null}
      </div>
    </>
  )
}
