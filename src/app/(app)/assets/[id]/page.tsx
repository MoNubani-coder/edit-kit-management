import { Pencil } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/components/common/section-tabs'
import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { AccessoriesPanel } from '@/features/assets/components/accessories-panel'
import { RemoveAssetForm } from '@/features/assets/components/action-forms'
import { AssetSummary } from '@/features/assets/components/asset-summary'
import { HistoryTimeline } from '@/features/assets/components/history-timeline'
import { IssuesPanel } from '@/features/assets/components/issues-panel'
import { MaintenancePanel } from '@/features/assets/components/maintenance-panel'
import { formatDateTime } from '@/lib/datetime'
import { env } from '@/lib/env'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { prisma } from '@/server/db/prisma'
import { loadAccessoryTypeOptions, loadAssetWorkspace } from '@/server/services/assets.service'

export const metadata: Metadata = { title: 'Equipment' }

export const dynamic = 'force-dynamic'

type Tab = 'accessories' | 'maintenance' | 'issues' | 'history'

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function AssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const actor = await requirePermissionForPage('asset.read')
  const { id } = await params
  const query = await searchParams

  const workspace = await loadAssetWorkspace(prisma, actor, id)
  if (!workspace) notFound()

  const { asset, history, canManage } = workspace
  const timeZone = env.APP_TIMEZONE
  const now = new Date()
  const removed = asset.deletedAt !== null

  const available: Tab[] = ['accessories']
  if (asset.maintenance) available.push('maintenance')
  if (asset.issues) available.push('issues')
  available.push('history')

  const requested = first(query.tab)
  const tab: Tab = available.includes(requested as Tab) ? (requested as Tab) : 'accessories'
  const baseHref = `/assets/${asset.id}?tab=${tab}`
  const accessoryEditing = tab === 'accessories' && canManage && !removed ? first(query.accessory) ?? null : null
  const accessoryTypes = accessoryEditing ? await loadAccessoryTypeOptions(prisma) : []

  const tabs = available.map((key) => ({
    key,
    href: `/assets/${asset.id}?tab=${key}`,
    label: key === 'accessories' ? 'Accessories' : key === 'maintenance' ? 'Maintenance' : key === 'issues' ? 'Issues' : 'History',
    count:
      key === 'accessories'
        ? asset.accessories.length
        : key === 'maintenance'
          ? asset.maintenance?.length
          : key === 'issues'
            ? asset.issues?.length
            : history.length,
  }))

  return (
    <>
      <PageHeader
        eyebrow={`Operations / Equipment / ${asset.assetCode}`}
        title={asset.name}
        description={
          <>
            <span className="font-mono text-foreground">{asset.assetCode}</span> · {asset.category.name}
            {asset.manufacturer || asset.model ? ` · ${[asset.manufacturer, asset.model].filter(Boolean).join(' ')}` : ''}
          </>
        }
        actions={
          canManage && !removed ? (
            <>
              <RemoveAssetForm assetId={asset.id} assetCode={asset.assetCode} blocker={workspace.removalBlocker} />
              <Link href={`/assets/${asset.id}/edit`} className={buttonVariants({ variant: 'secondary' })}>
                <Pencil aria-hidden className="h-4 w-4" />
                Edit
              </Link>
            </>
          ) : null
        }
      />

      <div className="space-y-6">
        {removed ? (
          <Alert variant="warning" title="Removed from inventory">
            This equipment was removed on {formatDateTime(asset.deletedAt!, timeZone)}. Its history is kept for the records; it no longer appears in lists or kits.
          </Alert>
        ) : null}

        <AssetSummary asset={asset} availableForUse={workspace.availableForUse} timeZone={timeZone} />

        <SectionTabs label="Equipment sections" tabs={tabs} active={tab} />

        {tab === 'accessories' ? (
          <AccessoriesPanel
            assetId={asset.id}
            accessories={asset.accessories}
            accessoryTypes={accessoryTypes}
            canManage={canManage && !removed}
            editing={accessoryEditing}
            baseHref={baseHref}
          />
        ) : null}
        {tab === 'maintenance' && asset.maintenance ? (
          <MaintenancePanel records={asset.maintenance} activeCount={asset.activeMaintenanceCount} timeZone={timeZone} />
        ) : null}
        {tab === 'issues' && asset.issues ? <IssuesPanel issues={asset.issues} timeZone={timeZone} /> : null}
        {tab === 'history' ? <HistoryTimeline events={history} timeZone={timeZone} now={now} /> : null}
      </div>
    </>
  )
}
