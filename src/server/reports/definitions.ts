import 'server-only'

import { AssetStatus, BookingStatus, InspectionType, IssueSeverity, IssueStatus, KitStatus, MaintenanceStatus, type Prisma } from '@prisma/client'

import { returnPunctuality } from '@/lib/booking-rules'
import { overdueWhere } from '@/server/dal/dashboard.dal'
import { type ColumnDef, paginate, plural, type ReportDefinition, type ReportParams, type ReportRow } from './types'

/**
 * The reports themselves.
 *
 * Each one is a query with explicit selects, server-side filtering and
 * server-side paging, mapped to flat rows. Two rules run through all of them:
 *
 *  - nothing is computed in a renderer. If a report says "3 days late", the
 *    number is worked out here, from the two timestamps, so the table, the CSV
 *    and any future format agree;
 *  - `params.scope` narrows every booking-shaped report to one editor's own
 *    rows. A caller who may only read their own bookings gets a report of
 *    their own bookings, not an empty page and not somebody else's.
 */

const OUT_STATUSES = [BookingStatus.CHECKED_OUT, BookingStatus.OVERDUE] as const
const OPEN_ISSUES = [IssueStatus.OPEN, IssueStatus.UNDER_INVESTIGATION] as const

/** Booking-shaped reports share the scope clause and the free-text search. */
function bookingWhere(params: ReportParams, extra: Prisma.BookingWhereInput[] = []): Prisma.BookingWhereInput {
  const clauses: Prisma.BookingWhereInput[] = [{ deletedAt: null }, ...extra]
  if (params.scope) clauses.push({ editorId: params.scope.editorProfileId })
  if (params.kitId) clauses.push({ kitId: params.kitId })
  if (params.editorId) clauses.push({ editorId: params.editorId })
  if (params.search) {
    const contains = { contains: params.search, mode: 'insensitive' as const }
    clauses.push({
      OR: [{ bookingNumber: contains }, { editor: { fullName: contains } }, { editor: { staffId: contains } }, { kit: { kitCode: contains } }, { kit: { name: contains } }],
    })
  }
  return { AND: clauses }
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
  purpose: true,
  requesterName: true,
  requesterStaffId: true,
  requesterMobile: true,
  projectName: true,
  workOrder: true,
  kit: { select: { kitCode: true, name: true } },
  editor: { select: { fullName: true, staffId: true, contactNumber: true, isExternal: true } },
  engineer: { select: { fullName: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.BookingSelect

const BOOKING_COLUMNS: ColumnDef[] = [
  { key: 'bookingNumber', label: 'Booking', kind: 'code', linkTo: 'booking' },
  { key: 'kitCode', label: 'Kit', kind: 'code' },
  { key: 'kitName', label: 'Kit name', kind: 'text', secondary: true },
  { key: 'editor', label: 'Editor', kind: 'text' },
  { key: 'mobile', label: 'Mobile', kind: 'text' },
  { key: 'staffId', label: 'Staff ID', kind: 'code', secondary: true },
  { key: 'collected', label: 'Collected', kind: 'datetime' },
  { key: 'expectedReturn', label: 'Expected return', kind: 'datetime' },
]

type BookingRecord = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>

function bookingRow(record: BookingRecord): ReportRow {
  return {
    id: record.id,
    bookingNumber: record.bookingNumber,
    kitCode: record.kit.kitCode,
    kitName: record.kit.name,
    editor: record.requesterName ?? record.editor?.fullName ?? 'Unnamed requester',
    mobile: record.requesterMobile ?? record.editor?.contactNumber ?? null,
    staffId: record.requesterStaffId ?? record.editor?.staffId ?? null,
    collected: record.collectionDate,
    expectedReturn: record.expectedReturnDate,
  }
}

// -----------------------------------------------------------------------------
// Operations
// -----------------------------------------------------------------------------

/** 1. What is out right now, and how late it is. */
const checkedOut: ReportDefinition = {
  id: 'checked-out',
  title: 'Currently checked out',
  description: 'Every kit that is out with an editor right now, soonest return first.',
  group: 'Operations',
  alsoNeeds: ['booking.read'],
  filters: ['search', 'kitId', 'editorId'],
  async run(db, params) {
    const where = bookingWhere(params, [{ status: { in: [...OUT_STATUSES] } }])
    const total = await db.booking.count({ where })
    const { skip, take, pageCount, page } = paginate(params.page, params.pageSize, total)
    const records = await db.booking.findMany({ where, select: bookingSelect, orderBy: [{ expectedReturnDate: 'asc' }], skip, take })

    const rows = records.map((record) => {
      const lateBy = Math.max(0, params.now.getTime() - record.expectedReturnDate.getTime())
      return {
        ...bookingRow(record),
        engineer: (record.engineer?.fullName ?? record.createdBy.name),
        daysOut: record.collectionDate ? Math.floor((params.now.getTime() - record.collectionDate.getTime()) / 86_400_000) : null,
        late: lateBy > 0,
        daysLate: lateBy > 0 ? Math.floor(lateBy / 86_400_000) : 0,
      }
    })

    return {
      columns: [
        ...BOOKING_COLUMNS,
        { key: 'engineer', label: 'Engineer', kind: 'text', secondary: true },
        { key: 'daysOut', label: 'Days out', kind: 'number', numeric: true },
        { key: 'late', label: 'Late', kind: 'boolean' },
        { key: 'daysLate', label: 'Days late', kind: 'number', numeric: true },
      ],
      rows,
      total,
      page,
      pageSize: params.pageSize,
      pageCount,
      summary: `${plural(total, 'kit')} out with editors${rows.some((row) => row.late) ? `, ${rows.filter((row) => row.late).length} of them late on this page` : ''}.`,
    }
  },
}

/** 2. What is coming back, in the order it is due. */
const dueReturns: ReportDefinition = {
  id: 'due-returns',
  title: 'Upcoming returns',
  description: 'Kits that are out and still within their expected return, nearest first.',
  group: 'Operations',
  alsoNeeds: ['booking.read'],
  filters: ['search', 'from', 'to', 'kitId', 'editorId'],
  async run(db, params) {
    const window: Prisma.BookingWhereInput = {
      expectedReturnDate: { gte: params.from ?? params.now, ...(params.to ? { lt: params.to } : {}) },
    }
    const where = bookingWhere(params, [{ status: { in: [...OUT_STATUSES] } }, window])
    const total = await db.booking.count({ where })
    const { skip, take, pageCount, page } = paginate(params.page, params.pageSize, total)
    const records = await db.booking.findMany({ where, select: bookingSelect, orderBy: [{ expectedReturnDate: 'asc' }], skip, take })

    const rows = records.map((record) => ({
      ...bookingRow(record),
      hoursUntilDue: Math.round((record.expectedReturnDate.getTime() - params.now.getTime()) / 3_600_000),
    }))

    return {
      columns: [...BOOKING_COLUMNS, { key: 'hoursUntilDue', label: 'Hours until due', kind: 'number', numeric: true }],
      rows,
      total,
      page,
      pageSize: params.pageSize,
      pageCount,
      summary: `${plural(total, 'return')} due${params.from || params.to ? ' in the chosen window' : ' from now on'}.`,
    }
  },
}

/** 3. What is late, worst first. */
const overdue: ReportDefinition = {
  id: 'overdue',
  title: 'Overdue bookings',
  description: 'Kits that are out and past their expected return, longest overdue first.',
  group: 'Operations',
  alsoNeeds: ['booking.read'],
  filters: ['search', 'kitId', 'editorId'],
  async run(db, params) {
    const where = bookingWhere(params, [overdueWhere(params.now)])
    const total = await db.booking.count({ where })
    const { skip, take, pageCount, page } = paginate(params.page, params.pageSize, total)
    const records = await db.booking.findMany({ where, select: bookingSelect, orderBy: [{ expectedReturnDate: 'asc' }], skip, take })

    const rows = records.map((record) => ({
      ...bookingRow(record),
      engineer: (record.engineer?.fullName ?? record.createdBy.name),
      daysLate: Math.floor((params.now.getTime() - record.expectedReturnDate.getTime()) / 86_400_000),
      hoursLate: Math.round((params.now.getTime() - record.expectedReturnDate.getTime()) / 3_600_000),
    }))

    return {
      columns: [
        ...BOOKING_COLUMNS,
        { key: 'engineer', label: 'Engineer', kind: 'text', secondary: true },
        { key: 'daysLate', label: 'Days late', kind: 'number', numeric: true },
        { key: 'hoursLate', label: 'Hours late', kind: 'number', numeric: true, secondary: true },
      ],
      rows,
      total,
      page,
      pageSize: params.pageSize,
      pageCount,
      summary: total === 0 ? 'Nothing is overdue.' : `${plural(total, 'booking')} past the expected return.`,
    }
  },
}

// -----------------------------------------------------------------------------
// History
// -----------------------------------------------------------------------------

const BOOKING_STATUS_OPTIONS = Object.values(BookingStatus).map((status) => ({ value: status, label: status.toLowerCase().replace(/_/g, ' ') }))

/** 4. Every booking, with how it ended. */
const bookingHistory: ReportDefinition = {
  id: 'booking-history',
  title: 'Booking history',
  description: 'Every booking in a period, with when it went out, when it came back, and whether it was late.',
  group: 'History',
  alsoNeeds: ['booking.read'],
  filters: ['search', 'from', 'to', 'status', 'kitId', 'editorId'],
  statusOptions: BOOKING_STATUS_OPTIONS,
  async run(db, params) {
    const extra: Prisma.BookingWhereInput[] = []
    if (params.status) extra.push({ status: params.status as BookingStatus })
    if (params.from || params.to) {
      extra.push({ bookingStart: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lt: params.to } : {}) } })
    }
    const where = bookingWhere(params, extra)
    const total = await db.booking.count({ where })
    const { skip, take, pageCount, page } = paginate(params.page, params.pageSize, total)
    const records = await db.booking.findMany({ where, select: bookingSelect, orderBy: [{ bookingStart: 'desc' }], skip, take })

    const rows = records.map((record) => ({
      ...bookingRow(record),
      status: record.status,
      actualReturn: record.actualReturnDate,
      punctuality: record.actualReturnDate ? returnPunctuality(record.expectedReturnDate, record.actualReturnDate) : null,
      purpose: record.purpose,
    }))

    return {
      columns: [
        { key: 'bookingNumber', label: 'Booking', kind: 'code', linkTo: 'booking' },
        { key: 'status', label: 'Status', kind: 'status' },
        { key: 'kitCode', label: 'Kit', kind: 'code' },
        { key: 'editor', label: 'Editor', kind: 'text' },
        { key: 'staffId', label: 'Staff ID', kind: 'code', secondary: true },
        { key: 'collected', label: 'Collected', kind: 'datetime' },
        { key: 'expectedReturn', label: 'Expected return', kind: 'datetime', secondary: true },
        { key: 'actualReturn', label: 'Actual return', kind: 'datetime' },
        { key: 'punctuality', label: 'Punctuality', kind: 'status' },
        { key: 'purpose', label: 'Purpose', kind: 'text', secondary: true },
      ],
      rows,
      total,
      page,
      pageSize: params.pageSize,
      pageCount,
      summary: `${plural(total, 'booking')}${params.from || params.to ? ' in the chosen window' : ''}.`,
    }
  },
}

/** 5. How hard each kit has been worked. */
const kitUtilisation: ReportDefinition = {
  id: 'kit-utilisation',
  title: 'Kit utilisation',
  description: 'Per kit: how many times it went out, how many days it spent out, and when it was last used.',
  group: 'History',
  alsoNeeds: ['kit.read', 'booking.read'],
  filters: ['search', 'from', 'to', 'kitId'],
  async run(db, params) {
    const kitWhere: Prisma.KitWhereInput = {
      deletedAt: null,
      ...(params.kitId ? { id: params.kitId } : {}),
      ...(params.search ? { OR: [{ kitCode: { contains: params.search, mode: 'insensitive' } }, { name: { contains: params.search, mode: 'insensitive' } }] } : {}),
    }
    const total = await db.kit.count({ where: kitWhere })
    const { skip, take, pageCount, page } = paginate(params.page, params.pageSize, total)

    const window: Prisma.BookingWhereInput = {
      deletedAt: null,
      status: { notIn: [BookingStatus.DRAFT, BookingStatus.CANCELLED] },
      ...(params.from || params.to ? { bookingStart: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lt: params.to } : {}) } } : {}),
    }

    const kits = await db.kit.findMany({
      where: kitWhere,
      orderBy: [{ kitCode: 'asc' }],
      skip,
      take,
      select: {
        id: true,
        kitCode: true,
        name: true,
        status: true,
        _count: { select: { kitAssets: { where: { removedAt: null } } } },
        bookings: {
          where: window,
          select: { collectionDate: true, actualReturnDate: true, expectedReturnDate: true, bookingStart: true, status: true },
        },
      },
    })

    const rows = kits.map((kit) => {
      const bookings = kit.bookings
      // Days out counts real time on the road: collection to actual return, or
      // to now for a kit still out.
      const daysOut = bookings.reduce((sum, booking) => {
        if (!booking.collectionDate) return sum
        const end = booking.actualReturnDate ?? params.now
        return sum + Math.max(0, end.getTime() - booking.collectionDate.getTime())
      }, 0)
      const lastOut = bookings.reduce<Date | null>((latest, booking) => {
        const candidate = booking.collectionDate ?? booking.bookingStart
        return !latest || candidate > latest ? candidate : latest
      }, null)
      const late = bookings.filter((booking) => booking.actualReturnDate && returnPunctuality(booking.expectedReturnDate, booking.actualReturnDate) === 'late').length

      return {
        id: kit.id,
        kitCode: kit.kitCode,
        kitName: kit.name,
        status: kit.status,
        items: kit._count.kitAssets,
        timesOut: bookings.length,
        daysOut: Math.round(daysOut / 86_400_000),
        lateReturns: late,
        lastOut,
      }
    })

    return {
      columns: [
        { key: 'kitCode', label: 'Kit', kind: 'code', linkTo: 'kit' },
        { key: 'kitName', label: 'Name', kind: 'text' },
        { key: 'status', label: 'Status', kind: 'status' },
        { key: 'items', label: 'Items', kind: 'number', numeric: true, secondary: true },
        { key: 'timesOut', label: 'Times out', kind: 'number', numeric: true },
        { key: 'daysOut', label: 'Days out', kind: 'number', numeric: true },
        { key: 'lateReturns', label: 'Late returns', kind: 'number', numeric: true },
        { key: 'lastOut', label: 'Last out', kind: 'date' },
      ],
      rows,
      total,
      page,
      pageSize: params.pageSize,
      pageCount,
      summary: `${plural(total, 'kit')}${params.from || params.to ? ', counting bookings that started in the chosen window' : ''}.`,
    }
  },
}

/** 6. Who has had what. */
const editorHistory: ReportDefinition = {
  id: 'editor-history',
  title: 'Editor booking history',
  description: 'Per editor: how many kits they have taken, how many came back late, and when they last had one.',
  group: 'History',
  alsoNeeds: ['editor.read', 'booking.read'],
  filters: ['search', 'from', 'to', 'editorId'],
  async run(db, params) {
    const editorWhere: Prisma.EditorProfileWhereInput = {
      deletedAt: null,
      ...(params.editorId ? { id: params.editorId } : {}),
      ...(params.search
        ? { OR: [{ fullName: { contains: params.search, mode: 'insensitive' } }, { staffId: { contains: params.search, mode: 'insensitive' } }, { contactNumber: { contains: params.search } }] }
        : {}),
    }
    const total = await db.editorProfile.count({ where: editorWhere })
    const { skip, take, pageCount, page } = paginate(params.page, params.pageSize, total)

    const window: Prisma.BookingWhereInput = {
      deletedAt: null,
      status: { notIn: [BookingStatus.DRAFT, BookingStatus.CANCELLED] },
      ...(params.from || params.to ? { bookingStart: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lt: params.to } : {}) } } : {}),
    }

    const editors = await db.editorProfile.findMany({
      where: editorWhere,
      orderBy: [{ fullName: 'asc' }],
      skip,
      take,
      select: {
        id: true,
        fullName: true,
        staffId: true,
        contactNumber: true,
        isExternal: true,
        isActive: true,
        bookings: { where: window, select: { status: true, bookingStart: true, expectedReturnDate: true, actualReturnDate: true } },
      },
    })

    const rows = editors.map((editor) => {
      const bookings = editor.bookings
      const late = bookings.filter((booking) => booking.actualReturnDate && returnPunctuality(booking.expectedReturnDate, booking.actualReturnDate) === 'late').length
      const outNow = bookings.filter((booking) => booking.status === BookingStatus.CHECKED_OUT || booking.status === BookingStatus.OVERDUE).length
      const last = bookings.reduce<Date | null>((latest, booking) => (!latest || booking.bookingStart > latest ? booking.bookingStart : latest), null)
      return {
        id: editor.id,
        editor: editor.fullName,
        type: editor.isExternal ? 'External' : 'Internal',
        staffId: editor.staffId,
        mobile: editor.contactNumber,
        active: editor.isActive,
        bookings: bookings.length,
        outNow,
        lateReturns: late,
        lastBooking: last,
      }
    })

    return {
      columns: [
        { key: 'editor', label: 'Editor', kind: 'text', linkTo: 'editor' },
        { key: 'type', label: 'Type', kind: 'text' },
        { key: 'staffId', label: 'Staff ID', kind: 'code' },
        { key: 'mobile', label: 'Mobile', kind: 'text' },
        { key: 'active', label: 'Active', kind: 'boolean', secondary: true },
        { key: 'bookings', label: 'Bookings', kind: 'number', numeric: true },
        { key: 'outNow', label: 'Out now', kind: 'number', numeric: true },
        { key: 'lateReturns', label: 'Late returns', kind: 'number', numeric: true },
        { key: 'lastBooking', label: 'Last booking', kind: 'date' },
      ],
      rows,
      total,
      page,
      pageSize: params.pageSize,
      pageCount,
      summary: `${plural(total, 'editor')}${params.from || params.to ? ', counting bookings in the chosen window' : ''}.`,
    }
  },
}

/** 7. Every handover and return on record. */
const inspectionRecords: ReportDefinition = {
  id: 'handover-return-records',
  title: 'Handover and return records',
  description: 'Every completed handover and return, with who signed and what the document recorded.',
  group: 'History',
  alsoNeeds: ['booking.read'],
  filters: ['search', 'from', 'to', 'status', 'kitId'],
  statusOptions: [
    { value: 'HANDOVER', label: 'handovers' },
    { value: 'RETURN', label: 'returns' },
  ],
  async run(db, params) {
    const clauses: Prisma.InspectionWhereInput[] = [{ voidedAt: null }, { status: 'COMPLETED' }]
    if (params.status === 'HANDOVER' || params.status === 'RETURN') clauses.push({ type: params.status as InspectionType })
    if (params.from || params.to) clauses.push({ completedAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lt: params.to } : {}) } })
    const bookingClause = bookingWhere(params)
    clauses.push({ booking: bookingClause })

    const where: Prisma.InspectionWhereInput = { AND: clauses }
    const total = await db.inspection.count({ where })
    const { skip, take, pageCount, page } = paginate(params.page, params.pageSize, total)
    const records = await db.inspection.findMany({
      where,
      orderBy: [{ completedAt: 'desc' }],
      skip,
      take,
      select: {
        id: true,
        type: true,
        completedAt: true,
        suitcaseStatus: true,
        completedBy: { select: { name: true } },
        booking: { select: { id: true, bookingNumber: true, requesterName: true, kit: { select: { kitCode: true } }, editor: { select: { fullName: true } } } },
        assetInspections: { select: { status: true } },
        signatures: { where: { voidedAt: null }, select: { type: true } },
        _count: { select: { attachments: { where: { deletedAt: null } }, issues: true } },
      },
    })

    const rows = records.map((record) => {
      const lines = record.assetInspections
      return {
        id: record.booking.id,
        bookingNumber: record.booking.bookingNumber,
        type: record.type === 'HANDOVER' ? 'Handover' : 'Return',
        kitCode: record.booking.kit.kitCode,
        editor: (record.booking.requesterName ?? record.booking.editor?.fullName ?? 'Unnamed requester'),
        completedAt: record.completedAt,
        completedBy: record.completedBy?.name ?? null,
        items: lines.length,
        accountedFor: lines.filter((line) => line.status === 'INCLUDED').length,
        problems: lines.filter((line) => line.status === 'MISSING' || line.status === 'DAMAGED').length,
        signatures: record.signatures.length,
        photos: record._count.attachments,
        issuesRaised: record._count.issues,
        caseCondition: record.suitcaseStatus,
      }
    })

    return {
      columns: [
        { key: 'bookingNumber', label: 'Booking', kind: 'code', linkTo: 'booking' },
        { key: 'type', label: 'Document', kind: 'text' },
        { key: 'kitCode', label: 'Kit', kind: 'code' },
        { key: 'editor', label: 'Editor', kind: 'text' },
        { key: 'completedAt', label: 'Completed', kind: 'datetime' },
        { key: 'completedBy', label: 'By', kind: 'text' },
        { key: 'items', label: 'Items', kind: 'number', numeric: true },
        { key: 'accountedFor', label: 'Accounted for', kind: 'number', numeric: true },
        { key: 'problems', label: 'Problems', kind: 'number', numeric: true },
        { key: 'signatures', label: 'Signatures', kind: 'number', numeric: true, secondary: true },
        { key: 'photos', label: 'Photos', kind: 'number', numeric: true, secondary: true },
        { key: 'issuesRaised', label: 'Issues', kind: 'number', numeric: true, secondary: true },
        { key: 'caseCondition', label: 'Case', kind: 'status', secondary: true },
      ],
      rows,
      total,
      page,
      pageSize: params.pageSize,
      pageCount,
      summary: `${plural(total, 'completed document')} on record.`,
    }
  },
}

// -----------------------------------------------------------------------------
// Equipment
// -----------------------------------------------------------------------------

/** 8. What is missing or damaged, and where it went. */
const missingDamaged: ReportDefinition = {
  id: 'missing-damaged',
  title: 'Missing and damaged equipment',
  description: 'Equipment currently recorded missing or damaged, with the booking and return that found it.',
  group: 'Equipment',
  alsoNeeds: ['asset.read'],
  filters: ['search', 'status'],
  statusOptions: [
    { value: AssetStatus.MISSING, label: 'missing' },
    { value: AssetStatus.DAMAGED, label: 'damaged' },
  ],
  async run(db, params) {
    const statuses = params.status === AssetStatus.MISSING || params.status === AssetStatus.DAMAGED ? [params.status as AssetStatus] : [AssetStatus.MISSING, AssetStatus.DAMAGED]
    const where: Prisma.AssetWhereInput = {
      deletedAt: null,
      status: { in: statuses },
      ...(params.search
        ? {
            OR: [
              { assetCode: { contains: params.search, mode: 'insensitive' } },
              { name: { contains: params.search, mode: 'insensitive' } },
              { serialNumber: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
    const total = await db.asset.count({ where })
    const { skip, take, pageCount, page } = paginate(params.page, params.pageSize, total)
    const assets = await db.asset.findMany({
      where,
      orderBy: [{ status: 'asc' }, { assetCode: 'asc' }],
      skip,
      take,
      select: {
        id: true,
        assetCode: true,
        name: true,
        status: true,
        serialNumber: true,
        category: { select: { name: true } },
        statusLogs: {
          where: { toStatus: { in: statuses } },
          orderBy: [{ createdAt: 'desc' }],
          take: 1,
          select: { createdAt: true, reason: true, booking: { select: { bookingNumber: true, requesterName: true, editor: { select: { fullName: true } } } } },
        },
        issues: { where: { status: { in: [...OPEN_ISSUES] } }, orderBy: [{ reportedAt: 'desc' }], take: 1, select: { issueNumber: true, severity: true } },
      },
    })

    const rows = assets.map((asset) => {
      const log = asset.statusLogs[0]
      const issue = asset.issues[0]
      return {
        id: asset.id,
        assetCode: asset.assetCode,
        name: asset.name,
        category: asset.category.name,
        status: asset.status,
        serialNumber: asset.serialNumber,
        since: log?.createdAt ?? null,
        booking: log?.booking?.bookingNumber ?? null,
        editor: log?.booking?.requesterName ?? log?.booking?.editor?.fullName ?? null,
        reason: log?.reason ?? null,
        openIssue: issue?.issueNumber ?? null,
        severity: issue?.severity ?? null,
      }
    })

    return {
      columns: [
        { key: 'assetCode', label: 'Equipment', kind: 'code', linkTo: 'asset' },
        { key: 'name', label: 'Name', kind: 'text' },
        { key: 'category', label: 'Category', kind: 'text', secondary: true },
        { key: 'status', label: 'Status', kind: 'status' },
        { key: 'serialNumber', label: 'Serial', kind: 'code', secondary: true },
        { key: 'since', label: 'Since', kind: 'datetime' },
        { key: 'booking', label: 'Last booking', kind: 'code' },
        { key: 'editor', label: 'Last with', kind: 'text' },
        { key: 'openIssue', label: 'Open issue', kind: 'code' },
        { key: 'severity', label: 'Severity', kind: 'severity' },
        { key: 'reason', label: 'Reason', kind: 'text', secondary: true },
      ],
      rows,
      total,
      page,
      pageSize: params.pageSize,
      pageCount,
      summary: total === 0 ? 'Nothing is recorded missing or damaged.' : `${plural(total, 'item')} out of service.`,
    }
  },
}

/** 9. Issues, open or closed. */
const issueReport: ReportDefinition = {
  id: 'issues',
  title: 'Issues',
  description: 'Equipment problems raised by returns or reported by hand, with how long they took to resolve.',
  group: 'Equipment',
  alsoNeeds: ['issue.read'],
  filters: ['search', 'from', 'to', 'status', 'severity'],
  statusOptions: Object.values(IssueStatus).map((status) => ({ value: status, label: status.toLowerCase().replace(/_/g, ' ') })),
  async run(db, params) {
    const clauses: Prisma.IssueWhereInput[] = []
    if (params.status) clauses.push({ status: params.status as IssueStatus })
    if (params.severity) clauses.push({ severity: params.severity as IssueSeverity })
    if (params.from || params.to) clauses.push({ reportedAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lt: params.to } : {}) } })
    if (params.search) {
      const contains = { contains: params.search, mode: 'insensitive' as const }
      clauses.push({ OR: [{ issueNumber: contains }, { title: contains }, { asset: { assetCode: contains } }, { asset: { name: contains } }] })
    }
    const where: Prisma.IssueWhereInput = clauses.length > 0 ? { AND: clauses } : {}

    const total = await db.issue.count({ where })
    const { skip, take, pageCount, page } = paginate(params.page, params.pageSize, total)
    const issues = await db.issue.findMany({
      where,
      orderBy: [{ reportedAt: 'desc' }],
      skip,
      take,
      select: {
        id: true,
        issueNumber: true,
        type: true,
        severity: true,
        status: true,
        title: true,
        reportedAt: true,
        resolvedAt: true,
        closedAt: true,
        reportedBy: { select: { name: true } },
        assignedTo: { select: { name: true } },
        asset: { select: { assetCode: true } },
        kit: { select: { kitCode: true } },
        booking: { select: { bookingNumber: true } },
      },
    })

    const rows = issues.map((issue) => ({
      id: issue.id,
      issueNumber: issue.issueNumber,
      title: issue.title,
      type: issue.type,
      severity: issue.severity,
      status: issue.status,
      assetCode: issue.asset?.assetCode ?? null,
      kitCode: issue.kit?.kitCode ?? null,
      bookingNumber: issue.booking?.bookingNumber ?? null,
      reportedAt: issue.reportedAt,
      reportedBy: issue.reportedBy.name,
      assignedTo: issue.assignedTo?.name ?? null,
      resolvedAt: issue.resolvedAt,
      // Days to resolve is the number people actually ask for.
      daysToResolve: issue.resolvedAt ? Math.round((issue.resolvedAt.getTime() - issue.reportedAt.getTime()) / 86_400_000) : null,
    }))

    return {
      columns: [
        { key: 'issueNumber', label: 'Issue', kind: 'code', linkTo: 'issue' },
        { key: 'title', label: 'Problem', kind: 'text' },
        { key: 'type', label: 'Type', kind: 'status' },
        { key: 'severity', label: 'Severity', kind: 'severity' },
        { key: 'status', label: 'Status', kind: 'status' },
        { key: 'assetCode', label: 'Equipment', kind: 'code' },
        { key: 'kitCode', label: 'Kit', kind: 'code', secondary: true },
        { key: 'bookingNumber', label: 'Booking', kind: 'code', secondary: true },
        { key: 'reportedAt', label: 'Reported', kind: 'datetime' },
        { key: 'reportedBy', label: 'By', kind: 'text', secondary: true },
        { key: 'assignedTo', label: 'Assigned to', kind: 'text' },
        { key: 'resolvedAt', label: 'Resolved', kind: 'datetime', secondary: true },
        { key: 'daysToResolve', label: 'Days to resolve', kind: 'number', numeric: true },
      ],
      rows,
      total,
      page,
      pageSize: params.pageSize,
      pageCount,
      summary: `${plural(total, 'issue')}${params.status ? ` at ${params.status.toLowerCase().replace(/_/g, ' ')}` : ''}.`,
    }
  },
}

/** 10. The whole inventory and where each item is. */
const equipmentStatus: ReportDefinition = {
  id: 'equipment-status',
  title: 'Equipment status',
  description: 'Every asset, its status, the kit it belongs to and whether it is out right now.',
  group: 'Equipment',
  alsoNeeds: ['asset.read'],
  filters: ['search', 'status', 'kitId'],
  statusOptions: Object.values(AssetStatus).map((status) => ({ value: status, label: status.toLowerCase().replace(/_/g, ' ') })),
  async run(db, params) {
    const where: Prisma.AssetWhereInput = {
      deletedAt: null,
      ...(params.status ? { status: params.status as AssetStatus } : {}),
      ...(params.kitId ? { kitAssets: { some: { kitId: params.kitId, removedAt: null } } } : {}),
      ...(params.search
        ? {
            OR: [
              { assetCode: { contains: params.search, mode: 'insensitive' } },
              { name: { contains: params.search, mode: 'insensitive' } },
              { serialNumber: { contains: params.search, mode: 'insensitive' } },
              { admBarcode: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
    const total = await db.asset.count({ where })
    const { skip, take, pageCount, page } = paginate(params.page, params.pageSize, total)
    const assets = await db.asset.findMany({
      where,
      orderBy: [{ assetCode: 'asc' }],
      skip,
      take,
      select: {
        id: true,
        assetCode: true,
        name: true,
        status: true,
        manufacturer: true,
        model: true,
        serialNumber: true,
        admBarcode: true,
        category: { select: { name: true } },
        kitAssets: { where: { removedAt: null }, take: 1, select: { isRequired: true, kit: { select: { kitCode: true, status: true } } } },
        _count: { select: { maintenanceRecords: { where: { deletedAt: null, status: { in: [MaintenanceStatus.IN_PROGRESS, MaintenanceStatus.ON_HOLD] } } }, issues: { where: { status: { in: [...OPEN_ISSUES] } } } } },
      },
    })

    const rows = assets.map((asset) => {
      const membership = asset.kitAssets[0]
      return {
        id: asset.id,
        assetCode: asset.assetCode,
        name: asset.name,
        category: asset.category.name,
        status: asset.status,
        makeModel: [asset.manufacturer, asset.model].filter(Boolean).join(' ') || null,
        serialNumber: asset.serialNumber,
        barcode: asset.admBarcode,
        kitCode: membership?.kit.kitCode ?? null,
        required: membership ? membership.isRequired : null,
        outNow: membership ? membership.kit.status === KitStatus.CHECKED_OUT : false,
        inMaintenance: asset._count.maintenanceRecords > 0,
        openIssues: asset._count.issues,
      }
    })

    return {
      columns: [
        { key: 'assetCode', label: 'Equipment', kind: 'code', linkTo: 'asset' },
        { key: 'name', label: 'Name', kind: 'text' },
        { key: 'category', label: 'Category', kind: 'text' },
        { key: 'status', label: 'Status', kind: 'status' },
        { key: 'makeModel', label: 'Make and model', kind: 'text', secondary: true },
        { key: 'serialNumber', label: 'Serial', kind: 'code', secondary: true },
        { key: 'barcode', label: 'Barcode', kind: 'code', secondary: true },
        { key: 'kitCode', label: 'Kit', kind: 'code' },
        { key: 'required', label: 'Required', kind: 'boolean', secondary: true },
        { key: 'outNow', label: 'Out now', kind: 'boolean' },
        { key: 'inMaintenance', label: 'In maintenance', kind: 'boolean' },
        { key: 'openIssues', label: 'Open issues', kind: 'number', numeric: true },
      ],
      rows,
      total,
      page,
      pageSize: params.pageSize,
      pageCount,
      summary: `${plural(total, 'asset')}${params.status ? ` at ${params.status.toLowerCase().replace(/_/g, ' ')}` : ''}.`,
    }
  },
}

/** 11. The maintenance that exists, read-only as Phase 4 left it. */
const maintenanceReport: ReportDefinition = {
  id: 'maintenance',
  title: 'Maintenance records',
  description: 'Maintenance on record per asset, with its state, cost and how long it has been open.',
  group: 'Equipment',
  alsoNeeds: ['maintenance.read'],
  filters: ['search', 'from', 'to', 'status'],
  statusOptions: Object.values(MaintenanceStatus).map((status) => ({ value: status, label: status.toLowerCase().replace(/_/g, ' ') })),
  async run(db, params) {
    const clauses: Prisma.MaintenanceRecordWhereInput[] = [{ deletedAt: null }]
    if (params.status) clauses.push({ status: params.status as MaintenanceStatus })
    if (params.from || params.to) clauses.push({ createdAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lt: params.to } : {}) } })
    if (params.search) {
      const contains = { contains: params.search, mode: 'insensitive' as const }
      clauses.push({ OR: [{ maintenanceNumber: contains }, { title: contains }, { asset: { assetCode: contains } }, { asset: { name: contains } }, { vendor: contains }] })
    }
    const where: Prisma.MaintenanceRecordWhereInput = { AND: clauses }

    const total = await db.maintenanceRecord.count({ where })
    const { skip, take, pageCount, page } = paginate(params.page, params.pageSize, total)
    const records = await db.maintenanceRecord.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip,
      take,
      select: {
        id: true,
        maintenanceNumber: true,
        type: true,
        status: true,
        title: true,
        scheduledFor: true,
        startedAt: true,
        completedAt: true,
        cost: true,
        currency: true,
        vendor: true,
        asset: { select: { id: true, assetCode: true, name: true } },
        issue: { select: { issueNumber: true } },
      },
    })

    const rows = records.map((record) => ({
      id: record.asset.id,
      maintenanceNumber: record.maintenanceNumber,
      assetCode: record.asset.assetCode,
      assetName: record.asset.name,
      type: record.type,
      status: record.status,
      title: record.title,
      vendor: record.vendor,
      scheduledFor: record.scheduledFor,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      // Decimal is not a plain value; the report layer only carries plain ones.
      cost: record.cost === null ? null : Number(record.cost),
      currency: record.currency,
      fromIssue: record.issue?.issueNumber ?? null,
      daysOpen: record.startedAt && !record.completedAt ? Math.floor((params.now.getTime() - record.startedAt.getTime()) / 86_400_000) : null,
    }))

    return {
      columns: [
        { key: 'maintenanceNumber', label: 'Record', kind: 'code' },
        { key: 'assetCode', label: 'Equipment', kind: 'code', linkTo: 'asset' },
        { key: 'assetName', label: 'Name', kind: 'text', secondary: true },
        { key: 'type', label: 'Type', kind: 'status' },
        { key: 'status', label: 'Status', kind: 'status' },
        { key: 'title', label: 'Work', kind: 'text' },
        { key: 'vendor', label: 'Vendor', kind: 'text', secondary: true },
        { key: 'scheduledFor', label: 'Scheduled', kind: 'date', secondary: true },
        { key: 'startedAt', label: 'Started', kind: 'date' },
        { key: 'completedAt', label: 'Completed', kind: 'date' },
        { key: 'daysOpen', label: 'Days open', kind: 'number', numeric: true },
        { key: 'cost', label: 'Cost', kind: 'number', numeric: true },
        { key: 'currency', label: 'Currency', kind: 'text', secondary: true },
        { key: 'fromIssue', label: 'From issue', kind: 'code', secondary: true },
      ],
      rows,
      total,
      page,
      pageSize: params.pageSize,
      pageCount,
      summary: `${plural(total, 'maintenance record')}${params.status ? ` at ${params.status.toLowerCase().replace(/_/g, ' ')}` : ''}.`,
    }
  },
}

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  checkedOut,
  dueReturns,
  overdue,
  bookingHistory,
  kitUtilisation,
  editorHistory,
  inspectionRecords,
  missingDamaged,
  issueReport,
  equipmentStatus,
  maintenanceReport,
]
