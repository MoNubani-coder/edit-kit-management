import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/common/page-header'
import { Alert } from '@/components/ui/alert'
import { AssetForm } from '@/features/assets/components/asset-form'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { prisma } from '@/server/db/prisma'
import { loadAssetFormOptions, loadAssetWorkspace } from '@/server/services/assets.service'

export const metadata: Metadata = { title: 'Edit equipment' }

export const dynamic = 'force-dynamic'

export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermissionForPage('asset.manage')
  const { id } = await params

  const [workspace, options] = await Promise.all([loadAssetWorkspace(prisma, actor, id), loadAssetFormOptions(prisma)])
  if (!workspace || workspace.asset.deletedAt) notFound()

  const { asset, allowedStatuses, lifecycle } = workspace
  // Keep the current category selectable even if it has since been deactivated.
  const categories = options.categories.some((category) => category.id === asset.category.id)
    ? options.categories
    : [{ ...asset.category, description: null, icon: null, sortOrder: 0, assetCount: 0, updatedAt: asset.updatedAt }, ...options.categories]

  return (
    <>
      <PageHeader
        eyebrow={`Operations / Equipment / ${asset.assetCode} / Edit`}
        title={`Edit ${asset.assetCode}`}
        description={asset.name}
      />
      <div className="max-w-4xl space-y-6">
        {lifecycle.hasActiveMaintenance ? (
          <Alert variant="warning" title="Maintenance active">
            This equipment cannot be made available while a maintenance record is in progress or on hold.
          </Alert>
        ) : null}
        {lifecycle.status === 'RESERVED' || lifecycle.status === 'CHECKED_OUT' ? (
          <Alert variant="info" title="Controlled by a booking">
            Status is managed by the booking, handover and return workflows while the equipment is {lifecycle.status === 'RESERVED' ? 'reserved' : 'checked out'}.
          </Alert>
        ) : null}
        <AssetForm
          mode="edit"
          values={{
            id: asset.id,
            name: asset.name,
            categoryId: asset.category.id,
            manufacturer: asset.manufacturer ?? '',
            model: asset.model ?? '',
            serialNumber: asset.serialNumber ?? '',
            admBarcode: asset.admBarcode ?? '',
            location: asset.location ?? '',
            notes: asset.notes ?? '',
            status: asset.status,
          }}
          categories={categories}
          allowedStatuses={allowedStatuses}
          cancelHref={`/assets/${asset.id}`}
        />
      </div>
    </>
  )
}
