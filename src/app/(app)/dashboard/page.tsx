import type { Metadata } from 'next'

import { PageHeader } from '@/components/common/page-header'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/constants/roles'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { permissionsFor } from '@/server/auth/permissions'

export const metadata: Metadata = { title: 'Dashboard' }

const TILES = ['Available kits', 'Reserved', 'Checked out', 'Overdue', 'In maintenance', 'Open issues']

/**
 * Placeholder dashboard. Live tiles and activity panels arrive in Phase 3;
 * for now it confirms who is signed in and what they are allowed to do.
 */
export default async function DashboardPage() {
  const actor = await requirePermissionForPage('dashboard.view')
  const permissions = permissionsFor(actor.role)

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Signed in as ${actor.name} · ${ROLE_LABELS[actor.role]}`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {TILES.map((label) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-600">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-300">—</p>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Your role</h2>
          <p className="mt-1 text-sm text-slate-600">{ROLE_DESCRIPTIONS[actor.role]}</p>
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {permissions.map((permission) => (
              <li
                key={permission}
                className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700"
              >
                {permission}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-dashed border-slate-300 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Coming in Phase 3</h2>
          <p className="mt-1 text-sm text-slate-600">
            Live kit counts, upcoming handovers and returns, overdue bookings and recent
            activity replace these placeholders once the application shell is complete.
          </p>
        </section>
      </div>
    </>
  )
}
