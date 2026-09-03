import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Users' }

export default async function AdminUsersPage() {
  await requirePermissionForPage('admin.users.manage')

  return (
    <PlaceholderPage
      title="Users"
      description="Accounts, roles, suspension and password resets."
      phase={3}
    />
  )
}
