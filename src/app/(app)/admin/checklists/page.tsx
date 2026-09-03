import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Checklist Templates' }

export default async function AdminChecklistsPage() {
  await requirePermissionForPage('admin.checklists.manage')

  return (
    <PlaceholderPage
      title="Checklist Templates"
      description="Handover and return checklists applied to bookings."
      phase={5}
    />
  )
}
