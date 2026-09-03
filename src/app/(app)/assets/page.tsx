import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Equipment' }

export default async function AssetsPage() {
  await requirePermissionForPage('asset.read')

  return (
    <PlaceholderPage
      title="Equipment"
      description="Serialised assets, their accessories, status history and maintenance records."
      phase={4}
    />
  )
}
