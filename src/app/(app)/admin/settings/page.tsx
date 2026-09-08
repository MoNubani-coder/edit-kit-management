import { Settings2 } from 'lucide-react'
import type { Metadata } from 'next'
import { Fragment } from 'react'

import { EmptyState } from '@/components/common/empty-state'
import { PageHeader } from '@/components/common/page-header'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { AdminTabs } from '@/features/admin/components/admin-tabs'
import { formatDateTime } from '@/lib/datetime'
import { env } from '@/lib/env'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { listSettings } from '@/server/dal/admin.dal'
import { prisma } from '@/server/db/prisma'

export const metadata: Metadata = { title: 'Settings' }

export const dynamic = 'force-dynamic'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-top'

/**
 * What this instance is configured as.
 *
 * Read-only, and deliberately so. Two kinds of configuration exist, and only
 * one of them means anything today:
 *
 *  - **The environment**, which the application genuinely reads on every
 *    request through `src/lib/env.ts`. Those values are shown below. Changing
 *    one means changing the deployment's environment and restarting.
 *  - **The `app_settings` table**, which was created in Phase 1 and seeded
 *    with sensible defaults - and which no code reads yet. Editing those rows
 *    would change nothing, so this page shows them as stored values with that
 *    said plainly, rather than offering controls that quietly do nothing.
 *
 * Making them live is a product decision, not a screen: the loan-day default
 * and the overdue grace period change how bookings behave, and the two
 * maintenance settings belong to a maintenance workflow that does not exist.
 * See DEVELOPMENT.md for the decision this is waiting on.
 *
 * Nothing sensitive appears here: no secrets, no connection string, no
 * filesystem paths.
 */

/** The environment values that are safe to display, and that actually apply. */
function effectiveConfiguration() {
  return [
    { label: 'Organisation', value: env.APP_ORG_NAME, detail: 'Printed at the top of every handover and return document.' },
    { label: 'Application name', value: env.APP_NAME, detail: 'Shown in the browser tab and the sign-in page.' },
    { label: 'Business time zone', value: env.APP_TIMEZONE, detail: 'Every date on screen, in a PDF and in a CSV is rendered in this zone.' },
    { label: 'Due-soon window', value: `${env.BOOKING_DUE_SOON_HOURS} hours`, detail: 'How far ahead the dashboard looks for returns coming due.' },
    { label: 'Session lifetime', value: `${Math.round(env.SESSION_MAX_AGE_SECONDS / 3600)} hours`, detail: 'How long a signed-in session lasts before it must be renewed.' },
    { label: 'Sign-in attempts allowed', value: String(env.MAX_LOGIN_ATTEMPTS), detail: `Then the account is locked for ${env.LOGIN_LOCKOUT_MINUTES} minutes.` },
    { label: 'Evidence storage', value: env.STORAGE_PROVIDER === 'LOCAL' ? 'Local disk' : 'Azure Blob Storage', detail: 'Where signature images and photos are kept. The provider is recorded on each file, so it can change without breaking older records.' },
    { label: 'Upload limit', value: `${Math.round(env.MAX_UPLOAD_BYTES / 1_048_576)} MB`, detail: 'The largest photo or signature the server will accept.' },
  ]
}

/** A stored setting rendered as the words it holds, never as raw JSON. */
function describe(value: unknown): string {
  if (value === null) return 'not set'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return Array.isArray(value) ? `${value.length} entries` : 'a structured value'
}

export default async function AdminSettingsPage() {
  const actor = await requirePermissionForPage('admin.settings.manage')
  const settings = await listSettings(prisma)
  const configuration = effectiveConfiguration()

  const byCategory = new Map<string, typeof settings>()
  for (const setting of settings) {
    byCategory.set(setting.category, [...(byCategory.get(setting.category) ?? []), setting])
  }

  return (
    <>
      <PageHeader
        eyebrow="Administration / Settings"
        title="Settings"
        description="What this instance is configured as. The environment values below are the ones the application reads; the stored settings are not read by anything yet."
        tabs={<AdminTabs actor={actor} active="/admin/settings" />}
      />

      <div className="space-y-4">
        <section className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
          <header className="border-b border-line bg-panel-header px-5 py-3">
            <h2 className="font-display text-[15px] font-semibold text-foreground">Effective configuration</h2>
            <p className="mt-0.5 text-xs text-muted">Read from the environment on every request. Changing one of these means changing the deployment and restarting it.</p>
          </header>
          <dl className="grid gap-px bg-line sm:grid-cols-2">
            {configuration.map((entry) => (
              <div key={entry.label} className="bg-panel px-5 py-4">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{entry.label}</dt>
                <dd className="mt-1 text-sm font-semibold text-foreground">{entry.value}</dd>
                <dd className="mt-0.5 text-xs text-muted">{entry.detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        <Alert variant="warning" title="Stored settings are not live yet">
          The rows below were seeded with the schema and nothing in the application reads them. They are shown because they record an intent, but editing them would
          change no behaviour, so this page does not pretend to. Making them live changes how bookings and inspections behave, and two of them belong to a maintenance
          workflow that has not been built, so it is a decision rather than a form.
        </Alert>

        <section className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
          <header className="border-b border-line bg-panel-header px-5 py-3">
            <h2 className="font-display text-[15px] font-semibold text-foreground">Stored settings</h2>
            <p className="mt-0.5 text-xs text-muted">{settings.length} rows in the settings table, with what each one was seeded to mean.</p>
          </header>

          {settings.length === 0 ? (
            <EmptyState icon={Settings2} title="No stored settings" description="The settings table is empty. Seeding the database fills it with the defaults." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] border-collapse text-sm">
                <thead className="border-b border-line bg-panel-header/60">
                  <tr>
                    <th scope="col" className={TH}>Setting</th>
                    <th scope="col" className={TH}>Value</th>
                    <th scope="col" className={TH}>What it is for</th>
                    <th scope="col" className={`${TH} hidden md:table-cell`}>Last changed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...byCategory.entries()].map(([category, rows]) => (
                    <Fragment key={category}>
                      <tr className="bg-panel-header/40">
                        <th scope="colgroup" colSpan={4} className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-foreground">
                          {category}
                        </th>
                      </tr>
                      {rows.map((setting) => (
                        <tr key={setting.key} className="transition-colors hover:bg-panel-header/60">
                          <td className={`${TD} font-mono text-xs text-foreground`}>{setting.key}</td>
                          <td className={TD}>
                            <Badge tone="slate">{describe(setting.value)}</Badge>
                          </td>
                          <td className={`${TD} max-w-lg text-xs text-muted`}>{setting.description ?? <span className="text-subtle">—</span>}</td>
                          <td className={`${TD} hidden whitespace-nowrap text-xs text-muted md:table-cell`}>
                            <span className="block tabular-nums">{formatDateTime(setting.updatedAt, env.APP_TIMEZONE)}</span>
                            {setting.updatedByName ? <span className="block text-subtle">{setting.updatedByName}</span> : null}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
