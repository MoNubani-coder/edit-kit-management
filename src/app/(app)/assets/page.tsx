import { Plus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/components/common/section-tabs'
import { buttonVariants } from '@/components/ui/button'
import { AssetsTable } from '@/features/assets/components/assets-table'
import { AssetsToolbar } from '@/features/assets/components/assets-toolbar'
import { assetsHref } from '@/features/assets/hrefs'
import { env } from '@/lib/env'
import { ASSET_VIEW_LABELS, ASSET_VIEWS, parseAssetListParams } from '@/lib/validation/assets'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { can } from '@/server/auth/permissions'
import { ASSET_VIEW_STATUSES } from '@/server/dal/assets.dal'
import { loadEquipmentList } from '@/server/services/assets.service'

export const metadata: Metadata = { title: 'Equipment' }

export const dynamic = 'force-dynamic'

/**
 * Inventory control. Search, category and assignment filters, status tabs,
 * sortable columns and server-side pagination - every state is a URL. A
 * scanned ADM barcode that matches exactly opens the equipment directly.
 */
export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requirePermissionForPage('asset.read')
  const params = parseAssetListParams(await searchParams)

  const page = await loadEquipmentList({
    search: params.q,
    categoryId: params.category,
    view: params.view,
    assignment: params.assignment,
    sort: params.sort,
    direction: params.dir,
    page: params.page,
    pageSize: params.pageSize,
  })

  if (page.scannedAssetId) redirect(`/assets/${page.scannedAssetId}`)

  const canManage = can(page.actor, 'asset.manage')
  const tabs = ASSET_VIEWS.map((view) => {
    const statuses = ASSET_VIEW_STATUSES[view]
    const count = statuses
      ? statuses.reduce((sum, status) => sum + page.statusCounts[status], 0)
      : Object.values(page.statusCounts).reduce((sum, value) => sum + value, 0)
    return { key: view, label: ASSET_VIEW_LABELS[view], href: assetsHref(params, { view }), count }
  })

  return (
    <>
      <PageHeader
        eyebrow="Operations / Equipment"
        title="Equipment"
        description="Inventory control: serialised assets, their accessories, status history and maintenance records."
        actions={
          canManage ? (
            <Link href="/assets/new" className={buttonVariants({ variant: 'primary' })}>
              <Plus aria-hidden className="h-4 w-4" />
              Add equipment
            </Link>
          ) : null
        }
        tabs={<SectionTabs label="Equipment status" tabs={tabs} active={params.view} />}
      />

      <div className="space-y-4">
        <AssetsToolbar params={params} categories={page.categories} clearHref={assetsHref(params, { q: undefined, category: undefined, assignment: 'all' })} />
        <AssetsTable result={page.result} params={params} timeZone={env.APP_TIMEZONE} canManage={canManage} />
      </div>
    </>
  )
}
