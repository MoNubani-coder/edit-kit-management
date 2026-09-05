import type { AssetStatus, BookingStatus, IssueSeverity, IssueStatus, MaintenanceStatus } from '@prisma/client'

import { Badge, type BadgeTone } from '@/components/ui/badge'

/**
 * Status vocabulary -> badge tone and label. One mapping, used everywhere a
 * status appears, so "checked out" is the same colour on every screen. Tones
 * stay calm: red is reserved for overdue and critical, never for ordinary
 * states.
 */

const BOOKING_TONES: Record<BookingStatus, BadgeTone> = {
  DRAFT: 'neutral',
  RESERVED: 'blue',
  READY_FOR_HANDOVER: 'blue',
  CHECKED_OUT: 'green',
  OVERDUE: 'red',
  RETURN_INSPECTION: 'amber',
  COMPLETED: 'neutral',
  CANCELLED: 'neutral',
}

const ISSUE_TONES: Record<IssueStatus, BadgeTone> = {
  OPEN: 'amber',
  UNDER_INVESTIGATION: 'blue',
  RESOLVED: 'green',
  CLOSED: 'neutral',
}

const ASSET_TONES: Record<AssetStatus, BadgeTone> = {
  AVAILABLE: 'green',
  RESERVED: 'blue',
  CHECKED_OUT: 'blue',
  MAINTENANCE: 'amber',
  DAMAGED: 'amber',
  MISSING: 'red',
  RETIRED: 'neutral',
}

const MAINTENANCE_TONES: Record<MaintenanceStatus, BadgeTone> = {
  SCHEDULED: 'blue',
  IN_PROGRESS: 'amber',
  ON_HOLD: 'amber',
  COMPLETED: 'green',
  CANCELLED: 'neutral',
}

const SEVERITY_TONES: Record<IssueSeverity, BadgeTone> = {
  LOW: 'neutral',
  MEDIUM: 'blue',
  HIGH: 'amber',
  CRITICAL: 'red',
}

/** `READY_FOR_HANDOVER` -> `Ready for handover` */
export function humanizeStatus(value: string): string {
  const words = value.toLowerCase().split('_')
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(' ')
}

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return (
    <Badge tone={BOOKING_TONES[status]} dot>
      {humanizeStatus(status)}
    </Badge>
  )
}

export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  return (
    <Badge tone={ISSUE_TONES[status]} dot>
      {humanizeStatus(status)}
    </Badge>
  )
}

export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  return (
    <Badge tone={ASSET_TONES[status]} dot>
      {humanizeStatus(status)}
    </Badge>
  )
}

export function MaintenanceStatusBadge({ status }: { status: MaintenanceStatus }) {
  return (
    <Badge tone={MAINTENANCE_TONES[status]} dot>
      {humanizeStatus(status)}
    </Badge>
  )
}

export function IssueSeverityBadge({ severity }: { severity: IssueSeverity }) {
  return <Badge tone={SEVERITY_TONES[severity]}>{humanizeStatus(severity)}</Badge>
}
