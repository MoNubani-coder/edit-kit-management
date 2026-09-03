import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Software' }

export default async function AdminSoftwarePage() {
  await requirePermissionForPage('admin.software.manage')

  return (
    <PlaceholderPage
      title="Software"
      description="Applications that kits are expected to carry."
      phase={5}
    />
  )
}
