import type { Metadata } from 'next'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { SectionTabs } from '@/components/common/section-tabs'
import { requirePermissionForPage } from '@/server/auth/page-guards'

export const metadata: Metadata = { title: 'Kits' }

const TABS = [
  { key: 'all', label: 'All kits' },
  { key: 'available', label: 'Available' },
  { key: 'reserved', label: 'Reserved' },
  { key: 'checked-out', label: 'Checked out' },
  { key: 'maintenance', label: 'Maintenance' },
] as const

type TabKey = (typeof TABS)[number]['key']

function parseTab(value: string | string[] | undefined): TabKey {
  const key = Array.isArray(value) ? value[0] : value
  return TABS.some((tab) => tab.key === key) ? (key as TabKey) : 'all'
}

export default async function KitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requirePermissionForPage('kit.read')
  const active = parseTab((await searchParams).status)
  const activeLabel = TABS.find((tab) => tab.key === active)?.label ?? 'All kits'

  return (
    <PlaceholderPage
      eyebrow="Operations / Kits"
      title="Kits"
      description="Named, barcoded collections of equipment issued to editors."
      phase={5}
      emptyTitle={`${activeLabel} — kit lists arrive in Phase 5`}
      tabs={
        <SectionTabs
          label="Kit status"
          active={active}
          tabs={TABS.map((tab) => ({
            key: tab.key,
            label: tab.label,
            href: tab.key === 'all' ? '/kits' : `/kits?status=${tab.key}`,
          }))}
        />
      }
    />
  )
}
