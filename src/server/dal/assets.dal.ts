import 'server-only'

import {
  AssetStatus,
  AuditAction,
  BookingStatus,
  type InspectionType,
  type IssueSeverity,
  type IssueStatus,
  type IssueType,
  type ItemConditionStatus,
  type MaintenanceStatus,
  type MaintenanceType,
  MaintenanceStatus as MaintenanceStatusEnum,
  type Prisma,
} from '@prisma/client'

import type { AssetAssignment, AssetSortKey, AssetView } from '@/lib/validation/assets'
import type { Db } from '@/server/db/prisma'

/**
 * Equipment reads.
 *
 * Every function is one or two indexed queries with an explicit `select`,
 * returning flat display rows. The list is paginated in the database
 * (`skip` / `take` + `count`), searched through the trigram indexes on
 * assetCode, admBarcode, serialNumber, name and model, and never loads more
 * than one page. Nothing about users leaves this module except a display name
 * on status-log entries.
 */

export const ACTIVE_MAINTENANCE_STATUSES = [MaintenanceStatusEnum.IN_PROGRESS, MaintenanceStatusEnum.ON_HOLD] as const

const LIVE_BOOKING_STATUSES = [
  BookingStatus.RESERVED,
  BookingStatus.READY_FOR_HANDOVER,
  BookingStatus.CHECKED_OUT,
  BookingStatus.OVERDUE,
  BookingStatus.RETURN_INSPECTION,
] as const

/** Which stored statuses each list tab shows. `all` shows every live asset. */
export const ASSET_VIEW_STATUSES: Record<AssetView, readonly AssetStatus[] | null> = {
  all: null,
  available: [AssetStatus.AVAILABLE],
  'checked-out': [AssetStatus.CHECKED_OUT, AssetStatus.RESERVED],
  maintenance: [AssetStatus.MAINTENANCE],
  'missing-damaged': [AssetStatus.MISSING, AssetStatus.DAMAGED],
  retired: [AssetStatus.RETIRED],
}

// -----------------------------------------------------------------------------
// List
// -----------------------------------------------------------------------------

export interface AssetListQuery {
  search?: string
  categoryId?: string
  view: AssetView
  assignment: AssetAssignment
  sort: AssetSortKey
  direction: 'asc' | 'desc'
  page: number
  pageSize: number
}

export interface AssetListRow {
  id: string
  assetCode: string
  name: string
  category: { id: string; name: string }
  manufacturer: string | null
  model: string | null
  serialNumber: string | null
  admBarcode: string | null
  status: AssetStatus
  updatedAt: Date
  currentKit: { id: string; kitCode: string; name: string } | null
}

export interface AssetListResult {
  rows: AssetListRow[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

const listSelect = {
  id: true,
  assetCode: true,
  name: true,
  manufacturer: true,
  model: true,
  serialNumber: true,
  admBarcode: true,
  status: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  kitAssets: {
    where: { removedAt: null },
    select: { kit: { select: { id: true, kitCode: true, name: true } } },
    take: 1,
  },
} satisfies Prisma.AssetSelect

type ListRecord = Prisma.AssetGetPayload<{ select: typeof listSelect }>

function toListRow(record: ListRecord): AssetListRow {
  return {
    id: record.id,
    assetCode: record.assetCode,
    name: record.name,
    category: record.category,
    manufacturer: record.manufacturer,
    model: record.model,
    serialNumber: record.serialNumber,
    admBarcode: record.admBarcode,
    status: record.status,
    updatedAt: record.updatedAt,
    currentKit: record.kitAssets[0]?.kit ?? null,
  }
}

function searchWhere(search: string): Prisma.AssetWhereInput | null {
  const term = search.trim().slice(0, 100)
  if (!term) return null
  const contains = { contains: term, mode: 'insensitive' as const }
  return {
    OR: [
      { assetCode: contains },
      { admBarcode: contains },
      { serialNumber: contains },
      { manufacturer: contains },
      { model: contains },
      { name: contains },
    ],
  }
}

function orderBy(sort: AssetSortKey, direction: 'asc' | 'desc'): Prisma.AssetOrderByWithRelationInput[] {
  const primary: Prisma.AssetOrderByWithRelationInput =
    sort === 'category' ? { category: { name: direction } } : { [sort]: direction }
  // A stable secondary key keeps pagination deterministic.
  return sort === 'assetCode' ? [primary] : [primary, { assetCode: 'asc' }]
}

export function assetListWhere(query: AssetListQuery): Prisma.AssetWhereInput {
  const terms: Prisma.AssetWhereInput[] = [{ deletedAt: null }]

  const statuses = ASSET_VIEW_STATUSES[query.view]
  if (statuses) terms.push({ status: { in: [...statuses] } })
  if (query.categoryId) terms.push({ categoryId: query.categoryId })
  if (query.assignment === 'in-kit') terms.push({ kitAssets: { some: { removedAt: null } } })
  if (query.assignment === 'unassigned') terms.push({ kitAssets: { none: { removedAt: null } } })

  const bySearch = query.search ? searchWhere(query.search) : null
  if (bySearch) terms.push(bySearch)

  return { AND: terms }
}

export async function listAssets(db: Db, query: AssetListQuery): Promise<AssetListResult> {
  const where = assetListWhere(query)
  const pageSize = Math.max(1, query.pageSize)

  const total = await db.asset.count({ where })
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, query.page), pageCount)

  const records = await db.asset.findMany({
    where,
    select: listSelect,
    orderBy: orderBy(query.sort, query.direction),
    skip: (page - 1) * pageSize,
    take: pageSize,
  })

  return { rows: records.map(toListRow), total, page, pageSize, pageCount }
}

/** One `GROUP BY status` over live assets - feeds the tab counts. */
export async function countAssetsByStatus(db: Db): Promise<Record<AssetStatus, number>> {
  const groups = await db.asset.groupBy({
    by: ['status'],
    where: { deletedAt: null },
    _count: { _all: true },
  })
  const counts = Object.fromEntries(Object.values(AssetStatus).map((status) => [status, 0])) as Record<AssetStatus, number>
  for (const group of groups) counts[group.status] = group._count._all
  return counts
}

/**
 * Barcode-scanner path: an exact ADM barcode match on an asset, or on one of
 * its accessories, resolves straight to the asset. Both columns are unique
 * B-tree indexes, so this is a point lookup.
 */
export async function findAssetIdByBarcode(db: Db, barcode: string): Promise<string | null> {
  const code = barcode.trim()
  if (!code) return null

  const asset = await db.asset.findFirst({ where: { admBarcode: code, deletedAt: null }, select: { id: true } })
  if (asset) return asset.id

  const accessory = await db.accessory.findFirst({
    where: { admBarcode: code, deletedAt: null, asset: { deletedAt: null } },
    select: { assetId: true },
  })
  return accessory?.assetId ?? null
}

// -----------------------------------------------------------------------------
// Detail
// -----------------------------------------------------------------------------

export interface AssetAccessoryRow {
  id: string
  label: string | null
  quantity: number
  serialNumber: string | null
  admBarcode: string | null
  status: AssetStatus
  isRequired: boolean
  sortOrder: number
  notes: string | null
  accessoryType: { id: string; code: string; name: string }
}

export interface AssetMaintenanceRow {
  id: string
  maintenanceNumber: string
  type: MaintenanceType
  status: MaintenanceStatus
  title: string
  scheduledFor: Date | null
  startedAt: Date | null
  completedAt: Date | null
  vendor: string | null
  outcome: string | null
}

export interface AssetIssueRow {
  id: string
  issueNumber: string
  type: IssueType
  severity: IssueSeverity
  status: IssueStatus
  title: string
  reportedAt: Date
  resolvedAt: Date | null
}

export interface AssetActiveBooking {
  id: string
  bookingNumber: string
  status: BookingStatus
  bookingStart: Date
  expectedReturnDate: Date
  editorName: string
}

export interface AssetDetail {
  id: string
  assetCode: string
  name: string
  manufacturer: string | null
  model: string | null
  serialNumber: string | null
  admBarcode: string | null
  status: AssetStatus
  condition: string | null
  location: string | null
  purchaseDate: Date | null
  warrantyEnd: Date | null
  notes: string | null
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
  category: { id: string; code: string; name: string; isActive: boolean }
  currentKit: { id: string; kitCode: string; name: string; slotLabel: string | null } | null
  activeBooking: AssetActiveBooking | null
  accessories: AssetAccessoryRow[]
  /** null when the caller lacks maintenance.read */
  maintenance: AssetMaintenanceRow[] | null
  /** null when the caller lacks issue.read */
  issues: AssetIssueRow[] | null
  activeMaintenanceCount: number
  inspectionCount: number
}

export interface AssetDetailOptions {
  includeMaintenance: boolean
  includeIssues: boolean
}

const detailSelect = {
  id: true,
  assetCode: true,
  name: true,
  manufacturer: true,
  model: true,
  serialNumber: true,
  admBarcode: true,
  status: true,
  condition: true,
  location: true,
  purchaseDate: true,
  warrantyEnd: true,
  notes: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, code: true, name: true, isActive: true } },
  kitAssets: {
    where: { removedAt: null },
    select: { slotLabel: true, kit: { select: { id: true, kitCode: true, name: true } } },
    take: 1,
  },
  accessories: {
    where: { deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      label: true,
      quantity: true,
      serialNumber: true,
      admBarcode: true,
      status: true,
      isRequired: true,
      sortOrder: true,
      notes: true,
      accessoryType: { select: { id: true, code: true, name: true } },
    },
  },
  _count: { select: { assetInspections: true } },
} satisfies Prisma.AssetSelect

export async function getAssetDetail(db: Db, id: string, options: AssetDetailOptions): Promise<AssetDetail | null> {
  const asset = await db.asset.findUnique({ where: { id }, select: detailSelect })
  if (!asset) return null

  const kit = asset.kitAssets[0]?.kit ?? null

  const [activeMaintenanceCount, maintenance, issues, activeBooking] = await Promise.all([
    db.maintenanceRecord.count({
      where: { assetId: id, deletedAt: null, status: { in: [...ACTIVE_MAINTENANCE_STATUSES] } },
    }),
    options.includeMaintenance
      ? db.maintenanceRecord.findMany({
          where: { assetId: id, deletedAt: null },
          orderBy: [{ createdAt: 'desc' }],
          take: 20,
          select: {
            id: true,
            maintenanceNumber: true,
            type: true,
            status: true,
            title: true,
            scheduledFor: true,
            startedAt: true,
            completedAt: true,
            vendor: true,
            outcome: true,
          },
        })
      : null,
    options.includeIssues
      ? db.issue.findMany({
          where: { assetId: id },
          orderBy: [{ reportedAt: 'desc' }],
          take: 20,
          select: {
            id: true,
            issueNumber: true,
            type: true,
            severity: true,
            status: true,
            title: true,
            reportedAt: true,
            resolvedAt: true,
          },
        })
      : null,
    kit
      ? db.booking.findFirst({
          where: { kitId: kit.id, deletedAt: null, status: { in: [...LIVE_BOOKING_STATUSES] } },
          orderBy: [{ bookingStart: 'asc' }],
          select: {
            id: true,
            bookingNumber: true,
            status: true,
            bookingStart: true,
            expectedReturnDate: true,
            editor: { select: { fullName: true } },
          },
        })
      : null,
  ])

  return {
    id: asset.id,
    assetCode: asset.assetCode,
    name: asset.name,
    manufacturer: asset.manufacturer,
    model: asset.model,
    serialNumber: asset.serialNumber,
    admBarcode: asset.admBarcode,
    status: asset.status,
    condition: asset.condition,
    location: asset.location,
    purchaseDate: asset.purchaseDate,
    warrantyEnd: asset.warrantyEnd,
    notes: asset.notes,
    deletedAt: asset.deletedAt,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    category: asset.category,
    currentKit: kit ? { ...kit, slotLabel: asset.kitAssets[0]?.slotLabel ?? null } : null,
    activeBooking: activeBooking
      ? {
          id: activeBooking.id,
          bookingNumber: activeBooking.bookingNumber,
          status: activeBooking.status,
          bookingStart: activeBooking.bookingStart,
          expectedReturnDate: activeBooking.expectedReturnDate,
          editorName: activeBooking.editor.fullName,
        }
      : null,
    accessories: asset.accessories,
    maintenance,
    issues,
    activeMaintenanceCount,
    inspectionCount: asset._count.assetInspections,
  }
}

// -----------------------------------------------------------------------------
// Lifecycle context
// -----------------------------------------------------------------------------

export interface AssetLifecycleContext {
  status: AssetStatus
  deleted: boolean
  inKit: boolean
  hasActiveMaintenance: boolean
  hasLiveBooking: boolean
}

/** The facts the lifecycle rules need, in three indexed lookups. */
export async function getAssetLifecycleContext(db: Db, id: string): Promise<AssetLifecycleContext | null> {
  const asset = await db.asset.findUnique({
    where: { id },
    select: {
      status: true,
      deletedAt: true,
      kitAssets: { where: { removedAt: null }, select: { kitId: true }, take: 1 },
    },
  })
  if (!asset) return null

  const kitId = asset.kitAssets[0]?.kitId ?? null
  const [activeMaintenance, liveBookings] = await Promise.all([
    db.maintenanceRecord.count({
      where: { assetId: id, deletedAt: null, status: { in: [...ACTIVE_MAINTENANCE_STATUSES] } },
    }),
    kitId
      ? db.booking.count({ where: { kitId, deletedAt: null, status: { in: [...LIVE_BOOKING_STATUSES] } } })
      : Promise.resolve(0),
  ])

  return {
    status: asset.status,
    deleted: asset.deletedAt !== null,
    inKit: kitId !== null,
    hasActiveMaintenance: activeMaintenance > 0,
    hasLiveBooking: liveBookings > 0,
  }
}

// -----------------------------------------------------------------------------
// History
// -----------------------------------------------------------------------------

export type AssetHistoryKind =
  | 'created'
  | 'status'
  | 'kit'
  | 'handover'
  | 'return'
  | 'issue'
  | 'maintenance'
  | 'accessory'
  | 'update'
  | 'removed'

export interface AssetHistoryEvent {
  id: string
  at: Date
  kind: AssetHistoryKind
  title: string
  detail: string | null
  actorName: string | null
  reference: { label: string; href: string | null } | null
}

export interface AssetHistoryOptions {
  includeIssues: boolean
  includeMaintenance: boolean
  limit?: number
}

function humanize(value: string): string {
  const words = value.toLowerCase().split('_')
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(' ')
}

function inspectionTitle(type: InspectionType, status: ItemConditionStatus, bookingNumber: string): string {
  const condition = status === 'INCLUDED' ? '' : ` · recorded ${humanize(status)}`
  return type === 'HANDOVER' ? `Checked out under ${bookingNumber}${condition}` : `Returned under ${bookingNumber}${condition}`
}

/**
 * One chronological trail from six sources - status log, kit membership,
 * inspection lines, issues, maintenance, and the asset's own audit entries.
 * Six indexed queries run concurrently and are merged in memory; the result is
 * capped. Issue and maintenance events are included only when the caller may
 * read those domains.
 */
export async function getAssetHistory(db: Db, id: string, options: AssetHistoryOptions): Promise<AssetHistoryEvent[]> {
  const limit = options.limit ?? 100

  const [statusLogs, kitAssets, inspections, issues, maintenance, audits] = await Promise.all([
    db.assetStatusLog.findMany({
      where: { assetId: id },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        reason: true,
        createdAt: true,
        changedBy: { select: { name: true } },
        booking: { select: { id: true, bookingNumber: true } },
      },
    }),
    db.kitAsset.findMany({
      where: { assetId: id },
      orderBy: [{ addedAt: 'desc' }],
      take: limit,
      select: { id: true, addedAt: true, removedAt: true, slotLabel: true, kit: { select: { id: true, kitCode: true, name: true } } },
    }),
    db.assetInspection.findMany({
      where: { assetId: id },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        status: true,
        createdAt: true,
        inspection: {
          select: {
            type: true,
            startedAt: true,
            completedAt: true,
            voidedAt: true,
            booking: { select: { id: true, bookingNumber: true } },
          },
        },
      },
    }),
    options.includeIssues
      ? db.issue.findMany({
          where: { assetId: id },
          orderBy: [{ reportedAt: 'desc' }],
          take: limit,
          select: { id: true, issueNumber: true, title: true, type: true, status: true, reportedAt: true, resolvedAt: true },
        })
      : Promise.resolve([]),
    options.includeMaintenance
      ? db.maintenanceRecord.findMany({
          where: { assetId: id, deletedAt: null },
          orderBy: [{ createdAt: 'desc' }],
          take: limit,
          select: {
            id: true,
            maintenanceNumber: true,
            title: true,
            type: true,
            status: true,
            createdAt: true,
            startedAt: true,
            completedAt: true,
            cancelledAt: true,
          },
        })
      : Promise.resolve([]),
    db.auditLog.findMany({
      where: {
        entityType: 'Asset',
        entityId: id,
        action: { in: [AuditAction.CREATE, AuditAction.UPDATE, AuditAction.DELETE, AuditAction.RESTORE] },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      select: { id: true, action: true, summary: true, actorName: true, createdAt: true },
    }),
  ])

  const events: AssetHistoryEvent[] = []

  for (const log of statusLogs) {
    events.push({
      id: `status:${log.id}`,
      at: log.createdAt,
      kind: log.fromStatus === null ? 'created' : 'status',
      title:
        log.fromStatus === null
          ? `Recorded as ${humanize(log.toStatus)}`
          : `Status changed ${humanize(log.fromStatus)} → ${humanize(log.toStatus)}`,
      detail: log.reason,
      actorName: log.changedBy?.name ?? null,
      reference: log.booking ? { label: log.booking.bookingNumber, href: '/bookings' } : null,
    })
  }

  for (const membership of kitAssets) {
    const kitLabel = `${membership.kit.kitCode} · ${membership.kit.name}`
    events.push({
      id: `kit-add:${membership.id}`,
      at: membership.addedAt,
      kind: 'kit',
      title: `Added to kit ${membership.kit.kitCode}`,
      detail: membership.slotLabel ? `Slot: ${membership.slotLabel}` : kitLabel,
      actorName: null,
      reference: { label: membership.kit.kitCode, href: `/kits/${membership.kit.id}` },
    })
    if (membership.removedAt) {
      events.push({
        id: `kit-remove:${membership.id}`,
        at: membership.removedAt,
        kind: 'kit',
        title: `Removed from kit ${membership.kit.kitCode}`,
        detail: kitLabel,
        actorName: null,
        reference: { label: membership.kit.kitCode, href: `/kits/${membership.kit.id}` },
      })
    }
  }

  for (const line of inspections) {
    if (line.inspection.voidedAt) continue
    const at = line.inspection.completedAt ?? line.inspection.startedAt ?? line.createdAt
    events.push({
      id: `inspection:${line.id}`,
      at,
      kind: line.inspection.type === 'HANDOVER' ? 'handover' : 'return',
      title: inspectionTitle(line.inspection.type, line.status, line.inspection.booking.bookingNumber),
      detail: line.inspection.completedAt ? null : 'Inspection in progress',
      actorName: null,
      reference: { label: line.inspection.booking.bookingNumber, href: '/bookings' },
    })
  }

  for (const issue of issues) {
    events.push({
      id: `issue:${issue.id}`,
      at: issue.reportedAt,
      kind: 'issue',
      title: `Issue ${issue.issueNumber} reported`,
      detail: `${humanize(issue.type)} · ${issue.title}`,
      actorName: null,
      reference: { label: issue.issueNumber, href: '/issues' },
    })
    if (issue.resolvedAt) {
      events.push({
        id: `issue-resolved:${issue.id}`,
        at: issue.resolvedAt,
        kind: 'issue',
        title: `Issue ${issue.issueNumber} resolved`,
        detail: issue.title,
        actorName: null,
        reference: { label: issue.issueNumber, href: '/issues' },
      })
    }
  }

  for (const record of maintenance) {
    const reference = { label: record.maintenanceNumber, href: null }
    events.push({
      id: `maintenance:${record.id}`,
      at: record.createdAt,
      kind: 'maintenance',
      title: `Maintenance ${record.maintenanceNumber} scheduled`,
      detail: `${humanize(record.type)} · ${record.title}`,
      actorName: null,
      reference,
    })
    if (record.startedAt) {
      events.push({
        id: `maintenance-start:${record.id}`,
        at: record.startedAt,
        kind: 'maintenance',
        title: `Maintenance ${record.maintenanceNumber} started`,
        detail: record.title,
        actorName: null,
        reference,
      })
    }
    if (record.completedAt) {
      events.push({
        id: `maintenance-done:${record.id}`,
        at: record.completedAt,
        kind: 'maintenance',
        title: `Maintenance ${record.maintenanceNumber} completed`,
        detail: record.title,
        actorName: null,
        reference,
      })
    }
    if (record.cancelledAt) {
      events.push({
        id: `maintenance-cancel:${record.id}`,
        at: record.cancelledAt,
        kind: 'maintenance',
        title: `Maintenance ${record.maintenanceNumber} cancelled`,
        detail: record.title,
        actorName: null,
        reference,
      })
    }
  }

  for (const audit of audits) {
    const summary = audit.summary ?? ''
    const isAccessory = /^Accessory /.test(summary)
    const kind: AssetHistoryKind =
      audit.action === 'CREATE' && !isAccessory
        ? 'created'
        : audit.action === 'DELETE' && !isAccessory
          ? 'removed'
          : isAccessory
            ? 'accessory'
            : 'update'
    // The creation status-log entry already says "Recorded as …"; keep the
    // audit "added to inventory" line, drop nothing else.
    events.push({
      id: `audit:${audit.id}`,
      at: audit.createdAt,
      kind,
      title: summary || humanize(audit.action),
      detail: null,
      actorName: audit.actorName,
      reference: null,
    })
  }

  events.sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id))
  return events.slice(0, limit)
}

// -----------------------------------------------------------------------------
// Accessories
// -----------------------------------------------------------------------------

export async function getAccessory(db: Db, accessoryId: string) {
  return db.accessory.findFirst({
    where: { id: accessoryId, deletedAt: null },
    select: {
      id: true,
      assetId: true,
      accessoryTypeId: true,
      label: true,
      quantity: true,
      serialNumber: true,
      admBarcode: true,
      isRequired: true,
      notes: true,
      accessoryType: { select: { name: true } },
    },
  })
}
