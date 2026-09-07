import 'server-only'

import { type AuditAction, IssueSeverity, IssueStatus, type IssueType, type MaintenanceStatus, type Prisma, UserStatus } from '@prisma/client'

import type { IssueFilter, IssueListParams } from '@/lib/validation/issues'
import type { Db } from '@/server/db/prisma'

/**
 * Issue reads.
 *
 * An issue is the record of something wrong with equipment: raised by a return
 * that found an item missing or damaged (Phase 9), or reported by hand. It
 * points at whatever it is about - an asset, an accessory, a kit, a booking,
 * the inspection that found it - and every one of those links is optional,
 * because a problem can be about the case itself.
 *
 * Everything here uses explicit selects. Attachment rows leave as metadata
 * only, never with a storage path or hash.
 */

export const OPEN_ISSUE_STATUSES = [IssueStatus.OPEN, IssueStatus.UNDER_INVESTIGATION] as const

// -----------------------------------------------------------------------------
// List
// -----------------------------------------------------------------------------

export interface IssueListRow {
  id: string
  issueNumber: string
  type: IssueType
  severity: IssueSeverity
  status: IssueStatus
  title: string
  reportedAt: Date
  resolvedAt: Date | null
  closedAt: Date | null
  reportedByName: string
  assignedToName: string | null
  assetCode: string | null
  assetName: string | null
  kitCode: string | null
  bookingNumber: string | null
  photoCount: number
}

const listSelect = {
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
  asset: { select: { assetCode: true, name: true } },
  kit: { select: { kitCode: true } },
  booking: { select: { bookingNumber: true } },
  _count: { select: { attachments: { where: { deletedAt: null } } } },
} satisfies Prisma.IssueSelect

type ListRecord = Prisma.IssueGetPayload<{ select: typeof listSelect }>

function toListRow(record: ListRecord): IssueListRow {
  return {
    id: record.id,
    issueNumber: record.issueNumber,
    type: record.type,
    severity: record.severity,
    status: record.status,
    title: record.title,
    reportedAt: record.reportedAt,
    resolvedAt: record.resolvedAt,
    closedAt: record.closedAt,
    reportedByName: record.reportedBy.name,
    assignedToName: record.assignedTo?.name ?? null,
    assetCode: record.asset?.assetCode ?? null,
    assetName: record.asset?.name ?? null,
    kitCode: record.kit?.kitCode ?? null,
    bookingNumber: record.booking?.bookingNumber ?? null,
    photoCount: record._count.attachments,
  }
}

/** `mine` needs to know who is asking; every other filter is self-contained. */
export function issueFilterWhere(filter: IssueFilter, actorUserId: string): Prisma.IssueWhereInput | null {
  switch (filter) {
    case 'open':
      return { status: { in: [...OPEN_ISSUE_STATUSES] } }
    case 'investigating':
      return { status: IssueStatus.UNDER_INVESTIGATION }
    case 'resolved':
      return { status: IssueStatus.RESOLVED }
    case 'closed':
      return { status: IssueStatus.CLOSED }
    case 'critical':
      return { severity: IssueSeverity.CRITICAL, status: { in: [...OPEN_ISSUE_STATUSES] } }
    case 'mine':
      return { assignedToId: actorUserId, status: { in: [...OPEN_ISSUE_STATUSES] } }
    default:
      return null
  }
}

const MAX_SEARCH_LENGTH = 100

function searchWhere(search: string): Prisma.IssueWhereInput | null {
  const term = search.trim().slice(0, MAX_SEARCH_LENGTH)
  if (!term) return null
  const contains = { contains: term, mode: 'insensitive' as const }
  return {
    OR: [
      { issueNumber: contains },
      { title: contains },
      { description: contains },
      { asset: { assetCode: contains } },
      { asset: { name: contains } },
      { asset: { serialNumber: contains } },
      { kit: { kitCode: contains } },
      { booking: { bookingNumber: contains } },
    ],
  }
}

function orderBy(params: IssueListParams): Prisma.IssueOrderByWithRelationInput[] {
  const direction = params.dir
  switch (params.sort) {
    case 'issueNumber':
      return [{ issueNumber: direction }]
    case 'severity':
      // Prisma orders enums by their declared order: LOW → CRITICAL.
      return [{ severity: direction }, { reportedAt: 'desc' }]
    case 'status':
      return [{ status: direction }, { reportedAt: 'desc' }]
    default:
      return [{ reportedAt: direction }]
  }
}

export interface IssueListResult {
  rows: IssueListRow[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

export async function listIssuesPage(db: Db, actorUserId: string, params: IssueListParams): Promise<IssueListResult> {
  const clauses = [issueFilterWhere(params.filter, actorUserId), params.q ? searchWhere(params.q) : null].filter((clause): clause is Prisma.IssueWhereInput => clause !== null)
  const where: Prisma.IssueWhereInput = clauses.length > 0 ? { AND: clauses } : {}

  const [total, records] = await Promise.all([
    db.issue.count({ where }),
    db.issue.findMany({ where, select: listSelect, orderBy: orderBy(params), skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
  ])

  return {
    rows: records.map(toListRow),
    total,
    page: params.page,
    pageSize: params.pageSize,
    pageCount: Math.max(1, Math.ceil(total / params.pageSize)),
  }
}

export async function countIssuesByFilter(db: Db, actorUserId: string): Promise<Record<IssueFilter, number>> {
  const [groups, critical, mine] = await Promise.all([
    db.issue.groupBy({ by: ['status'], _count: { _all: true } }),
    db.issue.count({ where: issueFilterWhere('critical', actorUserId)! }),
    db.issue.count({ where: issueFilterWhere('mine', actorUserId)! }),
  ])
  const byStatus = Object.fromEntries(Object.values(IssueStatus).map((status) => [status, 0])) as Record<IssueStatus, number>
  for (const group of groups) byStatus[group.status] = group._count._all

  return {
    open: byStatus.OPEN + byStatus.UNDER_INVESTIGATION,
    investigating: byStatus.UNDER_INVESTIGATION,
    resolved: byStatus.RESOLVED,
    closed: byStatus.CLOSED,
    critical,
    mine,
    all: groups.reduce((sum, group) => sum + group._count._all, 0),
  }
}

// -----------------------------------------------------------------------------
// Detail
// -----------------------------------------------------------------------------

export interface IssuePhotoMeta {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  caption: string | null
  uploadedByName: string | null
  createdAt: Date
}

export interface IssueMaintenanceRow {
  id: string
  maintenanceNumber: string
  status: MaintenanceStatus
  title: string
  startedAt: Date | null
  completedAt: Date | null
}

export interface IssueDetail {
  id: string
  issueNumber: string
  type: IssueType
  severity: IssueSeverity
  status: IssueStatus
  title: string
  description: string
  resolution: string | null
  reportedAt: Date
  resolvedAt: Date | null
  closedAt: Date | null
  reportedBy: { id: string; name: string } | null
  assignedTo: { id: string; name: string } | null
  resolvedBy: { id: string; name: string } | null
  asset: { id: string; assetCode: string; name: string; serialNumber: string | null; status: string } | null
  accessory: { id: string; label: string | null; typeName: string } | null
  kit: { id: string; kitCode: string; name: string } | null
  booking: { id: string; bookingNumber: string; editorName: string; status: string } | null
  /** The inspection that raised it, when a return did. */
  inspection: { id: string; type: string; completedAt: Date | null } | null
  photos: IssuePhotoMeta[]
  maintenance: IssueMaintenanceRow[]
}

export async function getIssueDetail(db: Db, id: string): Promise<IssueDetail | null> {
  const issue = await db.issue.findUnique({
    where: { id },
    select: {
      id: true,
      issueNumber: true,
      type: true,
      severity: true,
      status: true,
      title: true,
      description: true,
      resolution: true,
      reportedAt: true,
      resolvedAt: true,
      closedAt: true,
      reportedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      resolvedBy: { select: { id: true, name: true } },
      asset: { select: { id: true, assetCode: true, name: true, serialNumber: true, status: true } },
      accessory: { select: { id: true, label: true, accessoryType: { select: { name: true } } } },
      kit: { select: { id: true, kitCode: true, name: true } },
      booking: { select: { id: true, bookingNumber: true, status: true, editor: { select: { fullName: true } } } },
      inspection: { select: { id: true, type: true, completedAt: true } },
      attachments: {
        where: { deletedAt: null },
        orderBy: [{ createdAt: 'asc' }],
        select: { id: true, fileName: true, mimeType: true, sizeBytes: true, caption: true, createdAt: true, uploadedBy: { select: { name: true } } },
      },
      maintenanceRecords: {
        where: { deletedAt: null },
        orderBy: [{ createdAt: 'desc' }],
        select: { id: true, maintenanceNumber: true, status: true, title: true, startedAt: true, completedAt: true },
      },
    },
  })
  if (!issue) return null

  return {
    id: issue.id,
    issueNumber: issue.issueNumber,
    type: issue.type,
    severity: issue.severity,
    status: issue.status,
    title: issue.title,
    description: issue.description,
    resolution: issue.resolution,
    reportedAt: issue.reportedAt,
    resolvedAt: issue.resolvedAt,
    closedAt: issue.closedAt,
    reportedBy: issue.reportedBy,
    assignedTo: issue.assignedTo,
    resolvedBy: issue.resolvedBy,
    asset: issue.asset,
    accessory: issue.accessory ? { id: issue.accessory.id, label: issue.accessory.label, typeName: issue.accessory.accessoryType.name } : null,
    kit: issue.kit,
    booking: issue.booking ? { id: issue.booking.id, bookingNumber: issue.booking.bookingNumber, editorName: issue.booking.editor.fullName, status: issue.booking.status } : null,
    inspection: issue.inspection,
    photos: issue.attachments.map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      caption: attachment.caption,
      uploadedByName: attachment.uploadedBy?.name ?? null,
      createdAt: attachment.createdAt,
    })),
    maintenance: issue.maintenanceRecords,
  }
}

/** Quick existence + state read, for the service to validate against. */
export async function getIssueState(db: Db, id: string) {
  return db.issue.findUnique({
    where: { id },
    select: { id: true, issueNumber: true, status: true, severity: true, title: true, assignedToId: true, assetId: true, kitId: true, bookingId: true, resolution: true },
  })
}

// -----------------------------------------------------------------------------
// History and pickers
// -----------------------------------------------------------------------------

export interface IssueActivityEvent {
  id: string
  at: Date
  action: AuditAction
  title: string
  detail: string | null
  actorName: string
}

/** The issue's own audit entries as sentences, newest first. */
export async function getIssueActivity(db: Db, issueId: string, limit = 50): Promise<IssueActivityEvent[]> {
  const audits = await db.auditLog.findMany({
    where: { entityType: 'Issue', entityId: issueId },
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
    select: { id: true, action: true, summary: true, actorName: true, createdAt: true, metadata: true },
  })
  return audits.map((audit) => {
    const detail = audit.metadata && typeof audit.metadata === 'object' && 'detail' in audit.metadata ? String((audit.metadata as { detail?: unknown }).detail ?? '') : ''
    return {
      id: `audit:${audit.id}`,
      at: audit.createdAt,
      action: audit.action,
      title: audit.summary ?? audit.action,
      detail: detail || null,
      actorName: audit.actorName,
    }
  })
}

export interface AssigneeOption {
  id: string
  name: string
  role: string
}

/**
 * Who an issue may be assigned to: active accounts that can actually work one.
 * Roles rather than a permission lookup, because the matrix is a compile-time
 * constant and this is a database query.
 */
export async function listAssignableUsers(db: Db): Promise<AssigneeOption[]> {
  const users = await db.user.findMany({
    where: { deletedAt: null, status: UserStatus.ACTIVE, role: { in: ['ADMIN', 'ENGINEER'] } },
    orderBy: [{ name: 'asc' }],
    select: { id: true, name: true, role: true },
  })
  return users
}

export interface IssueTargetOption {
  id: string
  label: string
  hint: string | null
}

/** Equipment a hand-typed issue can point at: live assets, code first. */
export async function searchIssueAssets(db: Db, term: string, limit = 10): Promise<IssueTargetOption[]> {
  const trimmed = term.trim().slice(0, MAX_SEARCH_LENGTH)
  if (!trimmed) return []
  const contains = { contains: trimmed, mode: 'insensitive' as const }
  const assets = await db.asset.findMany({
    where: { deletedAt: null, OR: [{ assetCode: contains }, { name: contains }, { serialNumber: contains }, { admBarcode: contains }] },
    orderBy: [{ assetCode: 'asc' }],
    take: limit,
    select: { id: true, assetCode: true, name: true, status: true, serialNumber: true },
  })
  return assets.map((asset) => ({
    id: asset.id,
    label: `${asset.assetCode} · ${asset.name}`,
    hint: [asset.status.toLowerCase().replace('_', ' '), asset.serialNumber ? `SN ${asset.serialNumber}` : null].filter(Boolean).join(' · '),
  }))
}

/** Kits a hand-typed issue can point at. */
export async function searchIssueKits(db: Db, term: string, limit = 10): Promise<IssueTargetOption[]> {
  const trimmed = term.trim().slice(0, MAX_SEARCH_LENGTH)
  if (!trimmed) return []
  const contains = { contains: trimmed, mode: 'insensitive' as const }
  const kits = await db.kit.findMany({
    where: { deletedAt: null, OR: [{ kitCode: contains }, { name: contains }, { admBarcode: contains }] },
    orderBy: [{ kitCode: 'asc' }],
    take: limit,
    select: { id: true, kitCode: true, name: true, status: true },
  })
  return kits.map((kit) => ({ id: kit.id, label: `${kit.kitCode} · ${kit.name}`, hint: kit.status.toLowerCase().replace('_', ' ') }))
}
