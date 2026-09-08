import { Plus, Search } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/components/common/section-tabs'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { issuesHref } from '@/features/issues/hrefs'
import { IssuesTable } from '@/features/issues/components/issues-table'
import { env } from '@/lib/env'
import { cn } from '@/lib/utils/cn'
import { ISSUE_DEFAULT_PAGE_SIZE, ISSUE_FILTER_LABELS, ISSUE_FILTERS, parseIssueListParams } from '@/lib/validation/issues'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { loadIssueList } from '@/server/services/issues.service'

export const metadata: Metadata = { title: 'Issues' }

export const dynamic = 'force-dynamic'

/**
 * Missing, damaged and faulty equipment.
 *
 * Almost everything here arrived on its own: a return that recorded a problem
 * raised the issue, numbered it and pointed it at the equipment, the kit and
 * the booking (Phase 9). This page is where those get worked - picked up,
 * resolved and closed - and where a problem noticed outside a return gets
 * reported.
 */
export default async function IssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // The page decides the refusal, so a role without issue.read gets the 403
  // page rather than the service's error escaping as a 500.
  await requirePermissionForPage('issue.read')
  const query = await searchParams
  const params = parseIssueListParams(query)
  const page = await loadIssueList(params)

  const tabs = ISSUE_FILTERS.map((filter) => ({
    key: filter,
    label: ISSUE_FILTER_LABELS[filter],
    href: issuesHref(params, { filter, page: 1 }),
    count: page.counts[filter],
  }))

  return (
    <>
      <PageHeader
        eyebrow="Operations / Issues"
        title="Issues"
        description="Missing, damaged and faulty equipment. Returns raise these automatically; anything noticed elsewhere can be reported here."
        actions={
          page.canReport ? (
            <Link href="/issues/new" className={buttonVariants({ variant: 'primary' })}>
              <Plus aria-hidden className="h-4 w-4" />
              Report an issue
            </Link>
          ) : null
        }
        tabs={<SectionTabs label="Issue filters" tabs={tabs} active={params.filter} />}
      />

      <div className="space-y-4">
        <form method="get" action="/issues" role="search" className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          {params.filter !== 'open' ? <input type="hidden" name="filter" value={params.filter} /> : null}
          {params.sort !== 'reportedAt' ? <input type="hidden" name="sort" value={params.sort} /> : null}
          {params.dir !== 'desc' ? <input type="hidden" name="dir" value={params.dir} /> : null}
          {params.pageSize !== ISSUE_DEFAULT_PAGE_SIZE ? <input type="hidden" name="pageSize" value={params.pageSize} /> : null}
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input
              type="search"
              name="q"
              defaultValue={params.q ?? ''}
              placeholder="Search issue number, title, equipment code, serial, kit or booking…"
              aria-label="Search issues"
              autoComplete="off"
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="secondary">
              Search
            </Button>
            {params.q ? (
              <Link href={issuesHref(params, { q: undefined, page: 1 })} className={cn(buttonVariants({ variant: 'ghost' }), 'whitespace-nowrap')}>
                Clear
              </Link>
            ) : null}
          </div>
        </form>

        <IssuesTable result={page.result} params={params} timeZone={env.APP_TIMEZONE} filtered={Boolean(params.q) || params.filter !== 'open'} canReport={page.canReport} />
      </div>
    </>
  )
}
