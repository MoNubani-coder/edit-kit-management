import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { AdminTabs } from '@/features/admin/components/admin-tabs'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Users' }

export default async function AdminUsersPage() {
  const actor = await requirePermissionForPage('admin.users.manage')

  return (
    <PlaceholderPage
      eyebrow="Administration / Users"
      title="Users"
      description="Accounts, roles, suspension and password resets."
      phase={3}
      tabs={<AdminTabs actor={actor} active="/admin/users" />}
    />
  )
}
