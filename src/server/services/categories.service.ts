import 'server-only'

import { AuditAction } from '@prisma/client'

import type { CategoryInput } from '@/lib/validation/assets'
import type { Actor } from '@/server/auth/session'
import type { Db } from '@/server/db/prisma'
import { recordAudit } from '@/server/services/audit.service'
import { DomainError, uniqueViolationField } from '@/server/services/errors'

/**
 * Equipment categories. Never hard-deleted: assets reference them forever, so
 * a category is deactivated instead, which only removes it from the pickers.
 */

function codeFromName(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'CATEGORY'
}

function conflictFrom(error: unknown): DomainError | null {
  const field = uniqueViolationField(error)
  if (!field) return null
  const message = field === 'code' ? 'Another category already uses this code.' : 'Another category already uses this name.'
  return new DomainError('conflict', message, { [field === 'code' ? 'code' : 'name']: message })
}

function actorFields(actor: Actor) {
  return { actorUserId: actor.id, actorName: actor.name, actorRole: actor.role }
}

async function inTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  if ('$transaction' in db && typeof db.$transaction === 'function') return db.$transaction((tx) => fn(tx))
  return fn(db)
}

export async function createCategory(db: Db, actor: Actor, input: CategoryInput): Promise<{ id: string }> {
  return inTransaction(db, async (tx) => {
    const code = input.code ?? codeFromName(input.name)
    let category: { id: string; name: string; code: string }
    try {
      category = await tx.equipmentCategory.create({
        data: {
          code,
          name: input.name,
          description: input.description ?? null,
          icon: input.icon ?? null,
          sortOrder: input.sortOrder,
        },
        select: { id: true, name: true, code: true },
      })
    } catch (error) {
      throw conflictFrom(error) ?? error
    }

    await recordAudit(tx, {
      action: AuditAction.CREATE,
      entityType: 'EquipmentCategory',
      entityId: category.id,
      ...actorFields(actor),
      summary: `Category ${category.name} (${category.code}) created`,
      newValue: { code, name: input.name, sortOrder: input.sortOrder },
    })
    return { id: category.id }
  })
}

export async function updateCategory(db: Db, actor: Actor, id: string, input: CategoryInput): Promise<{ id: string }> {
  return inTransaction(db, async (tx) => {
    const current = await tx.equipmentCategory.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, code: true, name: true, description: true, icon: true, sortOrder: true },
    })
    if (!current) throw new DomainError('not_found', 'Category not found.')

    const next = {
      code: input.code ?? current.code,
      name: input.name,
      description: input.description ?? null,
      icon: input.icon ?? null,
      sortOrder: input.sortOrder,
    }

    try {
      await tx.equipmentCategory.update({ where: { id }, data: next })
    } catch (error) {
      throw conflictFrom(error) ?? error
    }

    await recordAudit(tx, {
      action: AuditAction.UPDATE,
      entityType: 'EquipmentCategory',
      entityId: id,
      ...actorFields(actor),
      summary: `Category ${next.name} (${next.code}) updated`,
      previousValue: { code: current.code, name: current.name, description: current.description, sortOrder: current.sortOrder },
      newValue: { code: next.code, name: next.name, description: next.description, sortOrder: next.sortOrder },
    })
    return { id }
  })
}

export async function setCategoryActive(db: Db, actor: Actor, id: string, isActive: boolean): Promise<{ id: string; isActive: boolean }> {
  return inTransaction(db, async (tx) => {
    const current = await tx.equipmentCategory.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, code: true, name: true, isActive: true },
    })
    if (!current) throw new DomainError('not_found', 'Category not found.')
    if (current.isActive === isActive) return { id, isActive }

    await tx.equipmentCategory.update({ where: { id }, data: { isActive } })
    await recordAudit(tx, {
      action: AuditAction.UPDATE,
      entityType: 'EquipmentCategory',
      entityId: id,
      ...actorFields(actor),
      summary: `Category ${current.name} ${isActive ? 'activated' : 'deactivated'}`,
      previousValue: { isActive: current.isActive },
      newValue: { isActive },
    })
    return { id, isActive }
  })
}
