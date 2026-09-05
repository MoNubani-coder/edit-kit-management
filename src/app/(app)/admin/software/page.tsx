import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { AdminTabs } from '@/features/admin/components/admin-tabs'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Software' }

export default async function AdminSoftwarePage() {
  const actor = await requirePermissionForPage('admin.software.manage')

  return (
    <PlaceholderPage
      eyebrow="Administration / Software"
      title="Software"
      description="Applications that kits are expected to carry."
      phase={5}
      tabs={<AdminTabs actor={actor} active="/admin/software" />}
    />
  )
}
