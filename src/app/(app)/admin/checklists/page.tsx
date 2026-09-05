import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { AdminTabs } from '@/features/admin/components/admin-tabs'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Checklist Templates' }

export default async function AdminChecklistTemplatesPage() {
  const actor = await requirePermissionForPage('admin.checklists.manage')

  return (
    <PlaceholderPage
      eyebrow="Administration / Checklist Templates"
      title="Checklist Templates"
      description="Handover and return checklists applied to bookings."
      phase={5}
      tabs={<AdminTabs actor={actor} active="/admin/checklists" />}
    />
  )
}
