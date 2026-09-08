import { ArrowUpRight, BarChart3 } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { PageHeader } from '@/components/common/page-header'
import { Alert } from '@/components/ui/alert'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { loadReportCatalogue } from '@/server/services/reports.service'

export const metadata: Metadata = { title: 'Reports' }

export const dynamic = 'force-dynamic'

/**
 * The reports catalogue.
 *
 * Grouped by what they answer: what is happening now, what has happened, and
 * what the equipment itself looks like. Only the reports this reader may run
 * are listed, and each one re-checks that when it is opened.
 */
export default async function ReportsPage() {
  // Same reason as /issues: refuse on the page, so the answer is a 403.
  await requirePermissionForPage('report.read')
  const { catalogue, ownOnly } = await loadReportCatalogue()
  const total = catalogue.reduce((sum, group) => sum + group.reports.length, 0)

  return (
    <>
      <PageHeader
        eyebrow="Operations / Reports"
        title="Reports"
        description="Operational and historical reporting, filtered on the server and exportable as CSV."
      />

      <div className="space-y-8">
        {ownOnly ? (
          <Alert variant="info" title="Your own bookings only">
            Reports you open here are limited to bookings made in your name.
          </Alert>
        ) : null}

        {total === 0 ? (
          <Alert variant="info" title="No reports available">
            Your account can open the reports area but none of the individual reports. Ask an administrator if you need one.
          </Alert>
        ) : null}

        {catalogue.map((group) => (
          <section key={group.group} aria-labelledby={`group-${group.group}`}>
            <h2 id={`group-${group.group}`} className="mb-3 flex items-center gap-2 font-display text-[15px] font-semibold text-foreground">
              <BarChart3 aria-hidden className="h-4 w-4 text-accent-foreground" />
              {group.group}
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {group.reports.map((report) => (
                <li key={report.id}>
                  <Link
                    href={`/reports/${report.id}`}
                    className="theme-transition group flex h-full items-start justify-between gap-3 rounded-panel border border-line bg-panel p-5 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>
                      <span className="block font-display text-sm font-semibold text-foreground">{report.title}</span>
                      <span className="mt-1 block text-xs text-muted">{report.description}</span>
                    </span>
                    <ArrowUpRight aria-hidden className="h-4 w-4 shrink-0 text-subtle transition-colors group-hover:text-accent-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}
