import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Categories' }

export default async function AdminCategoriesPage() {
  await requirePermissionForPage('admin.categories.manage')

  return (
    <PlaceholderPage
      title="Categories"
      description="Equipment categories and accessory types."
      phase={4}
    />
  )
}
