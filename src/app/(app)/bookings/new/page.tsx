import type { Metadata } from 'next'

import { PageHeader } from '@/components/common/page-header'
import { BookingForm } from '@/features/bookings/components/booking-form'
import { KitPicker } from '@/features/bookings/components/kit-picker'
import { bookingFormHref } from '@/features/bookings/hrefs'
import { toZonedLocalInput } from '@/lib/datetime'
import { env } from '@/lib/env'
import { first } from '@/lib/validation/bookings'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { prisma } from '@/server/db/prisma'
import { loadKitChoice, searchKitsForBooking } from '@/server/services/bookings.service'

export const metadata: Metadata = { title: 'New booking' }

export const dynamic = 'force-dynamic'

const BASE = '/bookings/new'
const HOUR = 60 * 60 * 1000

/**
 * Three sections, one URL. The kit is chosen through a GET search whose
 * selection lands in the query string; who it is for, the schedule and the
 * review are the POST form. Nothing is written until "Save as draft" or
 * "Reserve kit". The preparer is the signed-in account.
 */
export default async function NewBookingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePermissionForPage('booking.create')
  const query = await searchParams
  const kitId = first(query.kitId)
  const kq = (first(query.kq) ?? '').trim()
  const now = new Date()

  const [selectedKit, kitResults] = await Promise.all([
    kitId ? loadKitChoice(prisma, kitId, null) : Promise.resolve(null),
    !kitId && kq ? searchKitsForBooking(prisma, kq, null, now) : Promise.resolve([]),
  ])

  const defaultStart = new Date(Math.ceil(now.getTime() / HOUR) * HOUR + HOUR)
  const defaultEnd = new Date(defaultStart.getTime() + 3 * 24 * HOUR)
  const ready = Boolean(selectedKit?.readiness.available)

  return (
    <>
      <PageHeader eyebrow="Operations / Bookings / New" title="New booking" description="Choose the kit, say who it is for and when, then reserve. The booking number is allocated on save." />
      <div className="max-w-5xl space-y-6">
        <KitPicker base={BASE} hidden={{}} term={kq} results={kitResults} selected={selectedKit} changeHref={BASE} selectHref={(id) => bookingFormHref(BASE, { kitId: id })} timeZone={env.APP_TIMEZONE} />

        {selectedKit ? (
          <BookingForm
            mode="create"
            values={{
              kitId: selectedKit.id,
              requesterName: '',
              requesterStaffId: '',
              requesterMobile: '',
              projectName: '',
              workOrder: '',
              bookingStart: toZonedLocalInput(defaultStart, env.APP_TIMEZONE),
              bookingEnd: toZonedLocalInput(defaultEnd, env.APP_TIMEZONE),
              collectionDate: '',
              expectedReturnDate: '',
              purpose: '',
              notes: '',
            }}
            kitLabel={`${selectedKit.kitCode} · ${selectedKit.name}`}
            preparedBy={actor.name}
            timeZone={env.APP_TIMEZONE}
            cancelHref="/bookings"
            ready={ready}
          />
        ) : null}
      </div>
    </>
  )
}
