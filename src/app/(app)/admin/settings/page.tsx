import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { AdminTabs } from '@/features/admin/components/admin-tabs'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Settings' }

export default async function AdminSettingsPage() {
  const actor = await requirePermissionForPage('admin.settings.manage')

  return (
    <PlaceholderPage
      eyebrow="Administration / Settings"
      title="Settings"
      description="Runtime-editable application settings."
      phase={3}
      tabs={<AdminTabs actor={actor} active="/admin/settings" />}
    />
  )
}
