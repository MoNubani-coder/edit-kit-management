import type { Metadata } from 'next'
import Link from 'next/link'
import { forbidden } from 'next/navigation'

import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/components/common/section-tabs'
import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { ReportFilters } from '@/features/reports/components/report-filters'
import { ReportTable } from '@/features/reports/components/report-table'
import { ForbiddenError } from '@/server/auth/errors'
import { prisma } from '@/server/db/prisma'
import { reportHref } from '@/server/reports/filters'
import { loadReportPage } from '@/server/services/reports.service'

export const metadata: Metadata = { title: 'Report' }

export const dynamic = 'force-dynamic'

/**
 * One report: its filters, its table and its CSV link.
 *
 * The page knows nothing about which report it is showing. It authorises,
 * runs, and hands `{ columns, rows }` to the renderer (AD-5), which is why
 * adding a report needs no page work at all.
 */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { report: reportId } = await params
  const raw = await searchParams

  let page
  try {
    page = await loadReportPage(reportId, raw)
  } catch (error) {
    // A report that does not exist and one this reader may not run are the
    // same answer, so a URL cannot be used to enumerate reports.
    if (error instanceof ForbiddenError) forbidden()
    throw error
  }

  const { report, query, result, catalogue, timeZone, ownOnly } = page

  // Filter options only for the filters this report offers.
  const [kits, editors] = await Promise.all([
    report.filters.includes('kitId')
      ? prisma.kit.findMany({ where: { deletedAt: null }, orderBy: [{ kitCode: 'asc' }], select: { id: true, kitCode: true, name: true }, take: 100 })
      : Promise.resolve([]),
    report.filters.includes('editorId')
      ? prisma.editorProfile.findMany({ where: { deletedAt: null }, orderBy: [{ fullName: 'asc' }], select: { id: true, fullName: true, staffId: true }, take: 200 })
      : Promise.resolve([]),
  ])

  const tabs = catalogue.flatMap((group) => group.reports).map((entry) => ({ key: entry.id, label: entry.title, href: `/reports/${entry.id}` }))

  return (
    <>
      <PageHeader
        eyebrow="Operations / Reports"
        title={report.title}
        description={report.description}
        actions={
          <Link href="/reports" className={buttonVariants({ variant: 'secondary' })}>
            All reports
          </Link>
        }
        tabs={<SectionTabs label="Reports" tabs={tabs} active={report.id} />}
      />

      <div className="space-y-4">
        {ownOnly ? (
          <Alert variant="info" title="Your own bookings only">
            This report is limited to bookings made in your name.
          </Alert>
        ) : null}

        <ReportFilters
          report={report}
          query={query}
          kits={kits.map((kit) => ({ id: kit.id, label: `${kit.kitCode} · ${kit.name}` }))}
          editors={editors.map((editor) => ({ id: editor.id, label: editor.staffId ? `${editor.fullName} · ${editor.staffId}` : editor.fullName }))}
        />

        <ReportTable reportId={report.id} result={result} query={query} timeZone={timeZone} csvHref={reportHref(report.id, query, { page: 1 }, '/api/reports')} />
      </div>
    </>
  )
}
