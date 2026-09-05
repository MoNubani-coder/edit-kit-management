import type { Metadata } from 'next'

import { PageHeader } from '@/components/common/page-header'
import { KitForm } from '@/features/kits/components/kit-form'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'New kit' }

export const dynamic = 'force-dynamic'

export default async function NewKitPage() {
  await requirePermissionForPage('kit.manage')

  return (
    <>
      <PageHeader
        eyebrow="Operations / Kits / New"
        title="New kit"
        description="Name and code the kit first; equipment, software and the handover checklist are added on its workspace once it exists."
      />
      <div className="max-w-4xl">
        <KitForm
          mode="create"
          values={{ kitCode: '', name: '', admBarcode: '', location: '', description: '', notes: '', suitcaseStatus: 'GOOD', status: 'AVAILABLE' }}
          cancelHref="/kits"
        />
      </div>
    </>
  )
}
