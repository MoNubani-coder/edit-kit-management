import 'server-only'

import {
  type AssetStatus,
  AuditAction,
  BookingStatus,
  type IssueSeverity,
  type IssueStatus,
  type IssueType,
  KitStatus,
  type Prisma,
  type SuitcaseStatus,
} from '@prisma/client'

import type { KitSortKey, KitView } from '@/lib/validation/kits'
import { ACTIVE_MAINTENANCE_STATUSES } from '@/server/dal/assets.dal'
import type { Db } from '@/server/db/prisma'

/**
 * Kit reads.
 *
 * A kit is a name, a code and a barcode; its contents are `KitAsset` rows.
 * Every function here returns flat display rows with explicit selects. The
 * list is paginated in the database and searched through the trigram indexes
 * on kitCode, name and admBarcode plus the contained equipment's code, barcode
 * and serial number. Nothing about users leaves this module except display
 * names on bookings and audit entries.
 *
 * The *facts* the availability calculation needs (member statuses, active
 * maintenance, the live booking) are gathered here in one shape -
 * `KitAvailabilityFacts` - for both the list and the detail page, so the rule
 * itself lives in exactly one place (kits.service.ts).
 */

/** Bookings that currently hold the kit, from reservation to return inspection. */
export const LIVE_BOOKING_STATUSES = [
  BookingStatus.RESERVED,
  BookingStatus.READY_FOR_HANDOVER,
  BookingStatus.CHECKED_OUT,
  BookingStatus.OVERDUE,
  BookingStatus.RETURN_INSPECTION,
] as const

/** Bookings during which the kit's contents are frozen: the handover document is being (or has been) signed. */
export const CONTENTS_LOCKED_BOOKING_STATUSES = [
  BookingStatus.READY_FOR_HANDOVER,
  BookingStatus.CHECKED_OUT,
  BookingStatus.OVERDUE,
  BookingStatus.RETURN_INSPECTION,
] as const

/** Bookings during which the kit is physically out of the store. */
export const OUT_BOOKING_STATUSES = [BookingStatus.CHECKED_OUT, BookingStatus.OVERDUE, BookingStatus.RETURN_INSPECTION] as const

/** Which stored statuses each list tab shows. `all` shows every live kit. */
export const KIT_VIEW_STATUSES: Record<KitView, readonly KitStatus[] | null> = {
  all: null,
  available: [KitStatus.AVAILABLE],
  reserved: [KitStatus.RESERVED],
  'checked-out': [KitStatus.CHECKED_OUT],
  maintenance: [KitStatus.MAINTENANCE, KitStatus.DAMAGED],
  retired: [KitStatus.RETIRED],
}

// -----------------------------------------------------------------------------
// Shared shapes
// -----------------------------------------------------------------------------

export interface KitBookingSummary {
  id: string
  bookingNumber: string
  status: BookingStatus
  bookingStart: Date
  bookingEnd: Date
  expectedReturnDate: Date
  collectionDate: Date | null
  editorName: string
  engineerName: string
}

/** One active member, reduced to what the availability rule needs. */
export interface KitMemberFacts {
  kitAssetId: string
  assetId: string
  assetCode: string
  name: string
  slotLabel: string | null
  isRequired: boolean
  status: AssetStatus
  deleted: boolean
  activeMaintenanceCount: number
}

export interface KitAvailabilityFacts {
  kitId: string
  kitCode: string
  status: KitStatus
  deleted: boolean
  isActive: boolean
  members: KitMemberFacts[]
  liveBooking: KitBookingSummary | null
}

const liveBookingArgs = {
  where: { deletedAt: null, status: { in: [...LIVE_BOOKING_STATUSES] } },
  orderBy: [{ bookingStart: 'asc' }],
  take: 1,
  select: {
    id: true,
    bookingNumber: true,
    status: true,
    bookingStart: true,
    bookingEnd: true,
    expectedReturnDate: true,
    collectionDate: true,
    editor: { select: { fullName: true } },
    engineer: { select: { fullName: true } },
  },
} satisfies Prisma.Kit$bookingsArgs

type LiveBookingRecord = Prisma.BookingGetPayload<{ select: typeof liveBookingArgs.select }>

function toBookingSummary(record: LiveBookingRecord | undefined): KitBookingSummary | null {
  if (!record) return null
  return {
    id: record.id,
    bookingNumber: record.bookingNumber,
    status: record.status,
    bookingStart: record.bookingStart,
    bookingEnd: record.bookingEnd,
    expectedReturnDate: record.expectedReturnDate,
    collectionDate: record.collectionDate,
    editorName: record.editor.fullName,
    engineerName: record.engineer.fullName,
  }
}

const activeMaintenanceCount = {
  select: { maintenanceRecords: { where: { deletedAt: null, status: { in: [...ACTIVE_MAINTENANCE_STATUSES] } } } },
} satisfies Prisma.AssetCountOutputTypeDefaultArgs

const memberFactsSelect = {
  id: true,
  assetId: true,
  slotLabel: true,
  isRequired: true,
  sortOrder: true,
  asset: {
    select: { id: true, assetCode: true, name: true, status: true, deletedAt: true, _count: activeMaintenanceCount },
  },
} satisfies Prisma.KitAssetSelect

type MemberFactsRecord = Prisma.KitAssetGetPayload<{ select: typeof memberFactsSelect }>

function toMemberFacts(record: MemberFactsRecord): KitMemberFacts {
  return {
    kitAssetId: record.id,
    assetId: record.asset.id,
    assetCode: record.asset.assetCode,
    name: record.asset.name,
    slotLabel: record.slotLabel,
    isRequired: record.isRequired,
    status: record.asset.status,
    deleted: record.asset.deletedAt !== null,
    activeMaintenanceCount: record.asset._count.maintenanceRecords,
  }
}

const activeMembers = { where: { removedAt: null }, orderBy: [{ sortOrder: 'asc' }, { addedAt: 'asc' }] } satisfies Prisma.Kit$kitAssetsArgs

// -----------------------------------------------------------------------------
// List
// -----------------------------------------------------------------------------

export interface KitListQuery {
  search?: string
  view: KitView
  sort: KitSortKey
  direction: 'asc' | 'desc'
  page: number
  pageSize: number
}

export interface KitListRecord {
  id: string
  kitCode: string
  name: string
  admBarcode: string | null
  location: string | null
  status: KitStatus
  updatedAt: Date
  facts: KitAvailabilityFacts
}

export interface KitListResult<Row = KitListRecord> {
  rows: Row[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

const listSelect = {
  id: true,
  kitCode: true,
  name: true,
  admBarcode: true,
  location: true,
  status: true,
  isActive: true,
  deletedAt: true,
  updatedAt: true,
  kitAssets: { ...activeMembers, select: memberFactsSelect },
  bookings: liveBookingArgs,
} satisfies Prisma.KitSelect

type ListRecord = Prisma.KitGetPayload<{ select: typeof listSelect }>

function toListRecord(record: ListRecord): KitListRecord {
  return {
    id: record.id,
    kitCode: record.kitCode,
    name: record.name,
    admBarcode: record.admBarcode,
    location: record.location,
    status: record.status,
    updatedAt: record.updatedAt,
    facts: {
      kitId: record.id,
      kitCode: record.kitCode,
      status: record.status,
      deleted: record.deletedAt !== null,
      isActive: record.isActive,
      members: record.kitAssets.map(toMemberFacts),
      liveBooking: toBookingSummary(record.bookings[0]),
    },
  }
}

function searchWhere(search: string): Prisma.KitWhereInput | null {
  const term = search.trim().slice(0, 100)
  if (!term) return null
  const contains = { contains: term, mode: 'insensitive' as const }
  return {
    OR: [
      { kitCode: contains },
      { name: contains },
      { admBarcode: contains },
      {
        kitAssets: {
          some: {
            removedAt: null,
            asset: { OR: [{ assetCode: contains }, { admBarcode: contains }, { serialNumber: contains }] },
          },
        },
      },
    ],
  }
}

function orderBy(sort: KitSortKey, direction: 'asc' | 'desc'): Prisma.KitOrderByWithRelationInput[] {
  const primary: Prisma.KitOrderByWithRelationInput = { [sort]: direction }
  return sort === 'kitCode' ? [primary] : [primary, { kitCode: 'asc' }]
}

export function kitListWhere(query: KitListQuery): Prisma.KitWhereInput {
  const terms: Prisma.KitWhereInput[] = [{ deletedAt: null }]
  const statuses = KIT_VIEW_STATUSES[query.view]
  if (statuses) terms.push({ status: { in: [...statuses] } })
  const bySearch = query.search ? searchWhere(query.search) : null
  if (bySearch) terms.push(bySearch)
  return { AND: terms }
}

export async function listKits(db: Db, query: KitListQuery): Promise<KitListResult> {
  const where = kitListWhere(query)
  const pageSize = Math.max(1, query.pageSize)

  const total = await db.kit.count({ where })
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, query.page), pageCount)

  const records = await db.kit.findMany({
    where,
    select: listSelect,
    orderBy: orderBy(query.sort, query.direction),
    skip: (page - 1) * pageSize,
    take: pageSize,
  })

  return { rows: records.map(toListRecord), total, page, pageSize, pageCount }
}

/** One `GROUP BY status` over live kits - feeds the tab counts. */
export async function countKitsByStatus(db: Db): Promise<Record<KitStatus, number>> {
  const groups = await db.kit.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } })
  const counts = Object.fromEntries(Object.values(KitStatus).map((status) => [status, 0])) as Record<KitStatus, number>
  for (const group of groups) counts[group.status] = group._count._all
  return counts
}

/** Barcode-scanner path: an exact kit barcode opens the kit. */
/**
 * A kit from whatever a label carries: the id the QR encodes, or - for a label
 * printed before the QR run, or a code typed by hand - its kit code or ADM
 * barcode. Removed kits are not resolved; a scan of a retired case is a 404.
 */
export async function findKitByScan(db: Db, token: string): Promise<{ id: string; kitCode: string } | null> {
  const trimmed = token.trim()
  if (trimmed === '' || trimmed.length > 64) return null
  return db.kit.findFirst({
    where: {
      deletedAt: null,
      OR: [{ id: trimmed }, { kitCode: { equals: trimmed, mode: 'insensitive' } }, { admBarcode: { equals: trimmed, mode: 'insensitive' } }],
    },
    select: { id: true, kitCode: true },
  })
}

export async function findKitIdByBarcode(db: Db, barcode: string): Promise<string | null> {
  const code = barcode.trim()
  if (!code) return null
  const kit = await db.kit.findFirst({ where: { admBarcode: code, deletedAt: null }, select: { id: true } })
  return kit?.id ?? null
}

// -----------------------------------------------------------------------------
// Availability facts (detail-free, for the service's getKitAvailability)
// -----------------------------------------------------------------------------

export async function getKitAvailabilityFacts(db: Db, kitId: string): Promise<KitAvailabilityFacts | null> {
  const kit = await db.kit.findUnique({
    where: { id: kitId },
    select: {
      id: true,
      kitCode: true,
      status: true,
      deletedAt: true,
      isActive: true,
      kitAssets: { ...activeMembers, select: memberFactsSelect },
      bookings: liveBookingArgs,
    },
  })
  if (!kit) return null
  return {
    kitId: kit.id,
    kitCode: kit.kitCode,
    status: kit.status,
    deleted: kit.deletedAt !== null,
    isActive: kit.isActive,
    members: kit.kitAssets.map(toMemberFacts),
    liveBooking: toBookingSummary(kit.bookings[0]),
  }
}

// -----------------------------------------------------------------------------
// Detail
// -----------------------------------------------------------------------------

export interface KitAccessoryRow {
  id: string
  label: string | null
  quantity: number
  isRequired: boolean
  status: AssetStatus
  typeName: string
}

export interface KitMemberRow extends KitMemberFacts {
  sortOrder: number
  addedAt: Date
  manufacturer: string | null
  model: string | null
  serialNumber: string | null
  admBarcode: string | null
  category: { id: string; code: string; name: string; sortOrder: number }
  accessories: KitAccessoryRow[]
}

export interface KitSoftwareRow {
  id: string
  isRequired: boolean
  sortOrder: number
  software: { id: string; name: string; vendor: string | null; version: string | null; isActive: boolean }
}

export interface KitChecklistSummary {
  id: string
  name: string
  description: string | null
  version: number
  isActive: boolean
  isDefault: boolean
  itemCount: number
}

export interface KitIssueRow {
  id: string
  issueNumber: string
  type: IssueType
  severity: IssueSeverity
  status: IssueStatus
  title: string
  reportedAt: Date
  resolvedAt: Date | null
}

export interface KitDetail {
  id: string
  kitCode: string
  name: string
  description: string | null
  admBarcode: string | null
  status: KitStatus
  suitcaseStatus: SuitcaseStatus
  location: string | null
  notes: string | null
  isActive: boolean
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
  checklistTemplate: KitChecklistSummary | null
  members: KitMemberRow[]
  software: KitSoftwareRow[]
  liveBooking: KitBookingSummary | null
  bookingCount: number
  /** null when the caller lacks issue.read */
  issues: KitIssueRow[] | null
  openIssueCount: number | null
}

const memberSelect = {
  ...memberFactsSelect,
  addedAt: true,
  asset: {
    select: {
      id: true,
      assetCode: true,
      name: true,
      manufacturer: true,
      model: true,
      serialNumber: true,
      admBarcode: true,
      status: true,
      deletedAt: true,
      category: { select: { id: true, code: true, name: true, sortOrder: true } },
      accessories: {
        where: { deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, label: true, quantity: true, isRequired: true, status: true, accessoryType: { select: { name: true } } },
      },
      _count: activeMaintenanceCount,
    },
  },
} satisfies Prisma.KitAssetSelect

type MemberRecord = Prisma.KitAssetGetPayload<{ select: typeof memberSelect }>

function toMemberRow(record: MemberRecord): KitMemberRow {
  return {
    ...toMemberFacts(record),
    sortOrder: record.sortOrder,
    addedAt: record.addedAt,
    manufacturer: record.asset.manufacturer,
    model: record.asset.model,
    serialNumber: record.asset.serialNumber,
    admBarcode: record.asset.admBarcode,
    category: record.asset.category,
    accessories: record.asset.accessories.map((accessory) => ({
      id: accessory.id,
      label: accessory.label,
      quantity: accessory.quantity,
      isRequired: accessory.isRequired,
      status: accessory.status,
      typeName: accessory.accessoryType.name,
    })),
  }
}

const detailSelect = {
  id: true,
  kitCode: true,
  name: true,
  description: true,
  admBarcode: true,
  status: true,
  suitcaseStatus: true,
  location: true,
  notes: true,
  isActive: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  defaultChecklistTemplate: {
    select: { id: true, name: true, description: true, version: true, isActive: true, isDefault: true, _count: { select: { items: true } } },
  },
  kitAssets: { ...activeMembers, select: memberSelect },
  kitSoftware: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      isRequired: true,
      sortOrder: true,
      software: { select: { id: true, name: true, vendor: true, version: true, isActive: true } },
    },
  },
  bookings: liveBookingArgs,
  _count: { select: { bookings: { where: { deletedAt: null } } } },
} satisfies Prisma.KitSelect

export async function getKitDetail(db: Db, id: string, options: { includeIssues: boolean }): Promise<KitDetail | null> {
  const kit = await db.kit.findUnique({ where: { id }, select: detailSelect })
  if (!kit) return null

  const [issues, openIssueCount] = options.includeIssues
    ? await Promise.all([
        db.issue.findMany({
          where: { kitId: id },
          orderBy: [{ reportedAt: 'desc' }],
          take: 20,
          select: { id: true, issueNumber: true, type: true, severity: true, status: true, title: true, reportedAt: true, resolvedAt: true },
        }),
        db.issue.count({ where: { kitId: id, status: { in: ['OPEN', 'UNDER_INVESTIGATION'] } } }),
      ])
    : [null, null]

  const template = kit.defaultChecklistTemplate
  return {
    id: kit.id,
    kitCode: kit.kitCode,
    name: kit.name,
    description: kit.description,
    admBarcode: kit.admBarcode,
    status: kit.status,
    suitcaseStatus: kit.suitcaseStatus,
    location: kit.location,
    notes: kit.notes,
    isActive: kit.isActive,
    deletedAt: kit.deletedAt,
    createdAt: kit.createdAt,
    updatedAt: kit.updatedAt,
    checklistTemplate: template
      ? {
          id: template.id,
          name: template.name,
          description: template.description,
          version: template.version,
          isActive: template.isActive,
          isDefault: template.isDefault,
          itemCount: template._count.items,
        }
      : null,
    members: kit.kitAssets.map(toMemberRow),
    software: kit.kitSoftware,
    liveBooking: toBookingSummary(kit.bookings[0]),
    bookingCount: kit._count.bookings,
    issues,
    openIssueCount,
  }
}

/** The availability facts, taken from an already-loaded detail (no second query). */
export function factsFromDetail(detail: KitDetail): KitAvailabilityFacts {
  return {
    kitId: detail.id,
    kitCode: detail.kitCode,
    status: detail.status,
    deleted: detail.deletedAt !== null,
    isActive: detail.isActive,
    members: detail.members,
    liveBooking: detail.liveBooking,
  }
}

// -----------------------------------------------------------------------------
// Lifecycle context
// -----------------------------------------------------------------------------

export interface KitLifecycleContext {
  status: KitStatus
  deleted: boolean
  isActive: boolean
  memberCount: number
  hasLiveBooking: boolean
  /** A handover has started or the kit is out: contents must not change. */
  contentsLocked: boolean
}

export async function getKitLifecycleContext(db: Db, id: string): Promise<KitLifecycleContext | null> {
  const kit = await db.kit.findUnique({
    where: { id },
    select: {
      status: true,
      deletedAt: true,
      isActive: true,
      _count: { select: { kitAssets: { where: { removedAt: null } } } },
      bookings: {
        where: { deletedAt: null, status: { in: [...LIVE_BOOKING_STATUSES] } },
        select: { status: true },
      },
    },
  })
  if (!kit) return null

  const locked = new Set<BookingStatus>(CONTENTS_LOCKED_BOOKING_STATUSES)
  return {
    status: kit.status,
    deleted: kit.deletedAt !== null,
    isActive: kit.isActive,
    memberCount: kit._count.kitAssets,
    hasLiveBooking: kit.bookings.length > 0,
    contentsLocked: kit.bookings.some((booking) => locked.has(booking.status)),
  }
}

// -----------------------------------------------------------------------------
// Membership lookups
// -----------------------------------------------------------------------------

/** What the assignment rules need to know about one asset. */
export interface AssetAssignmentFacts {
  id: string
  assetCode: string
  name: string
  status: AssetStatus
  deleted: boolean
  activeMaintenanceCount: number
  currentKit: { id: string; kitCode: string } | null
}

const assignmentSelect = {
  id: true,
  assetCode: true,
  name: true,
  status: true,
  deletedAt: true,
  kitAssets: { where: { removedAt: null }, select: { kit: { select: { id: true, kitCode: true } } }, take: 1 },
  _count: activeMaintenanceCount,
} satisfies Prisma.AssetSelect

type AssignmentRecord = Prisma.AssetGetPayload<{ select: typeof assignmentSelect }>

function toAssignmentFacts(record: AssignmentRecord): AssetAssignmentFacts {
  return {
    id: record.id,
    assetCode: record.assetCode,
    name: record.name,
    status: record.status,
    deleted: record.deletedAt !== null,
    activeMaintenanceCount: record._count.maintenanceRecords,
    currentKit: record.kitAssets[0]?.kit ?? null,
  }
}

export async function getAssetAssignmentFacts(db: Db, assetId: string): Promise<AssetAssignmentFacts | null> {
  const asset = await db.asset.findUnique({ where: { id: assetId }, select: assignmentSelect })
  return asset ? toAssignmentFacts(asset) : null
}

export interface AssetCandidate extends AssetAssignmentFacts {
  manufacturer: string | null
  model: string | null
  serialNumber: string | null
  admBarcode: string | null
  categoryName: string
}

/**
 * Equipment picker behind "Add equipment": live assets matching the term on
 * code, barcode, serial, manufacturer, model or name. An exact barcode or
 * asset-code match is placed first so a scan lands on one row.
 */
export async function searchAssetCandidates(db: Db, term: string, limit = 12): Promise<AssetCandidate[]> {
  const search = term.trim().slice(0, 100)
  if (!search) return []
  const contains = { contains: search, mode: 'insensitive' as const }

  const records = await db.asset.findMany({
    where: {
      deletedAt: null,
      OR: [
        { assetCode: contains },
        { admBarcode: contains },
        { serialNumber: contains },
        { manufacturer: contains },
        { model: contains },
        { name: contains },
      ],
    },
    orderBy: [{ assetCode: 'asc' }],
    take: limit,
    select: {
      ...assignmentSelect,
      manufacturer: true,
      model: true,
      serialNumber: true,
      admBarcode: true,
      category: { select: { name: true } },
    },
  })

  const upper = search.toUpperCase()
  const rows = records.map((record) => ({
    ...toAssignmentFacts(record),
    manufacturer: record.manufacturer,
    model: record.model,
    serialNumber: record.serialNumber,
    admBarcode: record.admBarcode,
    categoryName: record.category.name,
  }))
  const exact = (row: AssetCandidate) => row.admBarcode?.toUpperCase() === upper || row.assetCode.toUpperCase() === upper
  return rows.sort((a, b) => Number(exact(b)) - Number(exact(a)) || a.assetCode.localeCompare(b.assetCode))
}

export async function getKitMembership(db: Db, kitAssetId: string) {
  return db.kitAsset.findUnique({
    where: { id: kitAssetId },
    select: {
      id: true,
      kitId: true,
      assetId: true,
      slotLabel: true,
      isRequired: true,
      sortOrder: true,
      removedAt: true,
      kit: { select: { id: true, kitCode: true, deletedAt: true } },
      asset: { select: { id: true, assetCode: true, name: true, status: true } },
    },
  })
}

// -----------------------------------------------------------------------------
// History
// -----------------------------------------------------------------------------

export type KitHistoryKind =
  | 'created'
  | 'update'
  | 'status'
  | 'member-added'
  | 'member-removed'
  | 'software'
  | 'checklist'
  | 'booking'
  | 'handover'
  | 'return'
  | 'issue'
  | 'removed'

export interface KitHistoryEvent {
  id: string
  at: Date
  kind: KitHistoryKind
  title: string
  detail: string | null
  actorName: string | null
  reference: { label: string; href: string | null } | null
}

function humanize(value: string): string {
  const words = value.toLowerCase().split('_')
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(' ')
}

const AUDIT_KINDS: Partial<Record<AuditAction, KitHistoryKind>> = {
  CREATE: 'created',
  UPDATE: 'update',
  DELETE: 'removed',
  RESTORE: 'update',
  KIT_STATUS_CHANGED: 'status',
  KIT_ASSET_ADDED: 'member-added',
  KIT_ASSET_REMOVED: 'member-removed',
  KIT_SOFTWARE_ADDED: 'software',
  KIT_SOFTWARE_REMOVED: 'software',
  KIT_CHECKLIST_CHANGED: 'checklist',
  KIT_ASSIGNED: 'booking',
}

function membershipRef(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const value = (metadata as { kitAssetId?: unknown }).kitAssetId
  return typeof value === 'string' ? value : null
}

/**
 * One chronological trail from four sources - the kit's audit entries,
 * membership rows, bookings and (with issue.read) issues. Membership audit
 * rows carry the `kitAssetId`, so a membership row that already has its audit
 * entry is not reported twice; seeded rows without one still show up.
 */
export async function getKitHistory(db: Db, id: string, options: { includeIssues: boolean; limit?: number }): Promise<KitHistoryEvent[]> {
  const limit = options.limit ?? 100

  const [audits, memberships, bookings, issues] = await Promise.all([
    db.auditLog.findMany({
      where: { entityType: 'Kit', entityId: id },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      select: { id: true, action: true, summary: true, actorName: true, createdAt: true, metadata: true },
    }),
    db.kitAsset.findMany({
      where: { kitId: id },
      orderBy: [{ addedAt: 'desc' }],
      take: limit,
      select: { id: true, addedAt: true, removedAt: true, slotLabel: true, asset: { select: { id: true, assetCode: true, name: true } } },
    }),
    db.booking.findMany({
      where: { kitId: id, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        bookingNumber: true,
        status: true,
        createdAt: true,
        bookingStart: true,
        collectionDate: true,
        actualReturnDate: true,
        cancelledAt: true,
        cancelReason: true,
        editor: { select: { fullName: true } },
      },
    }),
    options.includeIssues
      ? db.issue.findMany({
          where: { kitId: id },
          orderBy: [{ reportedAt: 'desc' }],
          take: limit,
          select: { id: true, issueNumber: true, title: true, type: true, reportedAt: true, resolvedAt: true },
        })
      : Promise.resolve([]),
  ])

  const events: KitHistoryEvent[] = []
  const audited = { added: new Set<string>(), removed: new Set<string>() }

  for (const audit of audits) {
    const ref = membershipRef(audit.metadata)
    if (ref && audit.action === AuditAction.KIT_ASSET_ADDED) audited.added.add(ref)
    if (ref && audit.action === AuditAction.KIT_ASSET_REMOVED) audited.removed.add(ref)
    events.push({
      id: `audit:${audit.id}`,
      at: audit.createdAt,
      kind: AUDIT_KINDS[audit.action] ?? 'update',
      title: audit.summary ?? humanize(audit.action),
      detail: null,
      actorName: audit.actorName,
      reference: null,
    })
  }

  for (const membership of memberships) {
    const reference = { label: membership.asset.assetCode, href: `/assets/${membership.asset.id}` }
    if (!audited.added.has(membership.id)) {
      events.push({
        id: `member-add:${membership.id}`,
        at: membership.addedAt,
        kind: 'member-added',
        title: `${membership.asset.assetCode} ${membership.asset.name} added`,
        detail: membership.slotLabel ? `Slot: ${membership.slotLabel}` : null,
        actorName: null,
        reference,
      })
    }
    if (membership.removedAt && !audited.removed.has(membership.id)) {
      events.push({
        id: `member-remove:${membership.id}`,
        at: membership.removedAt,
        kind: 'member-removed',
        title: `${membership.asset.assetCode} ${membership.asset.name} removed`,
        detail: null,
        actorName: null,
        reference,
      })
    }
  }

  for (const booking of bookings) {
    const reference = { label: booking.bookingNumber, href: '/bookings' }
    events.push({
      id: `booking:${booking.id}`,
      at: booking.createdAt,
      kind: 'booking',
      title: `Reserved under ${booking.bookingNumber} for ${booking.editor.fullName}`,
      detail: booking.status === 'COMPLETED' || booking.status === 'CANCELLED' ? null : humanize(booking.status),
      actorName: null,
      reference,
    })
    if (booking.collectionDate) {
      events.push({
        id: `handover:${booking.id}`,
        at: booking.collectionDate,
        kind: 'handover',
        title: `Checked out under ${booking.bookingNumber}`,
        detail: booking.editor.fullName,
        actorName: null,
        reference,
      })
    }
    if (booking.actualReturnDate) {
      events.push({
        id: `return:${booking.id}`,
        at: booking.actualReturnDate,
        kind: 'return',
        title: `Returned under ${booking.bookingNumber}`,
        detail: booking.status === 'COMPLETED' ? 'Booking completed' : humanize(booking.status),
        actorName: null,
        reference,
      })
    }
    if (booking.cancelledAt) {
      events.push({
        id: `cancel:${booking.id}`,
        at: booking.cancelledAt,
        kind: 'booking',
        title: `Booking ${booking.bookingNumber} cancelled`,
        detail: booking.cancelReason,
        actorName: null,
        reference,
      })
    }
  }

  for (const issue of issues) {
    const reference = { label: issue.issueNumber, href: '/issues' }
    events.push({
      id: `issue:${issue.id}`,
      at: issue.reportedAt,
      kind: 'issue',
      title: `Issue ${issue.issueNumber} reported against the kit`,
      detail: `${humanize(issue.type)} · ${issue.title}`,
      actorName: null,
      reference,
    })
    if (issue.resolvedAt) {
      events.push({
        id: `issue-resolved:${issue.id}`,
        at: issue.resolvedAt,
        kind: 'issue',
        title: `Issue ${issue.issueNumber} resolved`,
        detail: issue.title,
        actorName: null,
        reference,
      })
    }
  }

  events.sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id))
  return events.slice(0, limit)
}

// -----------------------------------------------------------------------------
// Kit picker for bookings (Phase 7)
// -----------------------------------------------------------------------------

export interface KitUpcomingBooking {
  id: string
  bookingNumber: string
  status: BookingStatus
  bookingStart: Date
  bookingEnd: Date
  editorName: string
}

export interface KitCandidate {
  id: string
  kitCode: string
  name: string
  admBarcode: string | null
  status: KitStatus
  facts: KitAvailabilityFacts
  /** Live bookings that end today or later, soonest first - what the scheduler needs to see. */
  upcoming: KitUpcomingBooking[]
}

/**
 * Live, non-retired kits matching the term on code, name or barcode, with the
 * facts the readiness rule needs and their upcoming live bookings. An exact
 * code or barcode match is placed first.
 */
export async function searchKitCandidates(db: Db, term: string, now: Date, limit = 10): Promise<KitCandidate[]> {
  const search = term.trim().slice(0, 100)
  if (!search) return []
  const contains = { contains: search, mode: 'insensitive' as const }

  const records = await db.kit.findMany({
    where: {
      deletedAt: null,
      status: { not: KitStatus.RETIRED },
      OR: [{ kitCode: contains }, { name: contains }, { admBarcode: contains }],
    },
    orderBy: [{ kitCode: 'asc' }],
    take: limit,
    select: {
      id: true,
      kitCode: true,
      name: true,
      admBarcode: true,
      status: true,
      isActive: true,
      deletedAt: true,
      kitAssets: { ...activeMembers, select: memberFactsSelect },
      bookings: {
        where: { deletedAt: null, status: { in: [...LIVE_BOOKING_STATUSES] }, bookingEnd: { gte: now } },
        orderBy: [{ bookingStart: 'asc' }],
        take: 5,
        select: { id: true, bookingNumber: true, status: true, bookingStart: true, bookingEnd: true, editor: { select: { fullName: true } } },
      },
    },
  })

  const upper = search.toUpperCase()
  const rows: KitCandidate[] = records.map((record) => ({
    id: record.id,
    kitCode: record.kitCode,
    name: record.name,
    admBarcode: record.admBarcode,
    status: record.status,
    facts: {
      kitId: record.id,
      kitCode: record.kitCode,
      status: record.status,
      deleted: record.deletedAt !== null,
      isActive: record.isActive,
      members: record.kitAssets.map(toMemberFacts),
      liveBooking: null,
    },
    upcoming: record.bookings.map((booking) => ({
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
      bookingStart: booking.bookingStart,
      bookingEnd: booking.bookingEnd,
      editorName: booking.editor.fullName,
    })),
  }))
  const exact = (row: KitCandidate) => row.kitCode.toUpperCase() === upper || row.admBarcode?.toUpperCase() === upper
  return rows.sort((a, b) => Number(exact(b)) - Number(exact(a)) || a.kitCode.localeCompare(b.kitCode))
}
