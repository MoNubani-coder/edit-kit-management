import 'server-only'

import {
  AssetStatus,
  AuditAction,
  BookingStatus,
  IssueSeverity,
  IssueStatus,
  IssueType,
  KitStatus,
  MaintenanceStatus,
  type Prisma,
} from '@prisma/client'

import type { BusinessDayRange } from '@/lib/datetime'
import type { Db } from '@/server/db/prisma'

/**
 * Dashboard reads.
 *
 * Every function is one indexed query with an explicit `select`, returning a
 * flat display row. Counts are `count()` / `groupBy` in the database, never a
 * table load. Booking reads take the actor's visibility `where` fragment from
 * `bookings.dal.ts`, so the same scoping that protects the bookings list
 * protects the dashboard - an EDITOR's dashboard cannot see another editor's
 * booking because the query cannot return it.
 *
 * Status vocabulary (see docs/ARCHITECTURE.md §12):
 *  - Kit and asset counts use the *stored* status columns; those are the
 *    domain's source of truth and are maintained by the workflows.
 *  - "Overdue" is *derived* at read time (R-3): a booking is overdue when it is
 *    flagged OVERDUE, or is CHECKED_OUT past its expected return.
 */

export const OUT_STATUSES = [BookingStatus.CHECKED_OUT, BookingStatus.OVERDUE] as const

export const LIVE_BOOKING_STATUSES = [
  BookingStatus.RESERVED,
  BookingStatus.READY_FOR_HANDOVER,
  BookingStatus.CHECKED_OUT,
  BookingStatus.OVERDUE,
  BookingStatus.RETURN_INSPECTION,
] as const

export const OPEN_ISSUE_STATUSES = [IssueStatus.OPEN, IssueStatus.UNDER_INVESTIGATION] as const

export const ACTIVE_MAINTENANCE_STATUSES = [MaintenanceStatus.IN_PROGRESS, MaintenanceStatus.ON_HOLD] as const

/** Security telemetry rather than operational activity; shown only to auditors. */
export const AUTH_AUDIT_ACTIONS = [
  AuditAction.LOGIN_SUCCESS,
  AuditAction.LOGIN_FAILED,
  AuditAction.LOGOUT,
  AuditAction.PASSWORD_CHANGED,
] as const

// -----------------------------------------------------------------------------
// Row shapes - the only fields that leave the DAL
// -----------------------------------------------------------------------------

export interface DashboardBookingRow {
  id: string
  bookingNumber: string
  status: BookingStatus
  editorName: string
  kitCode: string
  kitName: string
  bookingStart: Date
  bookingEnd: Date
  collectionDate: Date | null
  expectedReturnDate: Date
  actualReturnDate: Date | null
}

export interface DashboardIssueRow {
  id: string
  issueNumber: string
  type: IssueType
  severity: IssueSeverity
  status: IssueStatus
  title: string
  assetLabel: string | null
  kitLabel: string | null
  reportedAt: Date
}

export interface DashboardActivityRow {
  id: string
  action: AuditAction
  entityType: string
  entityId: string | null
  actorName: string
  summary: string | null
  createdAt: Date
}

const bookingRowSelect = {
  id: true,
  bookingNumber: true,
  status: true,
  bookingStart: true,
  bookingEnd: true,
  collectionDate: true,
  expectedReturnDate: true,
  actualReturnDate: true,
  kit: { select: { kitCode: true, name: true } },
  editor: { select: { fullName: true } },
} satisfies Prisma.BookingSelect

type BookingRecord = Prisma.BookingGetPayload<{ select: typeof bookingRowSelect }>

function toBookingRow(record: BookingRecord): DashboardBookingRow {
  return {
    id: record.id,
    bookingNumber: record.bookingNumber,
    status: record.status,
    editorName: record.editor.fullName,
    kitCode: record.kit.kitCode,
    kitName: record.kit.name,
    bookingStart: record.bookingStart,
    bookingEnd: record.bookingEnd,
    collectionDate: record.collectionDate,
    expectedReturnDate: record.expectedReturnDate,
    actualReturnDate: record.actualReturnDate,
  }
}

// -----------------------------------------------------------------------------
// Counts
// -----------------------------------------------------------------------------

export type KitStatusCounts = Record<KitStatus, number>

/** One `GROUP BY status` over live, active kits (index: kits.status). */
export async function countKitsByStatus(db: Db): Promise<KitStatusCounts> {
  const groups = await db.kit.groupBy({
    by: ['status'],
    where: { deletedAt: null, isActive: true },
    _count: { _all: true },
  })

  const counts = Object.fromEntries(
    Object.values(KitStatus).map((status) => [status, 0]),
  ) as KitStatusCounts

  for (const group of groups) counts[group.status] = group._count._all
  return counts
}

export function countAssetsInMaintenance(db: Db): Promise<number> {
  return db.asset.count({ where: { deletedAt: null, status: AssetStatus.MAINTENANCE } })
}

export function countActiveMaintenanceRecords(db: Db): Promise<number> {
  return db.maintenanceRecord.count({
    where: { deletedAt: null, status: { in: [...ACTIVE_MAINTENANCE_STATUSES] } },
  })
}

/** Uses the partial index issues_open_by_reported_at. */
export function countOpenIssues(db: Db): Promise<number> {
  return db.issue.count({ where: { status: { in: [...OPEN_ISSUE_STATUSES] } } })
}

// -----------------------------------------------------------------------------
// Bookings (always scoped by the actor's visibility fragment)
// -----------------------------------------------------------------------------

/** Overdue = flagged OVERDUE, or CHECKED_OUT and past the expected return. */
export function overdueWhere(now: Date): Prisma.BookingWhereInput {
  return {
    OR: [
      { status: BookingStatus.OVERDUE },
      { status: BookingStatus.CHECKED_OUT, expectedReturnDate: { lt: now } },
    ],
  }
}

export function countOverdueBookings(
  db: Db,
  scope: Prisma.BookingWhereInput,
  now: Date,
): Promise<number> {
  return db.booking.count({ where: { AND: [scope, overdueWhere(now)] } })
}

export async function findOverdueBookings(
  db: Db,
  scope: Prisma.BookingWhereInput,
  now: Date,
  limit: number,
): Promise<DashboardBookingRow[]> {
  const records = await db.booking.findMany({
    where: { AND: [scope, overdueWhere(now)] },
    select: bookingRowSelect,
    orderBy: [{ expectedReturnDate: 'asc' }],
    take: limit,
  })
  return records.map(toBookingRow)
}

/**
 * Bookings that matter today: collections starting today and returns expected
 * today, in the business time zone. Cancelled bookings are noise and excluded.
 */
export async function findTodaysBookings(
  db: Db,
  scope: Prisma.BookingWhereInput,
  today: BusinessDayRange,
  limit: number,
): Promise<DashboardBookingRow[]> {
  const inToday = { gte: today.start, lt: today.end }
  const records = await db.booking.findMany({
    where: {
      AND: [
        scope,
        { status: { not: BookingStatus.CANCELLED } },
        { OR: [{ bookingStart: inToday }, { expectedReturnDate: inToday }] },
      ],
    },
    select: bookingRowSelect,
    orderBy: [{ bookingStart: 'asc' }, { expectedReturnDate: 'asc' }],
    take: limit,
  })
  return records.map(toBookingRow)
}

/** Kits currently out, nearest expected return first (not yet overdue). */
export async function findUpcomingReturns(
  db: Db,
  scope: Prisma.BookingWhereInput,
  now: Date,
  limit: number,
): Promise<DashboardBookingRow[]> {
  const records = await db.booking.findMany({
    where: {
      AND: [scope, { status: { in: [...OUT_STATUSES] } }, { expectedReturnDate: { gte: now } }],
    },
    select: bookingRowSelect,
    orderBy: [{ expectedReturnDate: 'asc' }],
    take: limit,
  })
  return records.map(toBookingRow)
}

/** The actor's most urgent live booking (earliest start still in flight). */
export async function findCurrentBooking(
  db: Db,
  scope: Prisma.BookingWhereInput,
): Promise<DashboardBookingRow | null> {
  const record = await db.booking.findFirst({
    where: { AND: [scope, { status: { in: [...LIVE_BOOKING_STATUSES] } }] },
    select: bookingRowSelect,
    orderBy: [{ bookingStart: 'asc' }],
  })
  return record ? toBookingRow(record) : null
}

/** Most recent bookings first, any status except soft-deleted. */
export async function findBookingHistory(
  db: Db,
  scope: Prisma.BookingWhereInput,
  limit: number,
): Promise<DashboardBookingRow[]> {
  const records = await db.booking.findMany({
    where: scope,
    select: bookingRowSelect,
    orderBy: [{ bookingStart: 'desc' }],
    take: limit,
  })
  return records.map(toBookingRow)
}

// -----------------------------------------------------------------------------
// Issues
// -----------------------------------------------------------------------------

export async function findOpenIssues(db: Db, limit: number): Promise<DashboardIssueRow[]> {
  const records = await db.issue.findMany({
    where: { status: { in: [...OPEN_ISSUE_STATUSES] } },
    select: {
      id: true,
      issueNumber: true,
      type: true,
      severity: true,
      status: true,
      title: true,
      reportedAt: true,
      asset: { select: { assetCode: true, name: true } },
      kit: { select: { kitCode: true, name: true } },
    },
    orderBy: [{ reportedAt: 'desc' }],
    take: limit,
  })

  return records.map((record) => ({
    id: record.id,
    issueNumber: record.issueNumber,
    type: record.type,
    severity: record.severity,
    status: record.status,
    title: record.title,
    assetLabel: record.asset ? `${record.asset.assetCode} · ${record.asset.name}` : null,
    kitLabel: record.kit ? `${record.kit.kitCode} · ${record.kit.name}` : null,
    reportedAt: record.reportedAt,
  }))
}

// -----------------------------------------------------------------------------
// Activity
// -----------------------------------------------------------------------------

export interface RecentActivityOptions {
  /** Include sign-in / sign-out / password events (admin.audit.read). */
  includeAuthEvents: boolean
  limit: number
}

/**
 * Latest audit entries as a feed. Only the human-readable columns are
 * selected: never the JSON payloads, IP address or user agent.
 */
export async function findRecentActivity(
  db: Db,
  options: RecentActivityOptions,
): Promise<DashboardActivityRow[]> {
  return db.auditLog.findMany({
    where: options.includeAuthEvents ? undefined : { action: { notIn: [...AUTH_AUDIT_ACTIONS] } },
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      actorName: true,
      summary: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }],
    take: options.limit,
  })
}
