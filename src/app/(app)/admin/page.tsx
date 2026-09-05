import { ArrowUpRight } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { PageHeader } from '@/components/common/page-header'
import { AdminTabs } from '@/features/admin/components/admin-tabs'
import { ADMIN_NAV } from '@/lib/constants/navigation'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { ADMIN_PERMISSIONS, canAny } from '@/server/auth/permissions'

export const metadata: Metadata = { title: 'Administration' }

export default async function AdminIndexPage() {
  const actor = await requirePermissionForPage(ADMIN_PERMISSIONS)
  const sections = ADMIN_NAV.filter((item) => canAny(actor, item.anyOf))

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Administration"
        description="Accounts, reference data, audit trail and settings."
        tabs={<AdminTabs actor={actor} active={null} />}
      />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sections.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="theme-transition group flex items-start justify-between gap-3 rounded-panel border border-line bg-panel p-5 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>
                <span className="block font-display text-sm font-semibold text-foreground">{item.label}</span>
                <span className="mt-1 block text-xs text-muted">{item.description}</span>
              </span>
              <ArrowUpRight aria-hidden className="h-4 w-4 shrink-0 text-subtle transition-colors group-hover:text-accent-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
