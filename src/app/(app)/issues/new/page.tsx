import type { Metadata } from 'next'

import { PageHeader } from '@/components/common/page-header'
import { ReportIssueForm } from '@/features/issues/components/report-issue-form'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { listAssignableUsers } from '@/server/dal/issues.dal'
import { prisma } from '@/server/db/prisma'

export const metadata: Metadata = { title: 'Report an issue' }

export const dynamic = 'force-dynamic'

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Reporting a problem by hand.
 *
 * Reached from an equipment or kit page (which pre-fills what it is about) or
 * straight from the issues list. The links are resolved here so the form can
 * name them, and re-resolved by the service on submit - a pasted id for
 * something that does not exist is refused there.
 */
export default async function ReportIssuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermissionForPage('issue.create')
  const query = await searchParams
  const assetId = first(query.assetId)
  const kitId = first(query.kitId)
  const bookingId = first(query.bookingId)

  const [asset, kit, booking, assignees] = await Promise.all([
    assetId ? prisma.asset.findFirst({ where: { id: assetId, deletedAt: null }, select: { id: true, assetCode: true, name: true } }) : null,
    kitId ? prisma.kit.findFirst({ where: { id: kitId, deletedAt: null }, select: { id: true, kitCode: true, name: true } }) : null,
    bookingId ? prisma.booking.findFirst({ where: { id: bookingId, deletedAt: null }, select: { id: true, bookingNumber: true } }) : null,
    listAssignableUsers(prisma),
  ])

  const cancelHref = asset ? `/assets/${asset.id}?tab=issues` : kit ? `/kits/${kit.id}` : booking ? `/bookings/${booking.id}` : '/issues'

  return (
    <>
      <PageHeader
        eyebrow="Operations / Issues / Report"
        title="Report an issue"
        description="For a problem noticed outside a return. Returns raise their own issues for anything missing or damaged."
      />
      <div className="max-w-3xl">
        <div className="theme-transition rounded-panel border border-line bg-panel px-5 py-5">
          <ReportIssueForm
            target={{
              assetId: asset?.id,
              assetLabel: asset ? `${asset.assetCode} · ${asset.name}` : undefined,
              kitId: kit?.id,
              kitLabel: kit ? `${kit.kitCode} · ${kit.name}` : undefined,
              bookingId: booking?.id,
              bookingLabel: booking?.bookingNumber,
            }}
            assignees={assignees}
            cancelHref={cancelHref}
          />
        </div>
      </div>
    </>
  )
}
