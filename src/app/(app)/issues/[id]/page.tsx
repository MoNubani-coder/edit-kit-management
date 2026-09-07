import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/common/page-header'
import { IssueSeverityBadge, IssueStatusBadge } from '@/components/common/status-badge'
import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { IssueActivity } from '@/features/issues/components/issue-activity'
import { AssignForm, CloseForm, InvestigateForm, ReopenForm, ResolveForm } from '@/features/issues/components/issue-lifecycle-forms'
import { IssuePhotos } from '@/features/issues/components/issue-photos'
import { IssueSummary } from '@/features/issues/components/issue-summary'
import { ISSUE_TYPE_LABELS, type IssueTypeValue } from '@/lib/validation/issues'
import { env } from '@/lib/env'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { prisma } from '@/server/db/prisma'
import { loadIssuePhotos } from '@/server/services/photos.service'
import { loadIssueWorkspace } from '@/server/services/issues.service'

export const metadata: Metadata = { title: 'Issue' }

export const dynamic = 'force-dynamic'

/**
 * One issue: what is wrong, what it is about, what has been done, and what can
 * be done next.
 *
 * The actions offered come from the service's own transition table, so this
 * page can only ever show a step the server would allow - and the server
 * checks it again when the form is posted.
 */
export default async function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermissionForPage('issue.read')
  const { id } = await params

  const workspace = await loadIssueWorkspace(prisma, actor, id)
  if (!workspace) notFound()

  const { issue, activity, assignees, permissions, nextStatuses, canReadAsset, canReadKit, canReadBooking } = workspace
  const timeZone = env.APP_TIMEZONE
  const photos = await loadIssuePhotos(prisma, issue.id)

  const canInvestigate = nextStatuses.includes('UNDER_INVESTIGATION')
  const canResolve = nextStatuses.includes('RESOLVED')
  const canClose = nextStatuses.includes('CLOSED')
  const canReopen = nextStatuses.includes('OPEN') && (issue.status === 'RESOLVED' || issue.status === 'CLOSED')
  const finished = issue.status === 'CLOSED'

  return (
    <>
      <PageHeader
        eyebrow={`Operations / Issues / ${issue.issueNumber}`}
        title={issue.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-foreground">{issue.issueNumber}</span>
            <IssueStatusBadge status={issue.status} />
            <IssueSeverityBadge severity={issue.severity} />
            <span className="text-muted">{ISSUE_TYPE_LABELS[issue.type as IssueTypeValue]}</span>
            {issue.assignedTo ? <span className="text-muted">· {issue.assignedTo.name}</span> : null}
          </span>
        }
        actions={
          <Link href="/issues" className={buttonVariants({ variant: 'secondary' })}>
            All issues
          </Link>
        }
      />

      <div className="space-y-6">
        {finished ? (
          <Alert variant="info" title="Closed">
            This issue is closed and kept as a record. Reopen it if the same fault comes back.
          </Alert>
        ) : null}

        <IssueSummary issue={issue} timeZone={timeZone} canReadAsset={canReadAsset} canReadKit={canReadKit} canReadBooking={canReadBooking} />

        {permissions.canManage ? (
          <section className="theme-transition rounded-panel border border-accent/40 bg-panel">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel-header px-5 py-3">
              <div>
                <h2 className="font-display text-[15px] font-semibold text-foreground">What happens next</h2>
                <p className="mt-0.5 text-xs text-muted">Every step is checked on the server; nothing here changes equipment status on its own.</p>
              </div>
              {canReopen ? <ReopenForm issueId={issue.id} /> : null}
            </header>
            <div className="grid gap-6 p-5 lg:grid-cols-2">
              <div className="space-y-5">
                {canInvestigate ? <InvestigateForm issueId={issue.id} /> : null}
                {canResolve ? <ResolveForm issueId={issue.id} /> : null}
                {canClose ? <CloseForm issueId={issue.id} needsReason={issue.status !== 'RESOLVED'} /> : null}
                {!canInvestigate && !canResolve && !canClose ? <p className="text-sm text-muted">Nothing to do here while the issue is closed.</p> : null}
              </div>
              <div className="space-y-5">
                <AssignForm issueId={issue.id} assignees={assignees} current={issue.assignedTo?.id ?? null} />
              </div>
            </div>
          </section>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-2">
          <IssuePhotos issueId={issue.id} photos={photos} canAdd={permissions.canAddPhoto} timeZone={timeZone} />
          <IssueActivity events={activity} timeZone={timeZone} />
        </div>
      </div>
    </>
  )
}
