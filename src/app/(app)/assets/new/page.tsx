import type { Metadata } from 'next'

import { PageHeader } from '@/components/common/page-header'
import { AssetForm } from '@/features/assets/components/asset-form'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { prisma } from '@/server/db/prisma'
import { loadAssetFormOptions } from '@/server/services/assets.service'

export const metadata: Metadata = { title: 'Add equipment' }

export const dynamic = 'force-dynamic'

export default async function NewAssetPage() {
  await requirePermissionForPage('asset.manage')
  const options = await loadAssetFormOptions(prisma)

  return (
    <>
      <PageHeader
        eyebrow="Operations / Equipment / New"
        title="Add equipment"
        description="Record a serialised item. The asset code is allocated automatically; accessories can be added once it exists."
      />
      <div className="max-w-4xl">
        <AssetForm
          mode="create"
          values={{ name: '', categoryId: '', manufacturer: '', model: '', serialNumber: '', admBarcode: '', location: '', notes: '', status: 'AVAILABLE' }}
          categories={options.categories}
          cancelHref="/assets"
        />
      </div>
    </>
  )
}
