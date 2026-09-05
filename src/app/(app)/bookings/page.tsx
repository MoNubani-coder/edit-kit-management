import { Plus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/components/common/section-tabs'
import { buttonVariants } from '@/components/ui/button'
import { BookingsTable } from '@/features/bookings/components/bookings-table'
import { BookingsToolbar } from '@/features/bookings/components/bookings-toolbar'
import { bookingsHref } from '@/features/bookings/hrefs'
import { env } from '@/lib/env'
import { BOOKING_FILTER_LABELS, BOOKING_FILTERS, parseBookingListParams } from '@/lib/validation/bookings'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { loadBookingList } from '@/server/services/bookings.service'

export const metadata: Metadata = { title: 'Bookings' }

export const dynamic = 'force-dynamic'

/**
 * The booking workspace: status tabs with counts, search, sortable columns and
 * server-side pagination - every state a URL. The DAL scopes every query to
 * the actor: engineers, admins and viewers see all bookings, an editor only
 * their own. Overdue and due-soon are derived by the service, never here.
 */
export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requirePermissionForPage(['booking.read', 'booking.readOwn'])
  const params = parseBookingListParams(await searchParams)
  const now = new Date()

  const page = await loadBookingList({
    search: params.q,
    filter: params.filter,
    sort: params.sort,
    direction: params.dir,
    page: params.page,
    pageSize: params.pageSize,
    now,
  })

  const tabs = BOOKING_FILTERS.map((filter) => ({ key: filter, label: BOOKING_FILTER_LABELS[filter], href: bookingsHref(params, { filter }), count: page.counts[filter] }))

  return (
    <>
      <PageHeader
        eyebrow="Operations / Bookings"
        title="Bookings"
        description={
          page.seesAll
            ? 'Reservations before handover: who receives which kit, when, and whether the kit is ready and free for that window.'
            : 'Bookings made in your name. Other editors’ bookings are never shown here.'
        }
        actions={
          page.canCreate ? (
            <Link href="/bookings/new" className={buttonVariants({ variant: 'primary' })}>
              <Plus aria-hidden className="h-4 w-4" />
              New booking
            </Link>
          ) : null
        }
        tabs={<SectionTabs label="Booking filters" tabs={tabs} active={params.filter} />}
      />

      <div className="space-y-4">
        <BookingsToolbar params={params} clearHref={bookingsHref(params, { q: undefined })} seesAll={page.seesAll} />
        <BookingsTable page={page} params={params} timeZone={env.APP_TIMEZONE} now={now} />
      </div>
    </>
  )
}
