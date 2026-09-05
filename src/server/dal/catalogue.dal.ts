import 'server-only'

import type { Prisma } from '@prisma/client'

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
