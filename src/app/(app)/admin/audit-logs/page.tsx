import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Audit Logs' }

export default async function AdminAuditLogsPage() {
  await requirePermissionForPage('admin.audit.read')

  return (
    <PlaceholderPage
      title="Audit Logs"
      description="Append-only record of sign-ins, state changes and administrative overrides."
      phase={3}
    />
  )
}
