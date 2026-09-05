import 'server-only'

import {
  AuditAction,
  type BookingStatus,
  type IssueSeverity,
  type IssueStatus,
  type IssueType,
  type Prisma,
  type UserRole,
  type UserStatus,
} from '@prisma/client'

import type { EditorSortKey, EditorView } from '@/lib/validation/editors'
import { LIVE_BOOKING_STATUSES } from '@/server/dal/kits.dal'
import type { Db } from '@/server/db/prisma'

/**
 * Editor profile reads.
 *
 * An editor profile is the person a kit is issued to. External editors have
 * no account; internal editors may be linked to one (`userId`, unique). Every
 * function here returns flat display rows with explicit selects. About linked
 * users only the display name, role and status leave this module - never a
 * password hash, session version or lockout state. The list is paginated in
 * the database and searched through the trigram indexes on `fullName` and
 * `staffId`; an exact staff id is a point lookup on the unique index.
 */

// -----------------------------------------------------------------------------
// List
// -----------------------------------------------------------------------------

export interface EditorListQuery {
  search?: string
  view: EditorView
  sort: EditorSortKey
  direction: 'asc' | 'desc'
  page: number
  pageSize: number
}

export interface EditorLastBooking {
  id: string
  bookingNumber: string
  status: BookingStatus
  bookingStart: Date
  kitCode: string
}

export interface EditorListRow {
  id: string
  fullName: string
  staffId: string | null
  email: string | null
  contactNumber: string | null
  department: string | null
  company: string | null
  isExternal: boolean
  isActive: boolean
  updatedAt: Date
  linkedUser: { id: string; name: string; status: UserStatus } | null
  activeBookingCount: number
  totalBookingCount: number
  lastBooking: EditorLastBooking | null
}

export interface EditorListResult {
  rows: EditorListRow[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

const liveWhere = { deletedAt: null, status: { in: [...LIVE_BOOKING_STATUSES] } } satisfies Prisma.BookingWhereInput

const listSelect = {
  id: true,
  fullName: true,
  staffId: true,
  email: true,
  contactNumber: true,
  department: true,
  company: true,
  isExternal: true,
  isActive: true,
  updatedAt: true,
  user: { select: { id: true, name: true, status: true } },
  bookings: {
    where: { deletedAt: null },
    orderBy: [{ bookingStart: 'desc' }],
    take: 1,
    select: { id: true, bookingNumber: true, status: true, bookingStart: true, kit: { select: { kitCode: true } } },
  },
  _count: { select: { bookings: { where: liveWhere } } },
} satisfies Prisma.EditorProfileSelect

type ListRecord = Prisma.EditorProfileGetPayload<{ select: typeof listSelect }>

function toListRow(record: ListRecord, totalBookingCount: number): EditorListRow {
  const last = record.bookings[0]
  return {
    id: record.id,
    fullName: record.fullName,
    staffId: record.staffId,
    email: record.email,
    contactNumber: record.contactNumber,
    department: record.department,
    company: record.company,
    isExternal: record.isExternal,
    isActive: record.isActive,
    updatedAt: record.updatedAt,
    linkedUser: record.user,
    activeBookingCount: record._count.bookings,
    totalBookingCount,
    lastBooking: last
      ? { id: last.id, bookingNumber: last.bookingNumber, status: last.status, bookingStart: last.bookingStart, kitCode: last.kit.kitCode }
      : null,
  }
}

function searchWhere(search: string): Prisma.EditorProfileWhereInput | null {
  const term = search.trim().slice(0, 100)
  if (!term) return null
  const contains = { contains: term, mode: 'insensitive' as const }
  return { OR: [{ fullName: contains }, { staffId: contains }, { contactNumber: contains }, { email: contains }] }
}

function viewWhere(view: EditorView): Prisma.EditorProfileWhereInput {
  switch (view) {
    case 'internal':
      return { isExternal: false }
    case 'external':
      return { isExternal: true }
    case 'active':
      return { isActive: true }
    case 'inactive':
      return { isActive: false }
    default:
      return {}
  }
}

export function editorListWhere(query: EditorListQuery): Prisma.EditorProfileWhereInput {
  const terms: Prisma.EditorProfileWhereInput[] = [{ deletedAt: null }, viewWhere(query.view)]
  const bySearch = query.search ? searchWhere(query.search) : null
  if (bySearch) terms.push(bySearch)
  return { AND: terms }
}

function orderBy(sort: EditorSortKey, direction: 'asc' | 'desc'): Prisma.EditorProfileOrderByWithRelationInput[] {
  const primary: Prisma.EditorProfileOrderByWithRelationInput = { [sort]: direction }
  return sort === 'fullName' ? [primary, { id: 'asc' }] : [primary, { fullName: 'asc' }]
}

export async function listEditors(db: Db, query: EditorListQuery): Promise<EditorListResult> {
  const where = editorListWhere(query)
  const pageSize = Math.max(1, query.pageSize)

  const total = await db.editorProfile.count({ where })
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, query.page), pageCount)

  const records = await db.editorProfile.findMany({
    where,
    select: listSelect,
    orderBy: orderBy(query.sort, query.direction),
    skip: (page - 1) * pageSize,
    take: pageSize,
  })

  // Total bookings per editor on this page: one grouped query, no N+1.
  const totals = await db.booking.groupBy({
    by: ['editorId'],
    where: { deletedAt: null, editorId: { in: records.map((record) => record.id) } },
    _count: { _all: true },
  })
  const totalByEditor = new Map(totals.map((group) => [group.editorId, group._count._all]))

  return { rows: records.map((record) => toListRow(record, totalByEditor.get(record.id) ?? 0)), total, page, pageSize, pageCount }
}

export type EditorViewCounts = Record<EditorView, number>

/** One grouped query over live profiles feeds every tab count. */
export async function countEditorsByView(db: Db): Promise<EditorViewCounts> {
  const groups = await db.editorProfile.groupBy({ by: ['isExternal', 'isActive'], where: { deletedAt: null }, _count: { _all: true } })
  const counts: EditorViewCounts = { all: 0, internal: 0, external: 0, active: 0, inactive: 0 }
  for (const group of groups) {
    const n = group._count._all
    counts.all += n
    if (group.isExternal) counts.external += n
    else counts.internal += n
    if (group.isActive) counts.active += n
    else counts.inactive += n
  }
  return counts
}

/** Exact staff-id lookup (case-insensitive) - the scanner / fast-picker path. */
export async function findEditorIdByStaffId(db: Db, staffId: string): Promise<string | null> {
  const code = staffId.trim()
  if (!code) return null
  const editor = await db.editorProfile.findFirst({
    where: { staffId: { equals: code, mode: 'insensitive' }, deletedAt: null },
    select: { id: true },
  })
  return editor?.id ?? null
}

// -----------------------------------------------------------------------------
// Picker (Phase 7 readiness)
// -----------------------------------------------------------------------------

export interface EditorPickerRow {
  id: string
  fullName: string
  staffId: string | null
  contactNumber: string | null
  isExternal: boolean
  company: string | null
  department: string | null
}

/**
 * Active, live editors matching `term` on name, staff id or contact number,
 * an exact staff id first. Inactive and removed editors are never returned:
 * they cannot receive new bookings.
 */
export async function searchActiveEditors(db: Db, term: string, limit = 10): Promise<EditorPickerRow[]> {
  const search = term.trim().slice(0, 100)
  if (!search) return []
  const contains = { contains: search, mode: 'insensitive' as const }
  const rows = await db.editorProfile.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      OR: [{ fullName: contains }, { staffId: contains }, { contactNumber: contains }],
    },
    select: { id: true, fullName: true, staffId: true, contactNumber: true, isExternal: true, company: true, department: true },
    orderBy: [{ fullName: 'asc' }],
    take: limit,
  })
  const upper = search.toUpperCase()
  return rows.sort((a, b) => Number(b.staffId?.toUpperCase() === upper) - Number(a.staffId?.toUpperCase() === upper) || a.fullName.localeCompare(b.fullName))
}

// -----------------------------------------------------------------------------
// Detail
// -----------------------------------------------------------------------------

export interface EditorLinkedUser {
  id: string
  name: string
  email: string
  role: UserRole
  status: UserStatus
  deleted: boolean
}

export interface EditorDetail {
  id: string
  fullName: string
  staffId: string | null
  email: string | null
  contactNumber: string | null
  department: string | null
  company: string | null
  isExternal: boolean
  isActive: boolean
  notes: string | null
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
  linkedUser: EditorLinkedUser | null
  activeBookingCount: number
  totalBookingCount: number
  signatureCount: number
  lastBooking: EditorLastBooking | null
  firstBookingAt: Date | null
}

export async function getEditorDetail(db: Db, id: string): Promise<EditorDetail | null> {
  const editor = await db.editorProfile.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      staffId: true,
      email: true,
      contactNumber: true,
      department: true,
      company: true,
      isExternal: true,
      isActive: true,
      notes: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, name: true, email: true, role: true, status: true, deletedAt: true } },
      bookings: {
        where: { deletedAt: null },
        orderBy: [{ bookingStart: 'desc' }],
        take: 1,
        select: { id: true, bookingNumber: true, status: true, bookingStart: true, kit: { select: { kitCode: true } } },
      },
      _count: { select: { bookings: { where: liveWhere }, signatures: true } },
    },
  })
  if (!editor) return null

  const [totalBookingCount, first] = await Promise.all([
    db.booking.count({ where: { editorId: id, deletedAt: null } }),
    db.booking.findFirst({ where: { editorId: id, deletedAt: null }, orderBy: [{ bookingStart: 'asc' }], select: { bookingStart: true } }),
  ])

  const last = editor.bookings[0]
  return {
    id: editor.id,
    fullName: editor.fullName,
    staffId: editor.staffId,
    email: editor.email,
    contactNumber: editor.contactNumber,
    department: editor.department,
    company: editor.company,
    isExternal: editor.isExternal,
    isActive: editor.isActive,
    notes: editor.notes,
    deletedAt: editor.deletedAt,
    createdAt: editor.createdAt,
    updatedAt: editor.updatedAt,
    linkedUser: editor.user
      ? { id: editor.user.id, name: editor.user.name, email: editor.user.email, role: editor.user.role, status: editor.user.status, deleted: editor.user.deletedAt !== null }
      : null,
    activeBookingCount: editor._count.bookings,
    totalBookingCount,
    signatureCount: editor._count.signatures,
    lastBooking: last
      ? { id: last.id, bookingNumber: last.bookingNumber, status: last.status, bookingStart: last.bookingStart, kitCode: last.kit.kitCode }
      : null,
    firstBookingAt: first?.bookingStart ?? null,
  }
}

// -----------------------------------------------------------------------------
// Lifecycle context
// -----------------------------------------------------------------------------

export interface EditorLifecycleContext {
  deleted: boolean
  isActive: boolean
  isExternal: boolean
  userId: string | null
  activeBookingCount: number
  totalBookingCount: number
  signatureCount: number
}

export async function getEditorLifecycleContext(db: Db, id: string): Promise<EditorLifecycleContext | null> {
  const editor = await db.editorProfile.findUnique({
    where: { id },
    select: {
      deletedAt: true,
      isActive: true,
      isExternal: true,
      userId: true,
      _count: { select: { bookings: { where: liveWhere }, signatures: true } },
    },
  })
  if (!editor) return null
  const totalBookingCount = await db.booking.count({ where: { editorId: id } })
  return {
    deleted: editor.deletedAt !== null,
    isActive: editor.isActive,
    isExternal: editor.isExternal,
    userId: editor.userId,
    activeBookingCount: editor._count.bookings,
    totalBookingCount,
    signatureCount: editor._count.signatures,
  }
}

// -----------------------------------------------------------------------------
// Account linking
// -----------------------------------------------------------------------------

export interface LinkableUser {
  id: string
  name: string
  email: string
  role: UserRole
  status: UserStatus
}

/** What the link rules need to know about a user, plus who already holds it. */
export interface UserLinkFacts extends LinkableUser {
  deleted: boolean
  linkedEditor: { id: string; fullName: string } | null
}

export async function getUserLinkFacts(db: Db, userId: string): Promise<UserLinkFacts | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, status: true, deletedAt: true, editorProfile: { select: { id: true, fullName: true } } },
  })
  if (!user) return null
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    deleted: user.deletedAt !== null,
    linkedEditor: user.editorProfile,
  }
}

/** Accounts an internal editor may be linked to: live, not disabled, not already linked. */
export async function listLinkableUsers(db: Db): Promise<LinkableUser[]> {
  return db.user.findMany({
    where: { deletedAt: null, status: { not: 'DISABLED' }, editorProfile: null },
    select: { id: true, name: true, email: true, role: true, status: true },
    orderBy: [{ name: 'asc' }],
    take: 200,
  })
}

// -----------------------------------------------------------------------------
// Bookings of one editor
// -----------------------------------------------------------------------------

export interface EditorBookingRow {
  id: string
  bookingNumber: string
  status: BookingStatus
  bookingStart: Date
  bookingEnd: Date
  collectionDate: Date | null
  expectedReturnDate: Date
  actualReturnDate: Date | null
  kit: { id: string; kitCode: string; name: string }
  engineerName: string
}

export interface EditorBookingsResult {
  rows: EditorBookingRow[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

const bookingSelect = {
  id: true,
  bookingNumber: true,
  status: true,
  bookingStart: true,
  bookingEnd: true,
  collectionDate: true,
  expectedReturnDate: true,
  actualReturnDate: true,
  kit: { select: { id: true, kitCode: true, name: true } },
  engineer: { select: { fullName: true } },
} satisfies Prisma.BookingSelect

/**
 * `active`: bookings that currently hold a kit, soonest first.
 * `history`: every booking, newest first. Both paginated in the database.
 */
export async function listEditorBookings(
  db: Db,
  editorId: string,
  options: { scope: 'active' | 'history'; page?: number; pageSize?: number },
): Promise<EditorBookingsResult> {
  const pageSize = Math.max(1, options.pageSize ?? 25)
  const where: Prisma.BookingWhereInput =
    options.scope === 'active' ? { editorId, ...liveWhere } : { editorId, deletedAt: null }

  const total = await db.booking.count({ where })
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, options.page ?? 1), pageCount)

  const records = await db.booking.findMany({
    where,
    select: bookingSelect,
    orderBy: options.scope === 'active' ? [{ bookingStart: 'asc' }, { bookingNumber: 'asc' }] : [{ bookingStart: 'desc' }, { bookingNumber: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  })

  return {
    rows: records.map((record) => ({
      id: record.id,
      bookingNumber: record.bookingNumber,
      status: record.status,
      bookingStart: record.bookingStart,
      bookingEnd: record.bookingEnd,
      collectionDate: record.collectionDate,
      expectedReturnDate: record.expectedReturnDate,
      actualReturnDate: record.actualReturnDate,
      kit: record.kit,
      engineerName: record.engineer.fullName,
    })),
    total,
    page,
    pageSize,
    pageCount,
  }
}

// -----------------------------------------------------------------------------
// Issues raised on the editor's bookings
// -----------------------------------------------------------------------------

export interface EditorIssueRow {
  id: string
  issueNumber: string
  type: IssueType
  severity: IssueSeverity
  status: IssueStatus
  title: string
  reportedAt: Date
  resolvedAt: Date | null
  bookingNumber: string | null
}

export async function listEditorIssues(db: Db, editorId: string, limit = 50): Promise<EditorIssueRow[]> {
  const issues = await db.issue.findMany({
    where: { booking: { editorId } },
    orderBy: [{ reportedAt: 'desc' }],
    take: limit,
    select: {
      id: true,
      issueNumber: true,
      type: true,
      severity: true,
      status: true,
      title: true,
      reportedAt: true,
      resolvedAt: true,
      booking: { select: { bookingNumber: true } },
    },
  })
  return issues.map(({ booking, ...issue }) => ({ ...issue, bookingNumber: booking?.bookingNumber ?? null }))
}

// -----------------------------------------------------------------------------
// Activity
// -----------------------------------------------------------------------------

export type EditorActivityKind = 'created' | 'update' | 'status' | 'account' | 'booking' | 'handover' | 'return' | 'removed'

export interface EditorActivityEvent {
  id: string
  at: Date
  kind: EditorActivityKind
  title: string
  detail: string | null
  actorName: string | null
  reference: { label: string; href: string | null } | null
}

const AUDIT_KINDS: Partial<Record<AuditAction, EditorActivityKind>> = {
  CREATE: 'created',
  UPDATE: 'update',
  DELETE: 'removed',
  EDITOR_STATUS_CHANGED: 'status',
  EDITOR_USER_LINKED: 'account',
  EDITOR_USER_UNLINKED: 'account',
}

function humanize(value: string): string {
  const words = value.toLowerCase().split('_')
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(' ')
}

/** The profile's audit entries and its booking milestones, newest first. */
export async function getEditorActivity(db: Db, id: string, limit = 100): Promise<EditorActivityEvent[]> {
  const [audits, bookings] = await Promise.all([
    db.auditLog.findMany({
      where: { entityType: 'EditorProfile', entityId: id },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      select: { id: true, action: true, summary: true, actorName: true, createdAt: true },
    }),
    db.booking.findMany({
      where: { editorId: id, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        bookingNumber: true,
        status: true,
        createdAt: true,
        collectionDate: true,
        actualReturnDate: true,
        cancelledAt: true,
        cancelReason: true,
        kit: { select: { id: true, kitCode: true } },
      },
    }),
  ])

  const events: EditorActivityEvent[] = audits.map((audit) => ({
    id: `audit:${audit.id}`,
    at: audit.createdAt,
    kind: AUDIT_KINDS[audit.action] ?? 'update',
    title: audit.summary ?? humanize(audit.action),
    detail: null,
    actorName: audit.actorName,
    reference: null,
  }))

  for (const booking of bookings) {
    const reference = { label: booking.bookingNumber, href: '/bookings' }
    const kit = { label: booking.kit.kitCode, href: `/kits/${booking.kit.id}` }
    events.push({
      id: `booking:${booking.id}`,
      at: booking.createdAt,
      kind: 'booking',
      title: `Booking ${booking.bookingNumber} created for kit ${booking.kit.kitCode}`,
      detail: booking.status === 'COMPLETED' || booking.status === 'CANCELLED' ? null : humanize(booking.status),
      actorName: null,
      reference,
    })
    if (booking.collectionDate) {
      events.push({ id: `handover:${booking.id}`, at: booking.collectionDate, kind: 'handover', title: `Collected kit ${kit.label} under ${booking.bookingNumber}`, detail: null, actorName: null, reference: kit })
    }
    if (booking.actualReturnDate) {
      events.push({ id: `return:${booking.id}`, at: booking.actualReturnDate, kind: 'return', title: `Returned kit ${kit.label} under ${booking.bookingNumber}`, detail: null, actorName: null, reference: kit })
    }
    if (booking.cancelledAt) {
      events.push({ id: `cancel:${booking.id}`, at: booking.cancelledAt, kind: 'booking', title: `Booking ${booking.bookingNumber} cancelled`, detail: booking.cancelReason, actorName: null, reference })
    }
  }

  events.sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id))
  return events.slice(0, limit)
}
