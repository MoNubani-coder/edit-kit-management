import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/components/common/section-tabs'
import { BookingStatusBadge } from '@/components/common/status-badge'
import { Badge } from '@/components/ui/badge'
import { BookingActivity } from '@/features/bookings/components/booking-activity'
import { BookingEquipment } from '@/features/bookings/components/booking-equipment'
import { BookingOverview } from '@/features/bookings/components/booking-overview'
import { BookingTimeBadge } from '@/features/bookings/components/booking-time-badge'
import { bookingHref } from '@/features/bookings/hrefs'
import { env } from '@/lib/env'
import { BOOKING_TAB_LABELS, BOOKING_TABS, parseBookingTab } from '@/lib/validation/bookings'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { prisma } from '@/server/db/prisma'
import { loadBookingWorkspace } from '@/server/services/bookings.service'

export const metadata: Metadata = { title: 'Booking' }

export const dynamic = 'force-dynamic'

/**
 * The booking workspace: number, state, editor and kit in the header; then
 * Overview, Equipment (the kit as it stands, read-only) and Activity. An
 * EDITOR reaches only their own bookings - the DAL scope makes anyone else's
 * a 404, never a 403 that would confirm the booking exists.
 */
export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const actor = await requirePermissionForPage(['booking.read', 'booking.readOwn'])
  const { id } = await params
  const query = await searchParams
  const now = new Date()

  const workspace = await loadBookingWorkspace(prisma, actor, id, now)
  if (!workspace) notFound()

  const { booking, time } = workspace
  const timeZone = env.APP_TIMEZONE
  const tab = parseBookingTab(query.tab)
  const counts = { equipment: workspace.kit?.members.length, activity: workspace.activity.length }
  const tabs = BOOKING_TABS.map((key) => ({ key, label: BOOKING_TAB_LABELS[key], href: bookingHref(booking.id, key), count: key === 'overview' ? undefined : counts[key] }))

  return (
    <>
      <PageHeader
        eyebrow={`Operations / Bookings / ${booking.bookingNumber}`}
        title={booking.bookingNumber}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <BookingStatusBadge status={booking.status} />
            <BookingTimeBadge status={booking.status} expectedReturnDate={booking.expectedReturnDate} overdue={time.overdue} dueSoon={time.dueSoon} now={now} timeZone={timeZone} />
            <span className="font-medium text-foreground">{booking.editor.fullName}</span>
            <Badge tone={booking.editor.isExternal ? 'neutral' : 'blue'}>{booking.editor.isExternal ? 'External' : 'Internal'}</Badge>
            <span className="text-subtle">·</span>
            <span className="font-mono text-foreground">{booking.kit.kitCode}</span>
            <span>{booking.kit.name}</span>
          </span>
        }
      />

      <div className="space-y-6">
        <SectionTabs label="Booking sections" tabs={tabs} active={tab} />
        {tab === 'overview' ? <BookingOverview workspace={workspace} timeZone={timeZone} now={now} /> : null}
        {tab === 'equipment' ? <BookingEquipment kit={workspace.kit} readiness={workspace.readiness} canReadAssets={workspace.canReadAssets} /> : null}
        {tab === 'activity' ? <BookingActivity events={workspace.activity} timeZone={timeZone} now={now} /> : null}
      </div>
    </>
  )
}
