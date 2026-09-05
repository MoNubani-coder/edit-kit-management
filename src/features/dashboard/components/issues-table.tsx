import { ShieldCheck } from 'lucide-react'

import { EmptyState } from '@/components/common/empty-state'
import { humanizeStatus, IssueSeverityBadge, IssueStatusBadge } from '@/components/common/status-badge'
import { formatDate } from '@/lib/datetime'
import type { DashboardIssueRow } from '@/server/dal/dashboard.dal'

const TH = 'px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-5 py-3 align-middle'

export function IssuesTable({ rows, timeZone }: { rows: DashboardIssueRow[]; timeZone: string }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={ShieldCheck}
        title="No open issues"
        description="Missing, damaged or faulty equipment reports will appear here."
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr>
            <th scope="col" className={TH}>Issue</th>
            <th scope="col" className={TH}>Equipment</th>
            <th scope="col" className={TH}>Type</th>
            <th scope="col" className={TH}>Severity</th>
            <th scope="col" className={TH}>Reported</th>
            <th scope="col" className={TH}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-line transition-colors hover:bg-panel-header">
              <td className={TD}>
                <p className="font-mono text-xs font-medium text-accent-foreground">{row.issueNumber}</p>
                <p className="mt-0.5 max-w-xs truncate text-xs text-muted">{row.title}</p>
              </td>
              <td className={`${TD} text-foreground`}>
                <p>{row.assetLabel ?? <span className="text-subtle">—</span>}</p>
                {row.kitLabel ? <p className="mt-0.5 text-xs text-muted">{row.kitLabel}</p> : null}
              </td>
              <td className={`${TD} text-foreground`}>{humanizeStatus(row.type)}</td>
              <td className={TD}>
                <IssueSeverityBadge severity={row.severity} />
              </td>
              <td className={`${TD} whitespace-nowrap tabular-nums text-foreground`}>{formatDate(row.reportedAt, timeZone)}</td>
              <td className={TD}>
                <IssueStatusBadge status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
