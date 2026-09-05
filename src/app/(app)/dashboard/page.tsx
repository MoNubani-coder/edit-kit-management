import type { Metadata } from 'next'

import { PageHeader } from '@/components/common/page-header'
import { DashboardView } from '@/features/dashboard/components/dashboard-view'
import { ROLE_LABELS } from '@/lib/constants/roles'
import { formatDate } from '@/lib/datetime'
import { env } from '@/lib/env'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { prisma } from '@/server/db/prisma'
import { buildDashboard } from '@/server/services/dashboard.service'

export const metadata: Metadata = { title: 'Dashboard' }

// Live operational data: never prerendered, never cached between requests.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const actor = await requirePermissionForPage('dashboard.view')
  const data = await buildDashboard(prisma, actor, { timeZone: env.APP_TIMEZONE })

  const isEditorView = data.myBookings !== null
  const description = isEditorView
    ? `Your bookings and returns · ${formatDate(data.generatedAt, data.timeZone)}`
    : `Operational overview · ${formatDate(data.generatedAt, data.timeZone)} · ${ROLE_LABELS[actor.role]} view`

  return (
    <>
      <PageHeader eyebrow={isEditorView ? 'My equipment' : 'Operations'} title="Dashboard" description={description} />
      <DashboardView data={data} />
    </>
  )
}
