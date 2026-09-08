import { ClipboardCheck, PackageCheck, Undo2 } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/components/common/section-tabs'
import { BookingStatusBadge } from '@/components/common/status-badge'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { BookingActivity } from '@/features/bookings/components/booking-activity'
import { BookingChecklist } from '@/features/bookings/components/booking-checklist'
import { BookingEquipment } from '@/features/bookings/components/booking-equipment'
import { BookingOverview } from '@/features/bookings/components/booking-overview'
import { BookingTimeBadge } from '@/features/bookings/components/booking-time-badge'
import { bookingHref } from '@/features/bookings/hrefs'
import { requesterOf } from '@/lib/booking-requester'
import { env } from '@/lib/env'
import { BOOKING_TAB_LABELS, BOOKING_TABS, type BookingTab, parseBookingTab } from '@/lib/validation/bookings'
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
  const requester = requesterOf(booking)
  const counts: Record<Exclude<BookingTab, 'overview'>, number | undefined> = {
    checklist: workspace.checklist.handoverCount || undefined,
    equipment: workspace.kit?.members.length,
    activity: workspace.activity.length,
  }
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
            <span className="font-medium text-foreground">{requester.name}</span>
            {requester.isExternal !== null ? <Badge tone={requester.isExternal ? 'neutral' : 'blue'}>{requester.isExternal ? 'External' : 'Internal'}</Badge> : null}
            <span className="text-subtle">·</span>
            <span className="font-mono text-foreground">{booking.kit.kitCode}</span>
            <span>{booking.kit.name}</span>
          </span>
        }
        actions={
          // The one thing to do next, where the engineer is already looking.
          workspace.canReturnKit ? (
            <Link href={`/bookings/${booking.id}/return`} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
              <Undo2 aria-hidden className="h-4 w-4" />
              Return Kit
            </Link>
          ) : booking.status === 'RETURN_INSPECTION' && workspace.canReturn ? (
            <Link href={`/bookings/${booking.id}/return`} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
              <Undo2 aria-hidden className="h-4 w-4" />
              Continue return
            </Link>
          ) : workspace.canHandover ? (
            <Link href={`/bookings/${booking.id}/handover`} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
              <PackageCheck aria-hidden className="h-4 w-4" />
              Open handover
            </Link>
          ) : workspace.canPrepareChecklist && !workspace.checklist.complete && workspace.checklist.handoverCount > 0 ? (
            <Link href={bookingHref(booking.id, 'checklist')} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
              <ClipboardCheck aria-hidden className="h-4 w-4" />
              Complete checklist
            </Link>
          ) : null
        }
      />

      <div className="space-y-6">
        <SectionTabs label="Booking sections" tabs={tabs} active={tab} />
        {tab === 'overview' ? <BookingOverview workspace={workspace} timeZone={timeZone} now={now} /> : null}
        {tab === 'checklist' ? <BookingChecklist workspace={workspace} timeZone={timeZone} /> : null}
        {tab === 'equipment' ? <BookingEquipment kit={workspace.kit} readiness={workspace.readiness} canReadAssets={workspace.canReadAssets} /> : null}
        {tab === 'activity' ? <BookingActivity events={workspace.activity} timeZone={timeZone} now={now} /> : null}
      </div>
    </>
  )
}
