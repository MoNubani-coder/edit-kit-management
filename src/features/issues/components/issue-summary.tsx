import { Boxes, CalendarRange, ClipboardCheck, MonitorSmartphone, Wrench } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { BookingStatusBadge, humanizeStatus, IssueSeverityBadge, IssueStatusBadge } from '@/components/common/status-badge'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/datetime'
import { ISSUE_TYPE_LABELS, type IssueTypeValue } from '@/lib/validation/issues'
import type { IssueDetail } from '@/server/dal/issues.dal'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{label}</dt>
      <dd className="mt-0.5 text-foreground">{children}</dd>
    </div>
  )
}

const Empty = () => <span className="text-subtle">—</span>

/**
 * What the issue is, what it is about, and where it came from.
 *
 * The "what it is about" links are the point of this panel: an issue raised by
 * a return should get you to the equipment, the kit and the booking in one
 * click each - and only to the ones the reader may open.
 */
export function IssueSummary({
  issue,
  timeZone,
  canReadAsset,
  canReadKit,
  canReadBooking,
}: {
  issue: IssueDetail
  timeZone: string
  canReadAsset: boolean
  canReadKit: boolean
  canReadBooking: boolean
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <section className="theme-transition rounded-panel border border-line bg-panel xl:col-span-2">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel-header px-5 py-3">
          <h2 className="font-display text-[15px] font-semibold text-foreground">The problem</h2>
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{ISSUE_TYPE_LABELS[issue.type as IssueTypeValue]}</Badge>
            <IssueSeverityBadge severity={issue.severity} />
            <IssueStatusBadge status={issue.status} />
          </span>
        </header>
        <div className="space-y-4 px-5 py-4">
          <p className="whitespace-pre-line text-sm text-foreground">{issue.description}</p>

          {issue.resolution ? (
            <div className="rounded-lg border border-line bg-panel-header/50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">
                {issue.status === 'CLOSED' && !issue.resolvedAt ? 'Why it was closed' : 'What was done'}
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-foreground">{issue.resolution}</p>
              {issue.resolvedBy ? (
                <p className="mt-2 text-xs text-muted">
                  {issue.resolvedBy.name}
                  {issue.resolvedAt ? ` · ${formatDateTime(issue.resolvedAt, timeZone)}` : ''}
                </p>
              ) : null}
            </div>
          ) : null}

          <dl className="grid gap-4 border-t border-line pt-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Reported">
              {formatDateTime(issue.reportedAt, timeZone)}
              {issue.reportedBy ? <span className="block text-xs text-muted">by {issue.reportedBy.name}</span> : null}
            </Field>
            <Field label="Assigned to">{issue.assignedTo?.name ?? <Empty />}</Field>
            <Field label="Closed">{issue.closedAt ? formatDateTime(issue.closedAt, timeZone) : <Empty />}</Field>
          </dl>
        </div>
      </section>

      <section className="theme-transition rounded-panel border border-line bg-panel">
        <header className="border-b border-line bg-panel-header px-5 py-3">
          <h2 className="font-display text-[15px] font-semibold text-foreground">What it is about</h2>
        </header>
        <dl className="grid gap-4 px-5 py-4 text-sm">
          <Field label="Equipment">
            {issue.asset ? (
              <span className="block">
                {canReadAsset ? (
                  <Link href={`/assets/${issue.asset.id}`} className="flex flex-wrap items-center gap-2 hover:underline">
                    <MonitorSmartphone aria-hidden className="h-4 w-4 text-accent-foreground" />
                    <span className="font-mono text-xs font-semibold text-accent-foreground">{issue.asset.assetCode}</span>
                    <span className="font-medium">{issue.asset.name}</span>
                  </Link>
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-accent-foreground">{issue.asset.assetCode}</span>
                    <span className="font-medium">{issue.asset.name}</span>
                  </span>
                )}
                <span className="mt-1 block text-xs text-muted">
                  {humanizeStatus(issue.asset.status)}
                  {issue.asset.serialNumber ? <span className="font-mono"> · SN {issue.asset.serialNumber}</span> : null}
                </span>
              </span>
            ) : (
              <Empty />
            )}
          </Field>

          {issue.accessory ? (
            <Field label="Accessory">
              {issue.accessory.label ?? issue.accessory.typeName}
              <span className="text-xs text-muted"> · {issue.accessory.typeName}</span>
            </Field>
          ) : null}

          <Field label="Kit">
            {issue.kit ? (
              canReadKit ? (
                <Link href={`/kits/${issue.kit.id}`} className="flex flex-wrap items-center gap-2 hover:underline">
                  <Boxes aria-hidden className="h-4 w-4 text-accent-foreground" />
                  <span className="font-mono text-xs font-semibold text-accent-foreground">{issue.kit.kitCode}</span>
                  <span>{issue.kit.name}</span>
                </Link>
              ) : (
                <span className="font-mono text-xs">{issue.kit.kitCode}</span>
              )
            ) : (
              <Empty />
            )}
          </Field>

          <Field label="Booking">
            {issue.booking ? (
              <span className="block">
                {canReadBooking ? (
                  <Link href={`/bookings/${issue.booking.id}`} className="flex flex-wrap items-center gap-2 hover:underline">
                    <CalendarRange aria-hidden className="h-4 w-4 text-accent-foreground" />
                    <span className="font-mono text-xs font-semibold text-accent-foreground">{issue.booking.bookingNumber}</span>
                    <BookingStatusBadge status={issue.booking.status as never} />
                  </Link>
                ) : (
                  <span className="font-mono text-xs">{issue.booking.bookingNumber}</span>
                )}
                <span className="mt-1 block text-xs text-muted">{issue.booking.editorName}</span>
              </span>
            ) : (
              <Empty />
            )}
          </Field>

          <Field label="Found during">
            {issue.inspection ? (
              <span className="flex flex-wrap items-center gap-2">
                <ClipboardCheck aria-hidden className="h-4 w-4 text-accent-foreground" />
                {issue.inspection.type === 'RETURN' ? 'the return inspection' : 'the handover'}
                {issue.inspection.completedAt ? <span className="text-xs text-muted">{formatDateTime(issue.inspection.completedAt, timeZone)}</span> : null}
              </span>
            ) : (
              <span className="text-subtle">Reported by hand</span>
            )}
          </Field>

          {issue.maintenance.length > 0 ? (
            <Field label="Maintenance">
              <ul className="space-y-1">
                {issue.maintenance.map((record) => (
                  <li key={record.id} className="flex flex-wrap items-center gap-2">
                    <Wrench aria-hidden className="h-3.5 w-3.5 text-subtle" />
                    <span className="font-mono text-xs text-accent-foreground">{record.maintenanceNumber}</span>
                    <Badge tone="neutral">{humanizeStatus(record.status)}</Badge>
                  </li>
                ))}
              </ul>
            </Field>
          ) : null}
        </dl>
      </section>
    </div>
  )
}
