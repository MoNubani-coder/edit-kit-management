import type { AuditAction } from '@prisma/client'
import {
  Activity,
  CalendarRange,
  ClipboardCheck,
  KeyRound,
  type LucideIcon,
  PenLine,
  Settings,
  ShieldAlert,
  TriangleAlert,
  Wrench,
} from 'lucide-react'

import { EmptyState } from '@/components/common/empty-state'
import { humanizeStatus } from '@/components/common/status-badge'
import { formatDateTime, formatRelative } from '@/lib/datetime'
import type { DashboardActivityRow } from '@/server/dal/dashboard.dal'
import { cn } from '@/lib/utils/cn'

/**
 * Audit entries as a timeline: a hairline rail with a marker per event, the
 * newest marked in teal. Shows the human-readable summary (or a generated
 * one), the actor and when. Never the before/after payloads.
 */

function iconFor(action: AuditAction): LucideIcon {
  if (action.startsWith('BOOKING') || action === 'KIT_ASSIGNED') return CalendarRange
  if (action.startsWith('HANDOVER') || action.startsWith('RETURN')) return ClipboardCheck
  if (action.startsWith('SIGNATURE') || action === 'INSPECTION_VOIDED') return PenLine
  if (action.startsWith('ISSUE')) return TriangleAlert
  if (action.startsWith('MAINTENANCE')) return Wrench
  if (action.startsWith('LOGIN') || action === 'LOGOUT' || action === 'PASSWORD_CHANGED') return KeyRound
  if (action === 'ADMIN_OVERRIDE' || action === 'ROLE_CHANGED') return ShieldAlert
  if (action === 'SETTING_CHANGED') return Settings
  return Activity
}

function describe(row: DashboardActivityRow): string {
  if (row.summary) return row.summary
  const entity = row.entityId ? `${row.entityType} ${row.entityId}` : row.entityType
  return `${humanizeStatus(row.action)} · ${entity}`
}

export function ActivityFeed({
  rows,
  timeZone,
  now,
}: {
  rows: DashboardActivityRow[]
  timeZone: string
  now: Date
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={Activity}
        title="No activity yet"
        description="Bookings, handovers, returns and issues will be recorded here as they happen."
      />
    )
  }

  return (
    <ol className="relative px-5 py-4">
      <span aria-hidden className="absolute bottom-6 left-[2.15rem] top-6 w-px bg-line" />
      {rows.map((row, index) => {
        const Icon = iconFor(row.action)
        const newest = index === 0
        return (
          <li key={row.id} className="relative flex gap-4 py-2.5">
            <div
              className={cn(
                'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
                newest
                  ? 'border-accent bg-accent-soft text-accent-foreground'
                  : 'border-line bg-panel text-subtle',
              )}
            >
              <Icon aria-hidden className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{describe(row)}</p>
              <p className="mt-0.5 text-xs text-muted">
                <span>{row.actorName}</span>
                <span aria-hidden> · </span>
                <time dateTime={row.createdAt.toISOString()} title={formatDateTime(row.createdAt, timeZone)}>
                  {formatRelative(row.createdAt, now)}
                </time>
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
