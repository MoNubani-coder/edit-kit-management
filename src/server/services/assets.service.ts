import 'server-only'

import { AssetStatus, AuditAction, NumberScope, type Prisma } from '@prisma/client'

import type { AccessoryInput, CreateAssetInput, UpdateAssetInput } from '@/lib/validation/assets'
import { can } from '@/server/auth/permissions'
import { type Actor, requirePermission } from '@/server/auth/session'
import {
  type AssetDetail,
  type AssetHistoryEvent,
  type AssetLifecycleContext,
  type AssetListQuery,
  type AssetListResult,
  countAssetsByStatus,
  findAssetIdByBarcode,
  getAccessory,
  getAssetDetail,
  getAssetHistory,
  getAssetLifecycleContext,
  listAssets,
} from '@/server/dal/assets.dal'
import { type CategoryRow, listAccessoryTypes, listCategories } from '@/server/dal/catalogue.dal'
import { prisma, type Db } from '@/server/db/prisma'
import { recordAudit } from '@/server/services/audit.service'
import { DomainError, uniqueViolationField } from '@/server/services/errors'
import { nextNumber } from '@/server/services/numbering.service'

/**
 * Equipment business rules.
 *
 * Every mutation runs in one transaction: the row, its status-log entry and
 * its audit entry commit or roll back together, and the AST-NNNNNN number is
 * only consumed when the insert succeeds (AD-1). Services receive an already
 * authorised `Actor`; the Server Actions (assets.actions.ts) do the
 * authorising and never call Prisma themselves.
 */

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

/** Statuses owned by workflows - bookings, handover, return, maintenance. */
const WORKFLOW_STATUSES: readonly AssetStatus[] = [AssetStatus.RESERVED, AssetStatus.CHECKED_OUT, AssetStatus.MAINTENANCE]

const MANUAL_STATUSES: readonly AssetStatus[] = [
  AssetStatus.AVAILABLE,
  AssetStatus.DAMAGED,
  AssetStatus.MISSING,
  AssetStatus.RETIRED,
]

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  CHECKED_OUT: 'Checked out',
  MAINTENANCE: 'Maintenance',
  DAMAGED: 'Damaged',
  MISSING: 'Missing',
  RETIRED: 'Retired',
}

/**
 * The statuses a person may move an asset to from `current`, given the facts.
 * The current status is always included (no change).
 *
 *  - RESERVED / CHECKED_OUT belong to bookings and inspections: no manual exit.
 *  - MAINTENANCE belongs to maintenance records: while a record is IN_PROGRESS
 *    or ON_HOLD the asset stays put; a stale flag with no active record may be
 *    cleared back to AVAILABLE or DAMAGED.
 *  - An asset with active maintenance is never AVAILABLE.
 *  - An asset still in a kit cannot be RETIRED; remove it from the kit first.
 */
export function allowedStatusTransitions(current: AssetStatus, context: Omit<AssetLifecycleContext, 'status' | 'deleted'>): AssetStatus[] {
  if (current === AssetStatus.RESERVED || current === AssetStatus.CHECKED_OUT) return [current]

  if (current === AssetStatus.MAINTENANCE) {
    return context.hasActiveMaintenance ? [current] : [AssetStatus.MAINTENANCE, AssetStatus.AVAILABLE, AssetStatus.DAMAGED]
  }

  const targets = new Set<AssetStatus>([current, ...MANUAL_STATUSES])
  if (context.hasActiveMaintenance) targets.delete(AssetStatus.AVAILABLE)
  if (context.inKit) targets.delete(AssetStatus.RETIRED)
  return [...targets]
}

export function assertStatusTransition(
  current: AssetStatus,
  next: AssetStatus,
  context: Omit<AssetLifecycleContext, 'status' | 'deleted'>,
): void {
  if (allowedStatusTransitions(current, context).includes(next)) return

  let reason = `Equipment cannot be moved from ${ASSET_STATUS_LABEL[current]} to ${ASSET_STATUS_LABEL[next]} by hand.`
  if (WORKFLOW_STATUSES.includes(next)) reason = `${ASSET_STATUS_LABEL[next]} is set by the booking, handover or maintenance workflow, not by editing.`
  else if (next === AssetStatus.AVAILABLE && context.hasActiveMaintenance)
    reason = 'Equipment with maintenance in progress or on hold cannot be made available. Complete or cancel the maintenance first.'
  else if (next === AssetStatus.RETIRED && context.inKit) reason = 'Remove the equipment from its kit before retiring it.'
  else if (current === AssetStatus.RESERVED || current === AssetStatus.CHECKED_OUT)
    reason = `Equipment that is ${ASSET_STATUS_LABEL[current].toLowerCase()} is controlled by its booking; use the return workflow.`

  throw new DomainError('lifecycle', reason, { status: reason })
}

/** Whether an asset may leave the inventory (soft delete). */
export function removalBlocker(context: AssetLifecycleContext): string | null {
  if (context.deleted) return 'This equipment has already been removed.'
  if (context.inKit) return 'Remove the equipment from its kit before removing it from the inventory.'
  if (context.status === AssetStatus.RESERVED || context.status === AssetStatus.CHECKED_OUT)
    return 'Equipment that is reserved or checked out cannot be removed.'
  if (context.hasActiveMaintenance) return 'Complete or cancel the active maintenance first.'
  return null
}

/** True when the asset can be handed over or booked right now. */
export function isAvailableForUse(context: Pick<AssetLifecycleContext, 'status' | 'deleted' | 'hasActiveMaintenance'>): boolean {
  return !context.deleted && context.status === AssetStatus.AVAILABLE && !context.hasActiveMaintenance
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Runs `fn` in a transaction, or inline when `db` already is one. */
async function inTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  if ('$transaction' in db && typeof db.$transaction === 'function') {
    return db.$transaction((tx) => fn(tx))
  }
  return fn(db)
}

function conflictFrom(error: unknown, labels: Record<string, string>): DomainError | null {
  const field = uniqueViolationField(error)
  if (!field) return null
  const label = labels[field] ?? 'This value'
  const message = `${label} is already used by other equipment.`
  return new DomainError('conflict', message, { [field]: message })
}

const ASSET_UNIQUE_LABELS = { serialNumber: 'This serial number', admBarcode: 'This ADM barcode', assetCode: 'This asset code' }
const ACCESSORY_UNIQUE_LABELS = { admBarcode: 'This ADM barcode' }

function actorFields(actor: Actor) {
  return { actorUserId: actor.id, actorName: actor.name, actorRole: actor.role }
}

async function requireActiveCategory(db: Db, categoryId: string): Promise<{ id: string; name: string }> {
  const category = await db.equipmentCategory.findFirst({
    where: { id: categoryId, deletedAt: null },
    select: { id: true, name: true, isActive: true },
  })
  if (!category || !category.isActive) {
    throw new DomainError('validation', 'Choose an active category.', { categoryId: 'Choose an active category.' })
  }
  return category
}

const nullIfEmpty = (value: string | undefined): string | null => value ?? null

// -----------------------------------------------------------------------------
// Equipment mutations
// -----------------------------------------------------------------------------

export async function createAsset(db: Db, actor: Actor, input: CreateAssetInput): Promise<{ id: string; assetCode: string }> {
  return inTransaction(db, async (tx) => {
    const category = await requireActiveCategory(tx, input.categoryId)
    const assetCode = await nextNumber(tx, NumberScope.ASSET)

    let asset: { id: string; assetCode: string; name: string }
    try {
      asset = await tx.asset.create({
        data: {
          assetCode,
          name: input.name,
          categoryId: category.id,
          manufacturer: nullIfEmpty(input.manufacturer),
          model: nullIfEmpty(input.model),
          serialNumber: nullIfEmpty(input.serialNumber),
          admBarcode: nullIfEmpty(input.admBarcode),
          location: nullIfEmpty(input.location),
          notes: nullIfEmpty(input.notes),
          status: input.status,
        },
        select: { id: true, assetCode: true, name: true },
      })
    } catch (error) {
      throw conflictFrom(error, ASSET_UNIQUE_LABELS) ?? error
    }

    await tx.assetStatusLog.create({
      data: { assetId: asset.id, fromStatus: null, toStatus: input.status, reason: 'Added to inventory', changedById: actor.id },
    })

    await recordAudit(tx, {
      action: AuditAction.CREATE,
      entityType: 'Asset',
      entityId: asset.id,
      ...actorFields(actor),
      summary: `${asset.assetCode} ${asset.name} added to inventory`,
      newValue: {
        assetCode: asset.assetCode,
        name: input.name,
        category: category.name,
        manufacturer: input.manufacturer ?? null,
        model: input.model ?? null,
        serialNumber: input.serialNumber ?? null,
        admBarcode: input.admBarcode ?? null,
        status: input.status,
      },
    })

    return { id: asset.id, assetCode: asset.assetCode }
  })
}

const EDITABLE_FIELDS = ['name', 'categoryId', 'manufacturer', 'model', 'serialNumber', 'admBarcode', 'location', 'notes', 'status'] as const

export async function updateAsset(
  db: Db,
  actor: Actor,
  id: string,
  input: UpdateAssetInput,
): Promise<{ id: string; assetCode: string; statusChanged: boolean }> {
  return inTransaction(db, async (tx) => {
    const current = await tx.asset.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        assetCode: true,
        name: true,
        categoryId: true,
        manufacturer: true,
        model: true,
        serialNumber: true,
        admBarcode: true,
        location: true,
        notes: true,
        status: true,
      },
    })
    if (!current) throw new DomainError('not_found', 'Equipment not found.')

    const context = await getAssetLifecycleContext(tx, id)
    if (!context) throw new DomainError('not_found', 'Equipment not found.')

    if (input.status !== current.status) assertStatusTransition(current.status, input.status, context)
    if (input.categoryId !== current.categoryId) await requireActiveCategory(tx, input.categoryId)

    const next = {
      name: input.name,
      categoryId: input.categoryId,
      manufacturer: nullIfEmpty(input.manufacturer),
      model: nullIfEmpty(input.model),
      serialNumber: nullIfEmpty(input.serialNumber),
      admBarcode: nullIfEmpty(input.admBarcode),
      location: nullIfEmpty(input.location),
      notes: nullIfEmpty(input.notes),
      status: input.status,
    }

    const changed = EDITABLE_FIELDS.filter((field) => current[field] !== next[field])
    if (changed.length === 0) return { id, assetCode: current.assetCode, statusChanged: false }

    try {
      await tx.asset.update({ where: { id }, data: next })
    } catch (error) {
      throw conflictFrom(error, ASSET_UNIQUE_LABELS) ?? error
    }

    const statusChanged = current.status !== input.status
    if (statusChanged) {
      await tx.assetStatusLog.create({
        data: {
          assetId: id,
          fromStatus: current.status,
          toStatus: input.status,
          reason: nullIfEmpty(input.statusReason),
          changedById: actor.id,
        },
      })
      await recordAudit(tx, {
        action: AuditAction.ASSET_STATUS_CHANGED,
        entityType: 'Asset',
        entityId: id,
        ...actorFields(actor),
        summary: `${current.assetCode} status changed ${ASSET_STATUS_LABEL[current.status]} → ${ASSET_STATUS_LABEL[input.status]}`,
        previousValue: { status: current.status },
        newValue: { status: input.status, reason: input.statusReason ?? null },
      })
    }

    const detailFields = changed.filter((field) => field !== 'status')
    if (detailFields.length > 0) {
      const pick = (source: typeof next | typeof current) =>
        Object.fromEntries(detailFields.map((field) => [field, source[field]])) as Prisma.InputJsonObject
      await recordAudit(tx, {
        action: AuditAction.UPDATE,
        entityType: 'Asset',
        entityId: id,
        ...actorFields(actor),
        summary: `${current.assetCode} details updated (${detailFields.join(', ')})`,
        previousValue: pick(current),
        newValue: pick(next),
      })
    }

    return { id, assetCode: current.assetCode, statusChanged }
  })
}

export async function removeAsset(db: Db, actor: Actor, id: string): Promise<void> {
  await inTransaction(db, async (tx) => {
    const asset = await tx.asset.findUnique({ where: { id }, select: { id: true, assetCode: true, name: true } })
    if (!asset) throw new DomainError('not_found', 'Equipment not found.')

    const context = await getAssetLifecycleContext(tx, id)
    const blocker = context ? removalBlocker(context) : 'Equipment not found.'
    if (blocker) throw new DomainError('lifecycle', blocker)

    await tx.asset.update({ where: { id }, data: { deletedAt: new Date() } })
    await recordAudit(tx, {
      action: AuditAction.DELETE,
      entityType: 'Asset',
      entityId: id,
      ...actorFields(actor),
      summary: `${asset.assetCode} ${asset.name} removed from inventory`,
    })
  })
}

// -----------------------------------------------------------------------------
// Accessories (AccessoryType is the vocabulary; rows are soft-deleted so
// historical inspection lines keep resolving)
// -----------------------------------------------------------------------------

async function requireAccessoryType(db: Db, accessoryTypeId: string): Promise<{ id: string; name: string }> {
  const type = await db.accessoryType.findFirst({
    where: { id: accessoryTypeId, deletedAt: null },
    select: { id: true, name: true, isActive: true },
  })
  if (!type || !type.isActive) {
    throw new DomainError('validation', 'Choose an active accessory type.', { accessoryTypeId: 'Choose an active accessory type.' })
  }
  return type
}

function accessoryLabel(typeName: string, label: string | null | undefined): string {
  return label ? `${typeName} (${label})` : typeName
}

export async function addAccessory(db: Db, actor: Actor, assetId: string, input: AccessoryInput): Promise<{ id: string }> {
  return inTransaction(db, async (tx) => {
    const asset = await tx.asset.findFirst({ where: { id: assetId, deletedAt: null }, select: { id: true, assetCode: true } })
    if (!asset) throw new DomainError('not_found', 'Equipment not found.')
    const type = await requireAccessoryType(tx, input.accessoryTypeId)
    const sortOrder = await tx.accessory.count({ where: { assetId, deletedAt: null } })

    let accessory: { id: string }
    try {
      accessory = await tx.accessory.create({
        data: {
          assetId,
          accessoryTypeId: type.id,
          label: nullIfEmpty(input.label),
          quantity: input.quantity,
          serialNumber: nullIfEmpty(input.serialNumber),
          admBarcode: nullIfEmpty(input.admBarcode),
          isRequired: input.isRequired,
          notes: nullIfEmpty(input.notes),
          sortOrder,
        },
        select: { id: true },
      })
    } catch (error) {
      throw conflictFrom(error, ACCESSORY_UNIQUE_LABELS) ?? error
    }

    await recordAudit(tx, {
      action: AuditAction.CREATE,
      entityType: 'Asset',
      entityId: assetId,
      ...actorFields(actor),
      summary: `Accessory added to ${asset.assetCode}: ${accessoryLabel(type.name, input.label)}`,
      newValue: { accessoryId: accessory.id, type: type.name, label: input.label ?? null, quantity: input.quantity },
    })

    return accessory
  })
}

export async function updateAccessory(db: Db, actor: Actor, accessoryId: string, input: AccessoryInput): Promise<{ id: string; assetId: string }> {
  return inTransaction(db, async (tx) => {
    const current = await getAccessory(tx, accessoryId)
    if (!current) throw new DomainError('not_found', 'Accessory not found.')
    const type = await requireAccessoryType(tx, input.accessoryTypeId)
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: current.assetId }, select: { assetCode: true } })

    try {
      await tx.accessory.update({
        where: { id: accessoryId },
        data: {
          accessoryTypeId: type.id,
          label: nullIfEmpty(input.label),
          quantity: input.quantity,
          serialNumber: nullIfEmpty(input.serialNumber),
          admBarcode: nullIfEmpty(input.admBarcode),
          isRequired: input.isRequired,
          notes: nullIfEmpty(input.notes),
        },
      })
    } catch (error) {
      throw conflictFrom(error, ACCESSORY_UNIQUE_LABELS) ?? error
    }

    await recordAudit(tx, {
      action: AuditAction.UPDATE,
      entityType: 'Asset',
      entityId: current.assetId,
      ...actorFields(actor),
      summary: `Accessory updated on ${asset.assetCode}: ${accessoryLabel(type.name, input.label)}`,
      previousValue: { type: current.accessoryType.name, label: current.label, quantity: current.quantity, isRequired: current.isRequired },
      newValue: { type: type.name, label: input.label ?? null, quantity: input.quantity, isRequired: input.isRequired },
    })

    return { id: accessoryId, assetId: current.assetId }
  })
}

export async function removeAccessory(db: Db, actor: Actor, accessoryId: string): Promise<{ assetId: string }> {
  return inTransaction(db, async (tx) => {
    const current = await getAccessory(tx, accessoryId)
    if (!current) throw new DomainError('not_found', 'Accessory not found.')
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: current.assetId }, select: { assetCode: true } })

    // Soft delete: AccessoryInspection rows from past handovers keep their reference.
    await tx.accessory.update({ where: { id: accessoryId }, data: { deletedAt: new Date() } })
    await recordAudit(tx, {
      action: AuditAction.DELETE,
      entityType: 'Asset',
      entityId: current.assetId,
      ...actorFields(actor),
      summary: `Accessory removed from ${asset.assetCode}: ${accessoryLabel(current.accessoryType.name, current.label)}`,
    })

    return { assetId: current.assetId }
  })
}

// -----------------------------------------------------------------------------
// Page loaders (authorise, then read)
// -----------------------------------------------------------------------------

export interface EquipmentListPage {
  actor: Actor
  result: AssetListResult
  statusCounts: Record<AssetStatus, number>
  categories: CategoryRow[]
  /** Set when the search term is exactly one asset's or accessory's barcode. */
  scannedAssetId: string | null
}

export async function loadEquipmentList(query: AssetListQuery): Promise<EquipmentListPage> {
  const actor = await requirePermission('asset.read')
  const [result, statusCounts, categories, scannedAssetId] = await Promise.all([
    listAssets(prisma, query),
    countAssetsByStatus(prisma),
    listCategories(prisma, { includeInactive: false }),
    query.search ? findAssetIdByBarcode(prisma, query.search) : Promise.resolve(null),
  ])
  return { actor, result, statusCounts, categories, scannedAssetId }
}

export interface AssetWorkspace {
  actor: Actor
  asset: AssetDetail
  history: AssetHistoryEvent[]
  lifecycle: AssetLifecycleContext
  /** Statuses the actor may move the asset to; empty without asset.manage. */
  allowedStatuses: AssetStatus[]
  canManage: boolean
  removalBlocker: string | null
  availableForUse: boolean
}

export async function loadAssetWorkspace(db: Db, actor: Actor, id: string): Promise<AssetWorkspace | null> {
  const includeMaintenance = can(actor, 'maintenance.read')
  const includeIssues = can(actor, 'issue.read')

  const [asset, history, lifecycle] = await Promise.all([
    getAssetDetail(db, id, { includeMaintenance, includeIssues }),
    getAssetHistory(db, id, { includeIssues, includeMaintenance }),
    getAssetLifecycleContext(db, id),
  ])
  if (!asset || !lifecycle) return null

  const canManage = can(actor, 'asset.manage')
  return {
    actor,
    asset,
    history,
    lifecycle,
    allowedStatuses: canManage && !lifecycle.deleted ? allowedStatusTransitions(asset.status, lifecycle) : [],
    canManage,
    removalBlocker: removalBlocker(lifecycle),
    availableForUse: isAvailableForUse(lifecycle),
  }
}

export interface AssetFormOptions {
  categories: CategoryRow[]
}

export async function loadAssetFormOptions(db: Db): Promise<AssetFormOptions> {
  return { categories: await listCategories(db, { includeInactive: false }) }
}

export async function loadAccessoryTypeOptions(db: Db) {
  return listAccessoryTypes(db)
}
