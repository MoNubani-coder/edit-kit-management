import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Editors' }

export default async function EditorsPage() {
  await requirePermissionForPage('editor.read')

  return (
    <PlaceholderPage
      eyebrow="Operations / Editors"
      title="Editors"
      description="Internal and external editors who receive kits."
      phase={6}
    />
  )
}
