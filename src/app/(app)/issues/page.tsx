import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Issues' }

export default async function IssuesPage() {
  await requirePermissionForPage('issue.read')

  return (
    <PlaceholderPage
      title="Issues"
      description="Missing, damaged and malfunctioning equipment reports."
      phase={11}
    />
  )
}
