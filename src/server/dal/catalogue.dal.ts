import 'server-only'

import type { Prisma } from '@prisma/client'

import { clampPage, pageCountFor } from '@/lib/pagination'
import type { Db } from '@/server/db/prisma'

/** Reference data behind the equipment forms and the Categories admin page. */

export interface CategoryRow {
  id: string
  code: string
  name: string
  description: string | null
  icon: string | null
  sortOrder: number
  isActive: boolean
  assetCount: number
  updatedAt: Date
}

const categorySelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  icon: true,
  sortOrder: true,
  isActive: true,
  updatedAt: true,
  _count: { select: { assets: { where: { deletedAt: null } } } },
} satisfies Prisma.EquipmentCategorySelect

type CategoryRecord = Prisma.EquipmentCategoryGetPayload<{ select: typeof categorySelect }>

function toCategoryRow(record: CategoryRecord): CategoryRow {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    description: record.description,
    icon: record.icon,
    sortOrder: record.sortOrder,
    isActive: record.isActive,
    assetCount: record._count.assets,
    updatedAt: record.updatedAt,
  }
}

export async function listCategories(
  db: Db,
  options: { includeInactive?: boolean } = {},
): Promise<CategoryRow[]> {
  const records = await db.equipmentCategory.findMany({
    where: { deletedAt: null, ...(options.includeInactive ? {} : { isActive: true }) },
    select: categorySelect,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
  return records.map(toCategoryRow)
}

export interface CategoryPage {
  rows: CategoryRow[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

/** The Categories admin table: one page at a time, like every other list. */
export async function listCategoriesPage(db: Db, params: { page: number; pageSize: number; includeInactive?: boolean }): Promise<CategoryPage> {
  const where: Prisma.EquipmentCategoryWhereInput = { deletedAt: null, ...(params.includeInactive ? {} : { isActive: true }) }
  const total = await db.equipmentCategory.count({ where })
  const pageCount = pageCountFor(total, params.pageSize)
  const page = clampPage(params.page, pageCount)
  const records = await db.equipmentCategory.findMany({
    where,
    select: categorySelect,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    skip: (page - 1) * params.pageSize,
    take: params.pageSize,
  })
  return { rows: records.map(toCategoryRow), total, page, pageSize: params.pageSize, pageCount }
}

export async function getCategory(db: Db, id: string): Promise<CategoryRow | null> {
  const record = await db.equipmentCategory.findFirst({ where: { id, deletedAt: null }, select: categorySelect })
  return record ? toCategoryRow(record) : null
}

export interface AccessoryTypeOption {
  id: string
  code: string
  name: string
}

export async function listAccessoryTypes(db: Db): Promise<AccessoryTypeOption[]> {
  return db.accessoryType.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
}

// -----------------------------------------------------------------------------
// Software applications and checklist templates (kit configuration pickers)
// -----------------------------------------------------------------------------

export interface SoftwareApplicationOption {
  id: string
  name: string
  vendor: string | null
  version: string | null
}

export async function listSoftwareApplications(db: Db): Promise<SoftwareApplicationOption[]> {
  return db.softwareApplication.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, name: true, vendor: true, version: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
}

export interface ChecklistTemplateOption {
  id: string
  name: string
  description: string | null
  version: number
  isDefault: boolean
  isActive: boolean
  itemCount: number
}

export async function listChecklistTemplates(db: Db): Promise<ChecklistTemplateOption[]> {
  const records = await db.checklistTemplate.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, name: true, description: true, version: true, isDefault: true, isActive: true, _count: { select: { items: true } } },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  })
  return records.map((record) => ({
    id: record.id,
    name: record.name,
    description: record.description,
    version: record.version,
    isDefault: record.isDefault,
    isActive: record.isActive,
    itemCount: record._count.items,
  }))
}

export interface ChecklistTemplateItemRow {
  id: string
  label: string
  description: string | null
  phase: 'HANDOVER' | 'RETURN' | 'BOTH'
  isRequired: boolean
}

export async function listChecklistTemplateItems(db: Db, templateId: string): Promise<ChecklistTemplateItemRow[]> {
  return db.checklistTemplateItem.findMany({
    where: { templateId },
    select: { id: true, label: true, description: true, phase: true, isRequired: true },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  })
}
