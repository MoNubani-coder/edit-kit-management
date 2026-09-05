import { Plus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/components/common/section-tabs'
import { buttonVariants } from '@/components/ui/button'
import { EditorsTable } from '@/features/editors/components/editors-table'
import { EditorsToolbar } from '@/features/editors/components/editors-toolbar'
import { editorsHref } from '@/features/editors/hrefs'
import { env } from '@/lib/env'
import { EDITOR_VIEW_LABELS, EDITOR_VIEWS, parseEditorListParams } from '@/lib/validation/editors'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { can } from '@/server/auth/permissions'
import { loadEditorList } from '@/server/services/editors.service'

export const metadata: Metadata = { title: 'Editors' }

export const dynamic = 'force-dynamic'

/**
 * The editor directory: internal and external editors, searchable by name,
 * staff ID, contact number and email, with type and status tabs and
 * server-side pagination. An exact staff ID opens the editor directly.
 */
export default async function EditorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requirePermissionForPage('editor.read')
  const params = parseEditorListParams(await searchParams)

  const page = await loadEditorList({
    search: params.q,
    view: params.view,
    sort: params.sort,
    direction: params.dir,
    page: params.page,
    pageSize: params.pageSize,
  })

  if (page.matchedEditorId) redirect(`/editors/${page.matchedEditorId}`)

  const canManage = can(page.actor, 'editor.manage')
  const tabs = EDITOR_VIEWS.map((view) => ({ key: view, label: EDITOR_VIEW_LABELS[view], href: editorsHref(params, { view }), count: page.counts[view] }))

  return (
    <>
      <PageHeader
        eyebrow="Operations / Editors"
        title="Editors"
        description="Internal and external editors who receive kits. External editors have no account and sign in person; internal editors may be linked to one."
        actions={
          canManage ? (
            <Link href="/editors/new" className={buttonVariants({ variant: 'primary' })}>
              <Plus aria-hidden className="h-4 w-4" />
              New editor
            </Link>
          ) : null
        }
        tabs={<SectionTabs label="Editor filters" tabs={tabs} active={params.view} />}
      />

      <div className="space-y-4">
        <EditorsToolbar params={params} clearHref={editorsHref(params, { q: undefined })} />
        <EditorsTable result={page.result} params={params} timeZone={env.APP_TIMEZONE} canManage={canManage} />
      </div>
    </>
  )
}
