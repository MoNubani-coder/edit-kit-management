import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { AdminTabs } from '@/features/admin/components/admin-tabs'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Audit Logs' }

export default async function AdminAuditLogsPage() {
  const actor = await requirePermissionForPage('admin.audit.read')

  return (
    <PlaceholderPage
      eyebrow="Administration / Audit Logs"
      title="Audit Logs"
      description="Append-only record of sign-ins, state changes and administrative overrides."
      phase={3}
      tabs={<AdminTabs actor={actor} active="/admin/audit-logs" />}
    />
  )
}
