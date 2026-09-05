import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { AdminTabs } from '@/features/admin/components/admin-tabs'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Categories' }

export default async function AdminCategoriesPage() {
  const actor = await requirePermissionForPage('admin.categories.manage')

  return (
    <PlaceholderPage
      eyebrow="Administration / Categories"
      title="Categories"
      description="Equipment categories and accessory types."
      phase={4}
      tabs={<AdminTabs actor={actor} active="/admin/categories" />}
    />
  )
}
