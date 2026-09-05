import { Pencil } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/components/common/section-tabs'
import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { RemoveEditorForm, SetActiveForm } from '@/features/editors/components/editor-action-forms'
import { EditorActivity } from '@/features/editors/components/editor-activity'
import { EditorActiveBadge, EditorTypeBadge } from '@/features/editors/components/editor-badges'
import { EditorBookingsTable } from '@/features/editors/components/editor-bookings-table'
import { EditorIssuesPanel } from '@/features/editors/components/editor-issues-panel'
import { EditorOverview } from '@/features/editors/components/editor-overview'
import { editorHref } from '@/features/editors/hrefs'
import { formatDateTime } from '@/lib/datetime'
import { env } from '@/lib/env'
import { EDITOR_TAB_LABELS, EDITOR_TABS, type EditorTab, parseEditorTab, parsePage } from '@/lib/validation/editors'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { prisma } from '@/server/db/prisma'
import {
  loadEditorActivity,
  loadEditorBookings,
  loadEditorIssues,
  loadEditorWorkspace,
  loadLinkableUsers,
} from '@/server/services/editors.service'

export const metadata: Metadata = { title: 'Editor' }

export const dynamic = 'force-dynamic'

/**
 * The editor workspace: identity header, then Overview, Active bookings,
 * Booking history, Issues (with issue.read) and Activity tabs driven by
 * `?tab=`; the booking tabs paginate with `?page=`.
 */
export default async function EditorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const actor = await requirePermissionForPage('editor.read')
  const { id } = await params
  const query = await searchParams

  const workspace = await loadEditorWorkspace(prisma, actor, id)
  if (!workspace) notFound()

  const { editor, canManage, canReadIssues, removalBlocker, deactivationBlocker } = workspace
  const timeZone = env.APP_TIMEZONE
  const now = new Date()
  const removed = editor.deletedAt !== null
  const manageable = canManage && !removed

  const available: EditorTab[] = EDITOR_TABS.filter((tab) => tab !== 'issues' || canReadIssues)
  const requested = parseEditorTab(query.tab)
  const tab: EditorTab = available.includes(requested) ? requested : 'overview'
  const page = parsePage(query.page)

  const [bookings, issues, activity, linkableUsers] = await Promise.all([
    tab === 'active' || tab === 'history' ? loadEditorBookings(prisma, id, tab, page) : null,
    tab === 'issues' && canReadIssues ? loadEditorIssues(prisma, id) : null,
    tab === 'activity' ? loadEditorActivity(prisma, id) : null,
    tab === 'overview' && manageable && !editor.isExternal && !editor.linkedUser ? loadLinkableUsers(prisma) : Promise.resolve([]),
  ])

  const counts: Partial<Record<EditorTab, number>> = { active: editor.activeBookingCount, history: editor.totalBookingCount }
  const tabs = available.map((key) => ({ key, label: EDITOR_TAB_LABELS[key], href: editorHref(editor.id, key), count: counts[key] }))

  return (
    <>
      <PageHeader
        eyebrow={`Operations / Editors / ${editor.staffId ?? editor.fullName}`}
        title={editor.fullName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {editor.staffId ? <span className="font-mono text-foreground">{editor.staffId}</span> : null}
            <EditorTypeBadge isExternal={editor.isExternal} />
            <EditorActiveBadge isActive={editor.isActive} />
            <span>{editor.isExternal ? editor.company ?? 'External editor' : editor.department ?? 'Internal editor'}</span>
          </span>
        }
        actions={
          manageable ? (
            <>
              <RemoveEditorForm editorId={editor.id} name={editor.fullName} blocker={removalBlocker} />
              <SetActiveForm editorId={editor.id} name={editor.fullName} isActive={editor.isActive} blocker={deactivationBlocker} />
              <Link href={`/editors/${editor.id}/edit`} className={buttonVariants({ variant: 'secondary' })}>
                <Pencil aria-hidden className="h-4 w-4" />
                Edit
              </Link>
            </>
          ) : null
        }
      />

      <div className="space-y-6">
        {removed ? (
          <Alert variant="warning" title="Removed from the directory">
            This editor was removed on {formatDateTime(editor.deletedAt!, timeZone)}. The record is kept for the audit trail.
          </Alert>
        ) : null}

        <SectionTabs label="Editor sections" tabs={tabs} active={tab} />

        {tab === 'overview' ? <EditorOverview editor={editor} canManage={manageable} linkableUsers={linkableUsers} timeZone={timeZone} /> : null}
        {(tab === 'active' || tab === 'history') && bookings ? (
          <EditorBookingsTable result={bookings} scope={tab} timeZone={timeZone} hrefFor={(next) => editorHref(editor.id, tab, { page: next > 1 ? String(next) : undefined })} />
        ) : null}
        {tab === 'issues' && issues ? <EditorIssuesPanel issues={issues} timeZone={timeZone} /> : null}
        {tab === 'activity' && activity ? <EditorActivity events={activity} timeZone={timeZone} now={now} /> : null}
      </div>
    </>
  )
}
