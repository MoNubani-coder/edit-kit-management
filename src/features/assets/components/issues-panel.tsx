import { Plus, ShieldCheck } from 'lucide-react'
import Link from 'next/link'

import { EmptyState } from '@/components/common/empty-state'
import { humanizeStatus, IssueSeverityBadge, IssueStatusBadge } from '@/components/common/status-badge'
import { buttonVariants } from '@/components/ui/button'
import { reportIssueHref } from '@/features/issues/hrefs'
import { formatDate } from '@/lib/datetime'
import type { AssetIssueRow } from '@/server/dal/assets.dal'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-middle'

export function IssuesPanel({ issues, timeZone, assetId, canReport = false }: { issues: AssetIssueRow[]; timeZone: string; assetId?: string; canReport?: boolean }) {
  return (
    <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-panel-header px-5 py-3">
        <div>
          <h3 className="font-display text-[15px] font-semibold text-foreground">Issues</h3>
          <p className="mt-0.5 text-xs text-muted">Open and recent reports against this equipment. Newest first.</p>
        </div>
        {canReport && assetId ? (
          <Link href={reportIssueHref({ assetId })} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            <Plus aria-hidden className="h-4 w-4" />
            Report an issue
          </Link>
        ) : null}
      </header>
      {issues.length === 0 ? (
        <EmptyState
          compact
          icon={ShieldCheck}
          title="No issues reported"
          description="Missing, damaged or faulty reports for this equipment will appear here."
          action={canReport && assetId ? { href: reportIssueHref({ assetId }), label: 'Report an issue' } : undefined}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className={TH}>Issue</th>
                <th scope="col" className={TH}>Type</th>
                <th scope="col" className={TH}>Severity</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Reported</th>
                <th scope="col" className={`${TH} hidden md:table-cell`}>Resolved</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.id} className="border-t border-line transition-colors hover:bg-panel-header">
                  <td className={TD}>
                    <Link href={`/issues/${issue.id}`} className="font-mono text-xs font-semibold text-accent-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                      {issue.issueNumber}
                    </Link>
                    <Link href={`/issues/${issue.id}`} className="mt-0.5 block max-w-xs truncate text-xs text-muted hover:text-foreground hover:underline">
                      {issue.title}
                    </Link>
                  </td>
                  <td className={`${TD} text-foreground`}>{humanizeStatus(issue.type)}</td>
                  <td className={TD}>
                    <IssueSeverityBadge severity={issue.severity} />
                  </td>
                  <td className={TD}>
                    <IssueStatusBadge status={issue.status} />
                  </td>
                  <td className={`${TD} whitespace-nowrap tabular-nums text-foreground`}>{formatDate(issue.reportedAt, timeZone)}</td>
                  <td className={`${TD} hidden whitespace-nowrap tabular-nums text-foreground md:table-cell`}>{issue.resolvedAt ? formatDate(issue.resolvedAt, timeZone) : <span className="text-subtle">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
