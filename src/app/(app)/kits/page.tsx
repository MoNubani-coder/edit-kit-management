import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Kits' }

export default async function KitsPage() {
  await requirePermissionForPage('kit.read')

  return (
    <PlaceholderPage
      title="Kits"
      description="Named, barcoded collections of equipment issued to editors."
      phase={5}
    />
  )
}
