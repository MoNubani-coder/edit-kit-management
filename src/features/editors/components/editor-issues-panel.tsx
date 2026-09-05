import { ShieldCheck } from 'lucide-react'

import { EmptyState } from '@/components/common/empty-state'
import { humanizeStatus, IssueSeverityBadge, IssueStatusBadge } from '@/components/common/status-badge'
import { formatDate } from '@/lib/datetime'
import type { EditorIssueRow } from '@/server/dal/editors.dal'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-middle'

/** Issues raised on this editor's bookings - missing, damaged or faulty equipment at return. */
export function EditorIssuesPanel({ issues, timeZone }: { issues: EditorIssueRow[]; timeZone: string }) {
  return (
    <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
      <header className="border-b border-line bg-panel-header px-5 py-3">
        <h3 className="font-display text-[15px] font-semibold text-foreground">Issues on this editor’s bookings</h3>
        <p className="mt-0.5 text-xs text-muted">Reports raised at handover or return against kits issued to this editor. Newest first.</p>
      </header>
      {issues.length === 0 ? (
        <EmptyState compact icon={ShieldCheck} title="No issues" description="No missing, damaged or faulty equipment has been reported on this editor’s bookings." />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className={TH}>Issue</th>
                <th scope="col" className={TH}>Booking</th>
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
                    <p className="font-mono text-xs font-semibold text-accent-foreground">{issue.issueNumber}</p>
                    <p className="mt-0.5 max-w-xs truncate text-xs text-muted">{issue.title}</p>
                  </td>
                  <td className={`${TD} font-mono text-xs text-foreground`}>{issue.bookingNumber ?? <span className="text-subtle">—</span>}</td>
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
