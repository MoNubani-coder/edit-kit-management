import { Wrench } from 'lucide-react'

import { EmptyState } from '@/components/common/empty-state'
import { humanizeStatus, MaintenanceStatusBadge } from '@/components/common/status-badge'
import { Alert } from '@/components/ui/alert'
import { formatDate } from '@/lib/datetime'
import type { AssetMaintenanceRow } from '@/server/dal/assets.dal'

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const TD = 'px-4 py-3 align-middle'

const Empty = () => <span className="text-subtle">—</span>

/** Read-only maintenance information; the maintenance workflow itself comes later. */
export function MaintenancePanel({
  records,
  activeCount,
  timeZone,
}: {
  records: AssetMaintenanceRow[]
  activeCount: number
  timeZone: string
}) {
  return (
    <div className="space-y-4">
      {activeCount > 0 ? (
        <Alert variant="warning" title="Unavailable while maintenance is active">
          Equipment with maintenance in progress or on hold cannot be booked, handed over or marked available until the work is completed or cancelled.
        </Alert>
      ) : null}

      <div className="theme-transition overflow-hidden rounded-panel border border-line bg-panel">
        <header className="border-b border-line bg-panel-header px-5 py-3">
          <h3 className="font-display text-[15px] font-semibold text-foreground">Maintenance records</h3>
          <p className="mt-0.5 text-xs text-muted">Calibration, repair and service history. Newest first.</p>
        </header>
        {records.length === 0 ? (
          <EmptyState compact icon={Wrench} title="No maintenance recorded" description="Scheduled and completed work on this equipment will be listed here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className={TH}>Number</th>
                  <th scope="col" className={TH}>Type</th>
                  <th scope="col" className={TH}>Status</th>
                  <th scope="col" className={TH}>Scheduled</th>
                  <th scope="col" className={`${TH} hidden md:table-cell`}>Started</th>
                  <th scope="col" className={`${TH} hidden md:table-cell`}>Completed</th>
                  <th scope="col" className={`${TH} hidden lg:table-cell`}>Vendor</th>
                  <th scope="col" className={`${TH} hidden xl:table-cell`}>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className="border-t border-line transition-colors hover:bg-panel-header">
                    <td className={TD}>
                      <p className="font-mono text-xs font-semibold text-accent-foreground">{record.maintenanceNumber}</p>
                      <p className="mt-0.5 max-w-xs truncate text-xs text-muted">{record.title}</p>
                    </td>
                    <td className={`${TD} text-foreground`}>{humanizeStatus(record.type)}</td>
                    <td className={TD}>
                      <MaintenanceStatusBadge status={record.status} />
                    </td>
                    <td className={`${TD} whitespace-nowrap tabular-nums text-foreground`}>{record.scheduledFor ? formatDate(record.scheduledFor, timeZone) : <Empty />}</td>
                    <td className={`${TD} hidden whitespace-nowrap tabular-nums text-foreground md:table-cell`}>{record.startedAt ? formatDate(record.startedAt, timeZone) : <Empty />}</td>
                    <td className={`${TD} hidden whitespace-nowrap tabular-nums text-foreground md:table-cell`}>{record.completedAt ? formatDate(record.completedAt, timeZone) : <Empty />}</td>
                    <td className={`${TD} hidden text-foreground lg:table-cell`}>{record.vendor ?? <Empty />}</td>
                    <td className={`${TD} hidden max-w-xs truncate text-muted xl:table-cell`}>{record.outcome ?? <Empty />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
