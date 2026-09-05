import { Plus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/components/common/section-tabs'
import { buttonVariants } from '@/components/ui/button'
import { KitsTable } from '@/features/kits/components/kits-table'
import { KitsToolbar } from '@/features/kits/components/kits-toolbar'
import { kitsHref } from '@/features/kits/hrefs'
import { env } from '@/lib/env'
import { KIT_VIEW_LABELS, KIT_VIEWS, parseKitListParams } from '@/lib/validation/kits'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { can } from '@/server/auth/permissions'
import { KIT_VIEW_STATUSES } from '@/server/dal/kits.dal'
import { loadKitList } from '@/server/services/kits.service'

export const metadata: Metadata = { title: 'Kits' }

export const dynamic = 'force-dynamic'

/**
 * Kit management workspace: status tabs, search that reaches into kit
 * contents, sortable columns and server-side pagination - every state is a
 * URL. A scanned kit barcode that matches exactly opens the kit directly.
 */
export default async function KitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requirePermissionForPage('kit.read')
  const params = parseKitListParams(await searchParams)

  const page = await loadKitList({
    search: params.q,
    view: params.view,
    sort: params.sort,
    direction: params.dir,
    page: params.page,
    pageSize: params.pageSize,
  })

  if (page.scannedKitId) redirect(`/kits/${page.scannedKitId}`)

  const canManage = can(page.actor, 'kit.manage')
  const tabs = KIT_VIEWS.map((view) => {
    const statuses = KIT_VIEW_STATUSES[view]
    const count = statuses
      ? statuses.reduce((sum, status) => sum + page.statusCounts[status], 0)
      : Object.values(page.statusCounts).reduce((sum, value) => sum + value, 0)
    return { key: view, label: KIT_VIEW_LABELS[view], href: kitsHref(params, { view }), count }
  })

  return (
    <>
      <PageHeader
        eyebrow="Operations / Kits"
        title="Kits"
        description="Named, barcoded collections of equipment issued to editors. Readiness is calculated from the equipment inside each kit."
        actions={
          canManage ? (
            <Link href="/kits/new" className={buttonVariants({ variant: 'primary' })}>
              <Plus aria-hidden className="h-4 w-4" />
              New kit
            </Link>
          ) : null
        }
        tabs={<SectionTabs label="Kit status" tabs={tabs} active={params.view} />}
      />

      <div className="space-y-4">
        <KitsToolbar params={params} clearHref={kitsHref(params, { q: undefined })} />
        <KitsTable result={page.result} params={params} timeZone={env.APP_TIMEZONE} canManage={canManage} />
      </div>
    </>
  )
}
