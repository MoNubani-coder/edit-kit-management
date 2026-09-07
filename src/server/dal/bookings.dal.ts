import 'server-only'

import { AuditAction, BookingStatus, type Prisma } from '@prisma/client'

import { HOLDING_STATUSES, OUT_STATUSES as OUT_STATUS_VALUES } from '@/lib/booking-rules'
import { businessDayRange, DEFAULT_TIME_ZONE } from '@/lib/datetime'
import { env } from '@/lib/env'
import type { BookingFilter, BookingSortKey } from '@/lib/validation/bookings'
import { ForbiddenError } from '@/server/auth/errors'
import { can } from '@/server/auth/permissions'
import type { Actor } from '@/server/auth/session'
import { OUT_STATUSES, overdueWhere } from '@/server/dal/dashboard.dal'
import type { Db } from '@/server/db/prisma'

/**
 * Booking reads, scoped to the actor.
 *
 * This is where "an EDITOR sees only their own bookings" is enforced: as a
 * `where` clause derived from the actor, not as a filter applied in a page.
 * Every read goes through `visibilityFor`, so there is no way to list or fetch
 * a booking the actor may not see. Search and quick filters are additional
 * `AND` terms on top of that scope, never a replacement for it.
 *
 * Object-level misses return `null` rather than throwing, so a guessed booking
 * id reveals nothing about whether it exists.
 *
 * Phase 7 extends the module with the paginated workspace list, the detail
 * shape, the overlap query behind the reservation pre-check, the lifecycle
 * context, the activity trail and the reference lookups the booking form needs.
 */

export interface BookingSummary {
  id: string
  bookingNumber: string
  status: BookingStatus
  bookingStart: Date
  bookingEnd: Date
  expectedReturnDate: Date
  kit: { id: string; kitCode: string; name: string }
  editor: { id: string; fullName: string }
  engineer: { id: string; fullName: string }
}

const summarySelect = {
  id: true,
  bookingNumber: true,
  status: true,
  bookingStart: true,
  bookingEnd: true,
  expectedReturnDate: true,
  kit: { select: { id: true, kitCode: true, name: true } },
  editor: { select: { id: true, fullName: true } },
  engineer: { select: { id: true, fullName: true } },
} satisfies Prisma.BookingSelect

/**
 * The `where` fragment expressing what the actor may see.
 *
 *  - `booking.read`     -> every live booking
 *  - `booking.readOwn`  -> bookings whose editor profile belongs to the actor;
 *                          an EDITOR with no profile sees nothing (fail closed)
 *  - neither            -> ForbiddenError
 */
export function visibilityFor(actor: Actor): Prisma.BookingWhereInput {
  if (can(actor, 'booking.read')) {
    return { deletedAt: null }
  }

  if (can(actor, 'booking.readOwn')) {
    // A user without an editor profile has no bookings of their own. An
    // impossible id keeps the query shape identical and guarantees zero rows.
    return { deletedAt: null, editorId: actor.editorProfileId ?? '__no-editor-profile__' }
  }

  throw new ForbiddenError('You do not have permission to view bookings.', 'booking.read')
}

// -----------------------------------------------------------------------------
// List filters
// -----------------------------------------------------------------------------

export const BOOKING_LIST_FILTERS = [
  'all',
  'today',
  'draft',
  'reserved',
  'ready',
  'checked-out',
  'due-soon',
  'overdue',
  'return-inspection',
  'completed',
  'cancelled',
] as const
export type BookingListFilter = (typeof BOOKING_LIST_FILTERS)[number]

export const BOOKING_FILTER_LABELS: Record<BookingListFilter, string> = {
  all: 'All',
  today: 'Today',
  draft: 'Draft',
  reserved: 'Reserved',
  ready: 'Ready for handover',
  'checked-out': 'Checked out',
  'due-soon': 'Due soon',
  overdue: 'Overdue',
  'return-inspection': 'Return inspection',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export function parseBookingListFilter(value: unknown): BookingListFilter {
  return typeof value === 'string' && (BOOKING_LIST_FILTERS as readonly string[]).includes(value)
    ? (value as BookingListFilter)
    : 'all'
}

/** One configurable window (`BOOKING_DUE_SOON_HOURS`, default 48) for the filter and the dashboard. */
export const DUE_SOON_HOURS = env.BOOKING_DUE_SOON_HOURS
const MAX_SEARCH_LENGTH = 100

export interface BookingListOptions {
  /** Free text matched against booking number, kit code, kit name, kit barcode, editor name and staff id. */
  search?: string
  filter?: BookingListFilter
  now?: Date
  timeZone?: string
  limit?: number
}

function filterWhere(filter: BookingListFilter, now: Date, timeZone: string): Prisma.BookingWhereInput | null {
  switch (filter) {
    case 'today': {
      const today = businessDayRange(now, timeZone)
      const inToday = { gte: today.start, lt: today.end }
      return {
        status: { not: BookingStatus.CANCELLED },
        OR: [{ bookingStart: inToday }, { expectedReturnDate: inToday }],
      }
    }
    case 'draft':
      return { status: BookingStatus.DRAFT }
    case 'reserved':
      return { status: BookingStatus.RESERVED }
    case 'ready':
      return { status: BookingStatus.READY_FOR_HANDOVER }
    case 'checked-out':
      return { status: { in: [...OUT_STATUSES] } }
    case 'due-soon':
      return {
        status: { in: [...OUT_STATUSES] },
        expectedReturnDate: { gte: now, lt: new Date(now.getTime() + DUE_SOON_HOURS * 60 * 60 * 1000) },
      }
    case 'overdue':
      return overdueWhere(now)
    case 'return-inspection':
      return { status: BookingStatus.RETURN_INSPECTION }
    case 'completed':
      return { status: BookingStatus.COMPLETED }
    case 'cancelled':
      return { status: BookingStatus.CANCELLED }
    default:
      return null
  }
}

function searchWhere(search: string): Prisma.BookingWhereInput | null {
  const term = search.trim().slice(0, MAX_SEARCH_LENGTH)
  if (!term) return null
  const contains = { contains: term, mode: 'insensitive' as const }
  return {
    OR: [
      { bookingNumber: contains },
      { kit: { kitCode: contains } },
      { kit: { name: contains } },
      { kit: { admBarcode: contains } },
      { editor: { fullName: contains } },
      { editor: { staffId: contains } },
    ],
  }
}

export async function listBookingsForActor(
  db: Db,
  actor: Actor,
  options: BookingListOptions = {},
): Promise<BookingSummary[]> {
  const now = options.now ?? new Date()
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE
  const terms: Prisma.BookingWhereInput[] = [visibilityFor(actor)]

  const byFilter = filterWhere(options.filter ?? 'all', now, timeZone)
  if (byFilter) terms.push(byFilter)

  const bySearch = options.search ? searchWhere(options.search) : null
  if (bySearch) terms.push(bySearch)

  return db.booking.findMany({
    where: { AND: terms },
    select: summarySelect,
    orderBy: [{ bookingStart: 'desc' }],
    take: options.limit ?? 100,
  })
}

export async function getBookingForActor(
  db: Db,
  actor: Actor,
  bookingId: string,
): Promise<BookingSummary | null> {
  return db.booking.findFirst({
    where: { AND: [{ id: bookingId }, visibilityFor(actor)] },
    select: summarySelect,
  })
}

// -----------------------------------------------------------------------------
// Workspace list (paginated, sorted)
// -----------------------------------------------------------------------------

export interface BookingListQuery {
  search?: string
  filter: BookingFilter
  sort: BookingSortKey
  direction: 'asc' | 'desc'
  page: number
  pageSize: number
  now: Date
  timeZone: string
}

export interface BookingListRow {
  id: string
  bookingNumber: string
  status: BookingStatus
  bookingStart: Date
  bookingEnd: Date
  collectionDate: Date | null
  expectedReturnDate: Date
  actualReturnDate: Date | null
  createdAt: Date
  editor: { id: string; fullName: string; staffId: string | null; isExternal: boolean }
  kit: { id: string; kitCode: string; name: string }
  engineer: { id: string; fullName: string }
}

export interface BookingListResult {
  rows: BookingListRow[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

const rowSelect = {
  id: true,
  bookingNumber: true,
  status: true,
  bookingStart: true,
  bookingEnd: true,
  collectionDate: true,
  expectedReturnDate: true,
  actualReturnDate: true,
  createdAt: true,
  editor: { select: { id: true, fullName: true, staffId: true, isExternal: true } },
  kit: { select: { id: true, kitCode: true, name: true } },
  engineer: { select: { id: true, fullName: true } },
} satisfies Prisma.BookingSelect

function orderBy(sort: BookingSortKey, direction: 'asc' | 'desc'): Prisma.BookingOrderByWithRelationInput[] {
  const primary: Prisma.BookingOrderByWithRelationInput = { [sort]: direction }
  return sort === 'bookingNumber' ? [primary] : [primary, { bookingNumber: 'desc' }]
}

export function bookingListWhere(actor: Actor, query: BookingListQuery): Prisma.BookingWhereInput {
  const terms: Prisma.BookingWhereInput[] = [visibilityFor(actor)]
  const byFilter = filterWhere(query.filter, query.now, query.timeZone)
  if (byFilter) terms.push(byFilter)
  const bySearch = query.search ? searchWhere(query.search) : null
  if (bySearch) terms.push(bySearch)
  return { AND: terms }
}

export async function listBookingsPage(db: Db, actor: Actor, query: BookingListQuery): Promise<BookingListResult> {
  const where = bookingListWhere(actor, query)
  const pageSize = Math.max(1, query.pageSize)

  const total = await db.booking.count({ where })
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, query.page), pageCount)

  const rows = await db.booking.findMany({
    where,
    select: rowSelect,
    orderBy: orderBy(query.sort, query.direction),
    skip: (page - 1) * pageSize,
    take: pageSize,
  })

  return { rows, total, page, pageSize, pageCount }
}

/** Counts for every filter tab inside the actor's scope: one group-by plus three windowed counts. */
export async function countBookingsByFilter(db: Db, actor: Actor, now: Date, timeZone: string): Promise<Record<BookingFilter, number>> {
  const scope = visibilityFor(actor)
  const [groups, today, dueSoon, overdue] = await Promise.all([
    db.booking.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
    db.booking.count({ where: { AND: [scope, filterWhere('today', now, timeZone)!] } }),
    db.booking.count({ where: { AND: [scope, filterWhere('due-soon', now, timeZone)!] } }),
    db.booking.count({ where: { AND: [scope, overdueWhere(now)] } }),
  ])
  const byStatus = Object.fromEntries(Object.values(BookingStatus).map((status) => [status, 0])) as Record<BookingStatus, number>
  for (const group of groups) byStatus[group.status] = group._count._all
  return {
    all: groups.reduce((sum, group) => sum + group._count._all, 0),
    today,
    draft: byStatus.DRAFT,
    reserved: byStatus.RESERVED,
    ready: byStatus.READY_FOR_HANDOVER,
    'checked-out': byStatus.CHECKED_OUT + byStatus.OVERDUE,
    'due-soon': dueSoon,
    overdue,
    'return-inspection': byStatus.RETURN_INSPECTION,
    completed: byStatus.COMPLETED,
    cancelled: byStatus.CANCELLED,
  }
}

// -----------------------------------------------------------------------------
// Detail
// -----------------------------------------------------------------------------

export interface BookingDetail {
  id: string
  bookingNumber: string
  status: BookingStatus
  bookingStart: Date
  bookingEnd: Date
  collectionDate: Date | null
  expectedReturnDate: Date
  actualReturnDate: Date | null
  purpose: string | null
  notes: string | null
  cancelledAt: Date | null
  cancelReason: string | null
  createdAt: Date
  updatedAt: Date
  editor: { id: string; fullName: string; staffId: string | null; isExternal: boolean; isActive: boolean; contactNumber: string | null; company: string | null; department: string | null }
  kit: { id: string; kitCode: string; name: string; status: string; admBarcode: string | null }
  engineer: { id: string; fullName: string; staffId: string | null }
  checklistTemplate: { id: string; name: string } | null
}

const detailSelect = {
  id: true,
  bookingNumber: true,
  status: true,
  bookingStart: true,
  bookingEnd: true,
  collectionDate: true,
  expectedReturnDate: true,
  actualReturnDate: true,
  purpose: true,
  notes: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  updatedAt: true,
  editor: { select: { id: true, fullName: true, staffId: true, isExternal: true, isActive: true, contactNumber: true, company: true, department: true } },
  kit: { select: { id: true, kitCode: true, name: true, status: true, admBarcode: true } },
  engineer: { select: { id: true, fullName: true, staffId: true } },
  checklistTemplate: { select: { id: true, name: true } },
} satisfies Prisma.BookingSelect

export async function getBookingDetailForActor(db: Db, actor: Actor, bookingId: string): Promise<BookingDetail | null> {
  return db.booking.findFirst({ where: { AND: [{ id: bookingId }, visibilityFor(actor)] }, select: detailSelect })
}

// -----------------------------------------------------------------------------
// Overlap (the friendly pre-check; the exclusion constraint is the authority)
// -----------------------------------------------------------------------------

export interface OverlappingBooking {
  id: string
  bookingNumber: string
  status: BookingStatus
  bookingStart: Date
  bookingEnd: Date
  editorName: string
}

/**
 * Live bookings of `kitId` whose half-open window [bookingStart, bookingEnd)
 * shares at least one instant with [start, end) - the same predicate as
 * `bookings_no_overlapping_period_per_kit`. A booking ending exactly when the
 * next one starts is adjacent, not a conflict.
 */
export async function findOverlappingBookings(
  db: Db,
  kitId: string,
  start: Date,
  end: Date,
  excludeBookingId?: string,
): Promise<OverlappingBooking[]> {
  const rows = await db.booking.findMany({
    where: {
      kitId,
      deletedAt: null,
      status: { in: [...HOLDING_STATUSES] },
      bookingStart: { lt: end },
      bookingEnd: { gt: start },
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
    },
    orderBy: [{ bookingStart: 'asc' }],
    take: 5,
    select: { id: true, bookingNumber: true, status: true, bookingStart: true, bookingEnd: true, editor: { select: { fullName: true } } },
  })
  return rows.map(({ editor, ...row }) => ({ ...row, editorName: editor.fullName }))
}

// -----------------------------------------------------------------------------
// Lifecycle context
// -----------------------------------------------------------------------------

export interface BookingLifecycleContext {
  id: string
  bookingNumber: string
  status: BookingStatus
  deleted: boolean
  kitId: string
  kitCode: string
  kitStatus: string
  editorId: string
  engineerId: string
  bookingStart: Date
  bookingEnd: Date
  collectionDate: Date | null
  expectedReturnDate: Date
  purpose: string | null
  notes: string | null
}

export async function getBookingLifecycleContext(db: Db, id: string): Promise<BookingLifecycleContext | null> {
  const booking = await db.booking.findUnique({
    where: { id },
    select: {
      id: true,
      bookingNumber: true,
      status: true,
      deletedAt: true,
      kitId: true,
      editorId: true,
      engineerId: true,
      bookingStart: true,
      bookingEnd: true,
      collectionDate: true,
      expectedReturnDate: true,
      purpose: true,
      notes: true,
      kit: { select: { kitCode: true, status: true } },
    },
  })
  if (!booking) return null
  return {
    id: booking.id,
    bookingNumber: booking.bookingNumber,
    status: booking.status,
    deleted: booking.deletedAt !== null,
    kitId: booking.kitId,
    kitCode: booking.kit.kitCode,
    kitStatus: booking.kit.status,
    editorId: booking.editorId,
    engineerId: booking.engineerId,
    bookingStart: booking.bookingStart,
    bookingEnd: booking.bookingEnd,
    collectionDate: booking.collectionDate,
    expectedReturnDate: booking.expectedReturnDate,
    purpose: booking.purpose,
    notes: booking.notes,
  }
}

// -----------------------------------------------------------------------------
// Reference lookups for the booking form
// -----------------------------------------------------------------------------

export interface BookableEditor {
  id: string
  fullName: string
  staffId: string | null
  isExternal: boolean
  isActive: boolean
  deleted: boolean
  contactNumber: string | null
  company: string | null
  department: string | null
}

export async function getBookableEditor(db: Db, editorId: string): Promise<BookableEditor | null> {
  const editor = await db.editorProfile.findUnique({
    where: { id: editorId },
    select: { id: true, fullName: true, staffId: true, isExternal: true, isActive: true, deletedAt: true, contactNumber: true, company: true, department: true },
  })
  if (!editor) return null
  const { deletedAt, ...rest } = editor
  return { ...rest, deleted: deletedAt !== null }
}

export interface EngineerOption {
  id: string
  fullName: string
  staffId: string | null
  userId: string
}

/** Engineers who may be assigned to a booking: live profile, live account that is not disabled. */
export async function listActiveEngineers(db: Db): Promise<EngineerOption[]> {
  return db.engineerProfile.findMany({
    where: { deletedAt: null, isActive: true, user: { deletedAt: null, status: { not: 'DISABLED' } } },
    select: { id: true, fullName: true, staffId: true, userId: true },
    orderBy: [{ fullName: 'asc' }],
  })
}

export async function getEngineerOption(db: Db, engineerId: string): Promise<EngineerOption | null> {
  return db.engineerProfile.findFirst({
    where: { id: engineerId, deletedAt: null, isActive: true, user: { deletedAt: null, status: { not: 'DISABLED' } } },
    select: { id: true, fullName: true, staffId: true, userId: true },
  })
}

// -----------------------------------------------------------------------------
// Activity
// -----------------------------------------------------------------------------

export type BookingActivityKind = 'created' | 'update' | 'status' | 'cancelled' | 'handover' | 'return' | 'other'

export interface BookingActivityEvent {
  id: string
  at: Date
  kind: BookingActivityKind
  title: string
  detail: string | null
  actorName: string | null
}

const AUDIT_KINDS: Partial<Record<AuditAction, BookingActivityKind>> = {
  BOOKING_CREATED: 'created',
  BOOKING_UPDATED: 'update',
  BOOKING_STATUS_CHANGED: 'status',
  BOOKING_CANCELLED: 'cancelled',
  HANDOVER_STARTED: 'handover',
  HANDOVER_COMPLETED: 'handover',
  SIGNATURE_SUBMITTED: 'handover',
  SIGNATURE_VOIDED: 'handover',
  RETURN_STARTED: 'return',
  RETURN_COMPLETED: 'return',
}

function humanize(value: string): string {
  const words = value.toLowerCase().split('_')
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(' ')
}

/** The booking's audit entries as sentences, newest first. Later phases add inspection events. */
export async function getBookingActivity(db: Db, bookingId: string, limit = 100): Promise<BookingActivityEvent[]> {
  const audits = await db.auditLog.findMany({
    where: { entityType: 'Booking', entityId: bookingId },
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
    select: { id: true, action: true, summary: true, actorName: true, createdAt: true, metadata: true },
  })
  return audits.map((audit) => {
    const detail = audit.metadata && typeof audit.metadata === 'object' && 'detail' in audit.metadata ? String((audit.metadata as { detail?: unknown }).detail ?? '') : ''
    return {
      id: `audit:${audit.id}`,
      at: audit.createdAt,
      kind: AUDIT_KINDS[audit.action] ?? 'other',
      title: audit.summary ?? humanize(audit.action),
      detail: detail || null,
      actorName: audit.actorName,
    }
  })
}

export { OUT_STATUS_VALUES as OUT_BOOKING_STATUS_VALUES }
