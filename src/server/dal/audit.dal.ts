import 'server-only'

import type { AuditAction, Prisma, UserRole } from '@prisma/client'

import { businessDayRange, zonedLocalToDate } from '@/lib/datetime'
import { AUDIT_GROUP_ACTIONS, type AuditEntityType, type AuditListParams } from '@/lib/validation/audit'
import { clampPage, pageCountFor } from '@/lib/pagination'
import type { Db } from '@/server/db/prisma'

/**
 * Audit log reads.
 *
 * The log is append-only: a database trigger refuses every UPDATE and DELETE
 * (see the Phase 1 integrity migration), so this module has no write half and
 * never will. Reading it is the whole feature.
 *
 * Two rules shape what comes out:
 *
 *  - **The select is a whitelist, and the JSON columns are not in it.** A row
 *    carries `previousValue`, `newValue` and `metadata`, which are written by
 *    forty different call sites and can hold anything those call sites put
 *    there. None of them is ever read here, so no amount of future writing can
 *    surface a value the page did not ask for. What the page shows is the
 *    summary sentence the service wrote for a person to read.
 *  - **References are resolved, not guessed.** `entityId` is a cuid, which
 *    tells a reader nothing. Each batch of rows is followed by one query per
 *    entity type present, turning those ids into the numbers people quote:
 *    BK-2026-000001, AST-000004, ISS-2026-000002.
 */

// -----------------------------------------------------------------------------
// Rows
// -----------------------------------------------------------------------------

export interface AuditLogRow {
  id: string
  createdAt: Date
  action: AuditAction
  entityType: string
  entityId: string | null
  /** The name recorded at the time, which survives the account being renamed. */
  actorName: string
  actorRole: UserRole | null
  /** Null for a system action, or an actor whose account has since been removed. */
  actorUserId: string | null
  summary: string | null
  ipAddress: string | null
  userAgent: string | null
  /** The reference people quote, resolved from `entityId` where possible. */
  reference: string | null
  /** Where to read the thing this row is about, when the application has a page for it. */
  href: string | null
}

export interface AuditLogResult {
  rows: AuditLogRow[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

const listSelect = {
  id: true,
  createdAt: true,
  action: true,
  entityType: true,
  entityId: true,
  actorName: true,
  actorRole: true,
  actorUserId: true,
  summary: true,
  ipAddress: true,
  userAgent: true,
  // previousValue, newValue and metadata are deliberately absent.
} satisfies Prisma.AuditLogSelect

// -----------------------------------------------------------------------------
// Filtering
// -----------------------------------------------------------------------------

function searchWhere(term: string): Prisma.AuditLogWhereInput {
  const contains = { contains: term, mode: 'insensitive' } as const
  return {
    OR: [{ summary: contains }, { actorName: contains }, { entityType: contains }, { entityId: term }],
  }
}

/**
 * The window, read in the business time zone: "from 10 September" means that
 * whole local day, and `to` is inclusive to the person typing it - the same
 * half-open convention the reports use, so the two never disagree at a
 * boundary.
 */
function dateWhere(params: AuditListParams, timeZone: string): Prisma.AuditLogWhereInput | null {
  const from = params.from ? zonedLocalToDate(`${params.from}T00:00`, timeZone) : null
  const to = params.to ? zonedLocalToDate(`${params.to}T00:00`, timeZone) : null
  if (!from && !to) return null
  const createdAt: Prisma.DateTimeFilter = {}
  if (from) createdAt.gte = from
  if (to) createdAt.lt = businessDayRange(to, timeZone).end
  return { createdAt }
}

function actionWhere(params: AuditListParams): Prisma.AuditLogWhereInput | null {
  if (params.action) return { action: params.action as AuditAction }
  if (params.group === 'all') return null
  return { action: { in: [...AUDIT_GROUP_ACTIONS[params.group]] as AuditAction[] } }
}

/**
 * Ordering. Sorting by action uses the enum's own order rather than the
 * alphabet, because PostgreSQL orders an enum column by declaration order -
 * which is the useful answer here, since the schema declares related actions
 * together. Every sort falls back to newest-first so the order is total.
 */
function orderBy(params: AuditListParams): Prisma.AuditLogOrderByWithRelationInput[] {
  const direction = params.dir
  switch (params.sort) {
    case 'action':
      return [{ action: direction }, { createdAt: 'desc' }]
    case 'entityType':
      return [{ entityType: direction }, { createdAt: 'desc' }]
    case 'actorName':
      return [{ actorName: direction }, { createdAt: 'desc' }]
    default:
      return [{ createdAt: direction }]
  }
}

function whereFor(params: AuditListParams, timeZone: string): Prisma.AuditLogWhereInput {
  const clauses = [
    params.q ? searchWhere(params.q) : null,
    actionWhere(params),
    params.actorId ? { actorUserId: params.actorId } : null,
    params.entityType ? { entityType: params.entityType } : null,
    dateWhere(params, timeZone),
  ].filter((clause): clause is Prisma.AuditLogWhereInput => clause !== null)

  return clauses.length > 0 ? { AND: clauses } : {}
}

// -----------------------------------------------------------------------------
// Turning ids into the references people quote
// -----------------------------------------------------------------------------

interface Resolved {
  reference: string
  href: string | null
}

type Loader = (db: Db, ids: string[]) => Promise<Map<string, Resolved>>

const LOADERS: Record<AuditEntityType, Loader> = {
  async Booking(db, ids) {
    const rows = await db.booking.findMany({ where: { id: { in: ids } }, select: { id: true, bookingNumber: true } })
    return new Map(rows.map((row) => [row.id, { reference: row.bookingNumber, href: `/bookings/${row.id}` }]))
  },
  async Kit(db, ids) {
    const rows = await db.kit.findMany({ where: { id: { in: ids } }, select: { id: true, kitCode: true, name: true } })
    return new Map(rows.map((row) => [row.id, { reference: `${row.kitCode} · ${row.name}`, href: `/kits/${row.id}` }]))
  },
  async Asset(db, ids) {
    const rows = await db.asset.findMany({ where: { id: { in: ids } }, select: { id: true, assetCode: true, name: true } })
    return new Map(rows.map((row) => [row.id, { reference: `${row.assetCode} · ${row.name}`, href: `/assets/${row.id}` }]))
  },
  async Issue(db, ids) {
    const rows = await db.issue.findMany({ where: { id: { in: ids } }, select: { id: true, issueNumber: true, title: true } })
    return new Map(rows.map((row) => [row.id, { reference: `${row.issueNumber} · ${row.title}`, href: `/issues/${row.id}` }]))
  },
  async EditorProfile(db, ids) {
    const rows = await db.editorProfile.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, staffId: true } })
    return new Map(rows.map((row) => [row.id, { reference: row.staffId ? `${row.fullName} · ${row.staffId}` : row.fullName, href: `/editors/${row.id}` }]))
  },
  async User(db, ids) {
    // The account's name and role, never its email's password or any token.
    const rows = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, role: true } })
    return new Map(rows.map((row) => [row.id, { reference: `${row.name} · ${row.role.toLowerCase()}`, href: null }]))
  },
  async EquipmentCategory(db, ids) {
    const rows = await db.equipmentCategory.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    return new Map(rows.map((row) => [row.id, { reference: row.name, href: '/admin/categories' }]))
  },
}

async function resolveReferences(db: Db, records: readonly { entityType: string; entityId: string | null }[]): Promise<Map<string, Resolved>> {
  const byType = new Map<string, Set<string>>()
  for (const record of records) {
    if (!record.entityId) continue
    if (!(record.entityType in LOADERS)) continue
    const bucket = byType.get(record.entityType) ?? new Set<string>()
    bucket.add(record.entityId)
    byType.set(record.entityType, bucket)
  }

  const resolved = new Map<string, Resolved>()
  await Promise.all(
    [...byType.entries()].map(async ([entityType, ids]) => {
      const found = await LOADERS[entityType as AuditEntityType](db, [...ids])
      for (const [id, value] of found) resolved.set(`${entityType}:${id}`, value)
    }),
  )
  return resolved
}

// -----------------------------------------------------------------------------
// The page
// -----------------------------------------------------------------------------

export async function listAuditLogPage(db: Db, params: AuditListParams, timeZone: string): Promise<AuditLogResult> {
  const where = whereFor(params, timeZone)

  const total = await db.auditLog.count({ where })
  const pageCount = pageCountFor(total, params.pageSize)
  const page = clampPage(params.page, pageCount)
  const records = await db.auditLog.findMany({
    where,
    select: listSelect,
    orderBy: orderBy(params),
    skip: (page - 1) * params.pageSize,
    take: params.pageSize,
  })

  const references = await resolveReferences(db, records)

  return {
    rows: records.map((record) => {
      const resolved = record.entityId ? references.get(`${record.entityType}:${record.entityId}`) : undefined
      return {
        ...record,
        reference: resolved?.reference ?? null,
        href: resolved?.href ?? null,
      }
    }),
    total,
    page,
    pageSize: params.pageSize,
    pageCount,
  }
}

// -----------------------------------------------------------------------------
// Filter options, from the log itself
// -----------------------------------------------------------------------------

export interface AuditActorOption {
  id: string
  name: string
}

/**
 * Who appears in the log, for the actor filter. Taken from the log rather than
 * from the user table, so somebody who has been removed still appears - their
 * actions are still in the record.
 */
export async function listAuditActors(db: Db, limit = 200): Promise<AuditActorOption[]> {
  const groups = await db.auditLog.groupBy({
    by: ['actorUserId', 'actorName'],
    where: { actorUserId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { actorUserId: 'desc' } },
    take: limit,
  })

  const seen = new Set<string>()
  const actors: AuditActorOption[] = []
  for (const group of groups) {
    if (!group.actorUserId || seen.has(group.actorUserId)) continue
    seen.add(group.actorUserId)
    actors.push({ id: group.actorUserId, name: group.actorName })
  }
  return actors.sort((a, b) => a.name.localeCompare(b.name))
}

/** How many rows the whole log holds, and when it starts. */
export async function auditLogSpan(db: Db): Promise<{ total: number; earliest: Date | null; latest: Date | null }> {
  const [total, oldest, newest] = await Promise.all([
    db.auditLog.count(),
    db.auditLog.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    db.auditLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ])
  return { total, earliest: oldest?.createdAt ?? null, latest: newest?.createdAt ?? null }
}
