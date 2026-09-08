import 'server-only'

import { type ChecklistPhase, type Prisma, type UserRole, UserStatus } from '@prisma/client'

import type { UserFilter, UserListParams } from '@/lib/validation/admin'
import { clampPage, pageCountFor } from '@/lib/pagination'
import type { Db } from '@/server/db/prisma'

/**
 * Administration reads: accounts, the software catalogue, checklist templates
 * and the stored settings.
 *
 * The account select is the careful one. A `User` row carries `passwordHash`
 * and `sessionVersion`, and neither is ever selected here - not truncated, not
 * masked, not selected. What the page needs is who the account belongs to,
 * what they may do, whether they can sign in, and when they last did.
 */

// -----------------------------------------------------------------------------
// Accounts
// -----------------------------------------------------------------------------

export interface UserRow {
  id: string
  email: string
  name: string
  role: UserRole
  status: UserStatus
  staffId: string | null
  phone: string | null
  /** Whether a local password exists at all - never the hash itself. */
  hasPassword: boolean
  mustChangePassword: boolean
  failedLoginAttempts: number
  lockedUntil: Date | null
  lastLoginAt: Date | null
  createdAt: Date
  /** The profiles this account is linked to, which explain what it is for. */
  editorProfileId: string | null
  editorName: string | null
  engineerProfileId: string | null
  engineerName: string | null
}

export interface UserListResult {
  rows: UserRow[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  staffId: true,
  phone: true,
  passwordHash: true,
  mustChangePassword: true,
  failedLoginAttempts: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  editorProfile: { select: { id: true, fullName: true } },
  engineerProfile: { select: { id: true, fullName: true } },
  // sessionVersion is not selected: it is an internal revocation counter.
} satisfies Prisma.UserSelect

type UserRecord = Prisma.UserGetPayload<{ select: typeof userSelect }>

/** The hash never leaves this function - only the fact that one exists. */
function toUserRow(record: UserRecord): UserRow {
  return {
    id: record.id,
    email: record.email,
    name: record.name,
    role: record.role,
    status: record.status,
    staffId: record.staffId,
    phone: record.phone,
    hasPassword: record.passwordHash !== null,
    mustChangePassword: record.mustChangePassword,
    failedLoginAttempts: record.failedLoginAttempts,
    lockedUntil: record.lockedUntil,
    lastLoginAt: record.lastLoginAt,
    createdAt: record.createdAt,
    editorProfileId: record.editorProfile?.id ?? null,
    editorName: record.editorProfile?.fullName ?? null,
    engineerProfileId: record.engineerProfile?.id ?? null,
    engineerName: record.engineerProfile?.fullName ?? null,
  }
}

function userFilterWhere(filter: UserFilter, now: Date): Prisma.UserWhereInput | null {
  switch (filter) {
    case 'active':
      return { status: UserStatus.ACTIVE }
    case 'suspended':
      return { status: { in: [UserStatus.SUSPENDED, UserStatus.DISABLED] } }
    case 'locked':
      return { lockedUntil: { gt: now } }
    case 'never-signed-in':
      return { lastLoginAt: null }
    default:
      return null
  }
}

function userOrderBy(params: UserListParams): Prisma.UserOrderByWithRelationInput[] {
  const direction = params.dir
  switch (params.sort) {
    case 'email':
      return [{ email: direction }]
    case 'role':
      return [{ role: direction }, { name: 'asc' }]
    case 'status':
      return [{ status: direction }, { name: 'asc' }]
    case 'lastLoginAt':
      // Accounts that have never signed in sort last either way, which is
      // where somebody scanning for stale invitations expects them.
      return [{ lastLoginAt: { sort: direction, nulls: 'last' } }, { name: 'asc' }]
    default:
      return [{ name: direction }]
  }
}

export async function listUsersPage(db: Db, params: UserListParams, now: Date): Promise<UserListResult> {
  const clauses = [
    { deletedAt: null },
    userFilterWhere(params.filter, now),
    params.role ? { role: params.role as UserRole } : null,
    params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: 'insensitive' as const } },
            { email: { contains: params.q, mode: 'insensitive' as const } },
            { staffId: { contains: params.q, mode: 'insensitive' as const } },
          ],
        }
      : null,
  ].filter((clause): clause is Prisma.UserWhereInput => clause !== null)

  const where: Prisma.UserWhereInput = { AND: clauses }

  const total = await db.user.count({ where })
  const pageCount = pageCountFor(total, params.pageSize)
  const page = clampPage(params.page, pageCount)
  const records = await db.user.findMany({ where, select: userSelect, orderBy: userOrderBy(params), skip: (page - 1) * params.pageSize, take: params.pageSize })

  return { rows: records.map(toUserRow), total, page, pageSize: params.pageSize, pageCount }
}

export async function countUsersByFilter(db: Db, now: Date): Promise<Record<UserFilter, number>> {
  const [all, active, suspended, locked, never] = await Promise.all([
    db.user.count({ where: { deletedAt: null } }),
    db.user.count({ where: { deletedAt: null, status: UserStatus.ACTIVE } }),
    db.user.count({ where: { deletedAt: null, status: { in: [UserStatus.SUSPENDED, UserStatus.DISABLED] } } }),
    db.user.count({ where: { deletedAt: null, lockedUntil: { gt: now } } }),
    db.user.count({ where: { deletedAt: null, lastLoginAt: null } }),
  ])
  return { all, active, suspended, locked, 'never-signed-in': never }
}

export async function getUserForAdmin(db: Db, id: string): Promise<UserRow | null> {
  const record = await db.user.findFirst({ where: { id, deletedAt: null }, select: userSelect })
  return record ? toUserRow(record) : null
}

// -----------------------------------------------------------------------------
// Software catalogue
// -----------------------------------------------------------------------------

export interface SoftwareRow {
  id: string
  name: string
  vendor: string | null
  version: string | null
  licenseType: string | null
  notes: string | null
  sortOrder: number
  isActive: boolean
  updatedAt: Date
  /** How many kits expect this application, and how many of those require it. */
  kitCount: number
  requiredKitCount: number
}

export async function listSoftware(db: Db, options: { includeInactive?: boolean } = {}): Promise<SoftwareRow[]> {
  const records = await db.softwareApplication.findMany({
    where: { deletedAt: null, ...(options.includeInactive ? {} : { isActive: true }) },
    select: {
      id: true,
      name: true,
      vendor: true,
      version: true,
      licenseType: true,
      notes: true,
      sortOrder: true,
      isActive: true,
      updatedAt: true,
      kitSoftware: { select: { isRequired: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })

  return records.map((record) => ({
    id: record.id,
    name: record.name,
    vendor: record.vendor,
    version: record.version,
    licenseType: record.licenseType,
    notes: record.notes,
    sortOrder: record.sortOrder,
    isActive: record.isActive,
    updatedAt: record.updatedAt,
    kitCount: record.kitSoftware.length,
    requiredKitCount: record.kitSoftware.filter((link) => link.isRequired).length,
  }))
}

export async function getSoftware(db: Db, id: string): Promise<SoftwareRow | null> {
  const rows = await listSoftware(db, { includeInactive: true })
  return rows.find((row) => row.id === id) ?? null
}

export interface PagedRows<Row> {
  rows: Row[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

export interface ReferencePageParams {
  page: number
  pageSize: number
  includeInactive?: boolean
}

/** The Software admin table, one page at a time. */
export async function listSoftwarePage(db: Db, params: ReferencePageParams): Promise<PagedRows<SoftwareRow>> {
  const where: Prisma.SoftwareApplicationWhereInput = { deletedAt: null, ...(params.includeInactive ? {} : { isActive: true }) }
  const total = await db.softwareApplication.count({ where })
  const pageCount = pageCountFor(total, params.pageSize)
  const page = clampPage(params.page, pageCount)
  const records = await db.softwareApplication.findMany({
    where,
    select: {
      id: true,
      name: true,
      vendor: true,
      version: true,
      licenseType: true,
      notes: true,
      sortOrder: true,
      isActive: true,
      updatedAt: true,
      kitSoftware: { select: { isRequired: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    skip: (page - 1) * params.pageSize,
    take: params.pageSize,
  })
  const rows = records.map((record) => ({
    id: record.id,
    name: record.name,
    vendor: record.vendor,
    version: record.version,
    licenseType: record.licenseType,
    notes: record.notes,
    sortOrder: record.sortOrder,
    isActive: record.isActive,
    updatedAt: record.updatedAt,
    kitCount: record.kitSoftware.length,
    requiredKitCount: record.kitSoftware.filter((link) => link.isRequired).length,
  }))
  return { rows, total, page, pageSize: params.pageSize, pageCount }
}

// -----------------------------------------------------------------------------
// Checklist templates
// -----------------------------------------------------------------------------

export interface ChecklistItemRow {
  id: string
  label: string
  description: string | null
  phase: ChecklistPhase
  isRequired: boolean
  sortOrder: number
  /** How many bookings have copied this item; a copied item is history. */
  usedByBookings: number
}

export interface ChecklistTemplateRow {
  id: string
  name: string
  description: string | null
  version: number
  isDefault: boolean
  isActive: boolean
  updatedAt: Date
  itemCount: number
  handoverCount: number
  returnCount: number
  requiredCount: number
  kitCount: number
  bookingCount: number
}

export async function listChecklistTemplates(db: Db, options: { includeInactive?: boolean } = {}): Promise<ChecklistTemplateRow[]> {
  const records = await db.checklistTemplate.findMany({
    where: { deletedAt: null, ...(options.includeInactive ? {} : { isActive: true }) },
    select: {
      id: true,
      name: true,
      description: true,
      version: true,
      isDefault: true,
      isActive: true,
      updatedAt: true,
      items: { select: { phase: true, isRequired: true } },
      _count: { select: { kits: true, bookings: true } },
    },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  })

  return records.map((record) => ({
    id: record.id,
    name: record.name,
    description: record.description,
    version: record.version,
    isDefault: record.isDefault,
    isActive: record.isActive,
    updatedAt: record.updatedAt,
    itemCount: record.items.length,
    handoverCount: record.items.filter((item) => item.phase === 'HANDOVER' || item.phase === 'BOTH').length,
    returnCount: record.items.filter((item) => item.phase === 'RETURN' || item.phase === 'BOTH').length,
    requiredCount: record.items.filter((item) => item.isRequired).length,
    kitCount: record._count.kits,
    bookingCount: record._count.bookings,
  }))
}

/** The Checklist Templates admin table, one page at a time. */
export async function listChecklistTemplatesPage(db: Db, params: ReferencePageParams): Promise<PagedRows<ChecklistTemplateRow>> {
  const where: Prisma.ChecklistTemplateWhereInput = { deletedAt: null, ...(params.includeInactive ? {} : { isActive: true }) }
  const total = await db.checklistTemplate.count({ where })
  const pageCount = pageCountFor(total, params.pageSize)
  const page = clampPage(params.page, pageCount)
  const records = await db.checklistTemplate.findMany({
    where,
    select: {
      id: true,
      name: true,
      description: true,
      version: true,
      isDefault: true,
      isActive: true,
      updatedAt: true,
      items: { select: { phase: true, isRequired: true } },
      _count: { select: { kits: true, bookings: true } },
    },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    skip: (page - 1) * params.pageSize,
    take: params.pageSize,
  })
  const rows = records.map((record) => ({
    id: record.id,
    name: record.name,
    description: record.description,
    version: record.version,
    isDefault: record.isDefault,
    isActive: record.isActive,
    updatedAt: record.updatedAt,
    itemCount: record.items.length,
    handoverCount: record.items.filter((item) => item.phase === 'HANDOVER' || item.phase === 'BOTH').length,
    returnCount: record.items.filter((item) => item.phase === 'RETURN' || item.phase === 'BOTH').length,
    requiredCount: record.items.filter((item) => item.isRequired).length,
    kitCount: record._count.kits,
    bookingCount: record._count.bookings,
  }))
  return { rows, total, page, pageSize: params.pageSize, pageCount }
}

export interface ChecklistTemplateDetail extends ChecklistTemplateRow {
  items: ChecklistItemRow[]
}

export async function getChecklistTemplate(db: Db, id: string): Promise<ChecklistTemplateDetail | null> {
  const record = await db.checklistTemplate.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      description: true,
      version: true,
      isDefault: true,
      isActive: true,
      updatedAt: true,
      _count: { select: { kits: true, bookings: true } },
      items: {
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
        select: {
          id: true,
          label: true,
          description: true,
          phase: true,
          isRequired: true,
          sortOrder: true,
          _count: { select: { bookingItems: true } },
        },
      },
    },
  })
  if (!record) return null

  const items: ChecklistItemRow[] = record.items.map((item) => ({
    id: item.id,
    label: item.label,
    description: item.description,
    phase: item.phase,
    isRequired: item.isRequired,
    sortOrder: item.sortOrder,
    usedByBookings: item._count.bookingItems,
  }))

  return {
    id: record.id,
    name: record.name,
    description: record.description,
    version: record.version,
    isDefault: record.isDefault,
    isActive: record.isActive,
    updatedAt: record.updatedAt,
    itemCount: items.length,
    handoverCount: items.filter((item) => item.phase === 'HANDOVER' || item.phase === 'BOTH').length,
    returnCount: items.filter((item) => item.phase === 'RETURN' || item.phase === 'BOTH').length,
    requiredCount: items.filter((item) => item.isRequired).length,
    kitCount: record._count.kits,
    bookingCount: record._count.bookings,
    items,
  }
}

// -----------------------------------------------------------------------------
// Stored settings
// -----------------------------------------------------------------------------

export interface SettingRow {
  key: string
  category: string
  value: unknown
  description: string | null
  updatedAt: Date
  updatedByName: string | null
}

export async function listSettings(db: Db): Promise<SettingRow[]> {
  const records = await db.appSetting.findMany({
    select: { key: true, category: true, value: true, description: true, updatedAt: true, updatedBy: { select: { name: true } } },
    orderBy: [{ category: 'asc' }, { key: 'asc' }],
  })
  return records.map((record) => ({
    key: record.key,
    category: record.category,
    value: record.value,
    description: record.description,
    updatedAt: record.updatedAt,
    updatedByName: record.updatedBy?.name ?? null,
  }))
}
