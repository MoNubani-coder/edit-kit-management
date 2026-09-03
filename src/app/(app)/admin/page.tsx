import type { Metadata } from 'next'
import Link from 'next/link'

import { PageHeader } from '@/components/common/page-header'
import { ADMIN_NAV } from '@/lib/constants/navigation'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { ADMIN_PERMISSIONS, canAny } from '@/server/auth/permissions'

export const metadata: Metadata = { title: 'Administration' }

export default async function AdminIndexPage() {
  const actor = await requirePermissionForPage(ADMIN_PERMISSIONS)
  const sections = ADMIN_NAV.filter((item) => canAny(actor, item.anyOf))

  return (
    <>
      <PageHeader title="Administration" description="Accounts, reference data, audit trail and settings." />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sections.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-slate-400"
            >
              <p className="text-sm font-semibold text-slate-900">{item.label}</p>
              <p className="mt-1 font-mono text-[11px] text-slate-500">{item.anyOf.join(', ')}</p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
