import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { SectionTabs } from '@/components/common/section-tabs'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Equipment' }

const TABS = [
  { key: 'all', label: 'All equipment' },
  { key: 'available', label: 'Available' },
  { key: 'checked-out', label: 'Checked out' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'missing-damaged', label: 'Missing / Damaged' },
] as const

type TabKey = (typeof TABS)[number]['key']

function parseTab(value: string | string[] | undefined): TabKey {
  const key = Array.isArray(value) ? value[0] : value
  return TABS.some((tab) => tab.key === key) ? (key as TabKey) : 'all'
}

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requirePermissionForPage('asset.read')
  const active = parseTab((await searchParams).status)
  const activeLabel = TABS.find((tab) => tab.key === active)?.label ?? 'All equipment'

  return (
    <PlaceholderPage
      eyebrow="Operations / Equipment"
      title="Equipment"
      description="Inventory control: serialised assets, their accessories, status history and maintenance records."
      phase={4}
      emptyTitle={`${activeLabel} — inventory lists arrive in Phase 4`}
      tabs={
        <SectionTabs
          label="Equipment status"
          active={active}
          tabs={TABS.map((tab) => ({
            key: tab.key,
            label: tab.label,
            href: tab.key === 'all' ? '/assets' : `/assets?status=${tab.key}`,
          }))}
        />
      }
    />
  )
}
