import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Settings' }

export default async function AdminSettingsPage() {
  await requirePermissionForPage('admin.settings.manage')

  return (
    <PlaceholderPage
      title="Settings"
      description="Runtime-editable application settings."
      phase={3}
    />
  )
}
