import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Reports' }

export default async function ReportsPage() {
  await requirePermissionForPage('report.read')

  return (
    <PlaceholderPage
      title="Reports"
      description="Operational reports, handover and return documents, exports."
      phase={12}
    />
  )
}
