import 'server-only'

import { AssetStatus, AuditAction, KitStatus, type Prisma } from '@prisma/client'

import type {
  CreateKitInput,
  KitChecklistInput,
  KitMemberInput,
  KitMemberUpdateInput,
  KitSoftwareInput,
  UpdateKitInput,
} from '@/lib/validation/kits'
import { can } from '@/server/auth/permissions'
import { type Actor, requirePermission } from '@/server/auth/session'
import {
  type ChecklistTemplateItemRow,
  type ChecklistTemplateOption,
  listChecklistTemplateItems,
  listChecklistTemplates,
  listSoftwareApplications,
  type SoftwareApplicationOption,
} from '@/server/dal/catalogue.dal'
import {
  type AssetAssignmentFacts,
  type AssetCandidate,
  countKitsByStatus,
  factsFromDetail,
  findKitIdByBarcode,
  getAssetAssignmentFacts,
  getKitAvailabilityFacts,
  getKitDetail,
  getKitHistory,
  getKitLifecycleContext,
  getKitMembership,
  type KitAvailabilityFacts,
  type KitDetail,
  type KitHistoryEvent,
  type KitLifecycleContext,
  type KitListQuery,
  type KitListRecord,
  type KitListResult,
  listKits,
  OUT_BOOKING_STATUSES,
  searchAssetCandidates,
} from '@/server/dal/kits.dal'
import { prisma, type Db } from '@/server/db/prisma'
import { recordAudit } from '@/server/services/audit.service'
import { DomainError, uniqueViolationField } from '@/server/services/errors'

/**
 * Kit business rules.
 *
 * A kit is a reusable collection of equipment issued together. Nothing about
 * the equipment is a column on the kit: contents are `KitAsset` rows, software
 * expectations are `KitSoftware` rows, and the handover checklist is a
 * reference to a template. This module owns three things:
 *
 *  1. The kit lifecycle - which statuses a person may set and which belong to
 *     the booking workflow (AD-16 applied to kits).
 *  2. The assignment rules - when an asset may join or leave a kit. They are
 *     checked here and *also* enforced by the database (one active kit per
 *     asset, one row per kit and asset), so two administrators racing each
 *     other end in a friendly conflict rather than a duplicate.
 *  3. Availability - `evaluateKitAvailability` is the single calculation of
 *     "can this kit go out right now"; the list, the detail page and later the
 *     booking workflow all call it.
 *
 * Every mutation runs in one transaction with its audit entry.
 */

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

export const KIT_STATUS_LABEL: Record<KitStatus, string> = {
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  CHECKED_OUT: 'Checked out',
  MAINTENANCE: 'Maintenance',
  DAMAGED: 'Damaged',
  RETIRED: 'Retired',
}

/** Statuses owned by the booking, handover and return workflows. */
const WORKFLOW_STATUSES: readonly KitStatus[] = [KitStatus.RESERVED, KitStatus.CHECKED_OUT]

const MANUAL_STATUSES: readonly KitStatus[] = [KitStatus.AVAILABLE, KitStatus.MAINTENANCE, KitStatus.DAMAGED, KitStatus.RETIRED]

type TransitionContext = Pick<KitLifecycleContext, 'memberCount' | 'hasLiveBooking'>

/**
 * The statuses a person may move a kit to from `current`. The current status
 * is always included (no change).
 *
 *  - RESERVED / CHECKED_OUT are set and cleared by bookings: no manual exit.
 *  - A kit with equipment still in it, or with a live booking, cannot be RETIRED.
 */
export function allowedKitStatusTransitions(current: KitStatus, context: TransitionContext): KitStatus[] {
  if (WORKFLOW_STATUSES.includes(current)) return [current]
  const targets = new Set<KitStatus>([current, ...MANUAL_STATUSES])
  if (context.memberCount > 0 || context.hasLiveBooking) targets.delete(KitStatus.RETIRED)
  return [...targets]
}

export function assertKitStatusTransition(current: KitStatus, next: KitStatus, context: TransitionContext): void {
  if (allowedKitStatusTransitions(current, context).includes(next)) return

  let reason = `A kit cannot be moved from ${KIT_STATUS_LABEL[current]} to ${KIT_STATUS_LABEL[next]} by hand.`
  if (WORKFLOW_STATUSES.includes(next)) reason = `${KIT_STATUS_LABEL[next]} is set by the booking and handover workflow, not by editing.`
  else if (WORKFLOW_STATUSES.includes(current))
    reason = `A kit that is ${KIT_STATUS_LABEL[current].toLowerCase()} is controlled by its booking; use the return workflow.`
  else if (next === KitStatus.RETIRED && context.hasLiveBooking) reason = 'A kit with a live booking cannot be retired.'
  else if (next === KitStatus.RETIRED && context.memberCount > 0) reason = 'Remove all equipment from the kit before retiring it.'

  throw new DomainError('lifecycle', reason, { status: reason })
}

/** Whether the kit may leave the inventory (soft delete). */
export function kitRemovalBlocker(context: KitLifecycleContext): string | null {
  if (context.deleted) return 'This kit has already been removed.'
  if (context.hasLiveBooking) return 'A kit with a live booking cannot be removed.'
  if (WORKFLOW_STATUSES.includes(context.status)) return 'A reserved or checked-out kit cannot be removed.'
  if (context.memberCount > 0) return 'Remove all equipment from the kit before removing the kit itself.'
  return null
}

/** Whether equipment may currently be added to the kit. */
export function kitAcceptsMembersBlocker(context: KitLifecycleContext): string | null {
  if (context.deleted) return 'This kit has been removed from the inventory.'
  if (context.status === KitStatus.RETIRED) return 'A retired kit cannot take equipment. Make it available first.'
  if (context.contentsLocked) return 'The kit is being handed over or is out with an editor; its contents are frozen until it is returned.'
  return null
}

// -----------------------------------------------------------------------------
// Assignment rules (mirrored by the database: kit_assets_one_active_kit_per_asset
// and kit_assets_kitId_assetId_key)
// -----------------------------------------------------------------------------

const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  AVAILABLE: 'available',
  RESERVED: 'reserved',
  CHECKED_OUT: 'checked out',
  MAINTENANCE: 'in maintenance',
  DAMAGED: 'marked damaged',
  MISSING: 'marked missing',
  RETIRED: 'retired',
}

/**
 * Why `asset` cannot be added to kit `kitId` right now, or `null` when it can.
 * Only available equipment with no active maintenance and no current kit may
 * join; the message names the specific obstacle so the operator knows what to
 * do about it.
 */
export function assetAssignmentBlocker(asset: AssetAssignmentFacts, kitId: string): string | null {
  if (asset.deleted) return `${asset.assetCode} has been removed from the inventory.`
  if (asset.currentKit) {
    return asset.currentKit.id === kitId
      ? `${asset.assetCode} is already in this kit.`
      : `${asset.assetCode} is in kit ${asset.currentKit.kitCode}. Remove it there first.`
  }
  if (asset.status === AssetStatus.RETIRED) return `${asset.assetCode} is retired.`
  if (asset.status === AssetStatus.CHECKED_OUT || asset.status === AssetStatus.RESERVED)
    return `${asset.assetCode} is ${ASSET_STATUS_LABEL[asset.status]} under a booking and cannot be moved.`
  if (asset.activeMaintenanceCount > 0 || asset.status === AssetStatus.MAINTENANCE)
    return `${asset.assetCode} has maintenance in progress or on hold. Complete or cancel it first.`
  if (asset.status !== AssetStatus.AVAILABLE) return `${asset.assetCode} is ${ASSET_STATUS_LABEL[asset.status]} and cannot be issued as part of a kit.`
  return null
}

/** Why a member cannot be removed from its kit right now, or `null`. */
export function memberRemovalBlocker(context: KitLifecycleContext, memberStatus: AssetStatus): string | null {
  if (context.contentsLocked) return 'The kit is being handed over or is out with an editor; its contents are frozen until it is returned.'
  if (memberStatus === AssetStatus.CHECKED_OUT || memberStatus === AssetStatus.RESERVED)
    return `Equipment that is ${ASSET_STATUS_LABEL[memberStatus]} under a booking cannot be removed from its kit.`
  return null
}

/**
 * Translates a unique-constraint failure on `kit_assets` into a domain error.
 * `kit_assets_one_active_kit_per_asset` fires when another transaction added
 * the asset to a kit between our check and our insert; the composite key fires
 * when the same kit received the same asset twice. Either way the database
 * has kept the invariant and the operator gets a sentence, not a stack trace.
 */
export function translateKitAssetError(error: unknown): DomainError | null {
  const field = uniqueViolationField(error)
  if (!field) return null
  const text = JSON.stringify((error as { meta?: unknown }).meta ?? '') + String((error as { message?: unknown }).message ?? '')
  const otherKit = /one_active_kit/i.test(text) || (/assetId/i.test(text) && !/kitId/i.test(text))
  const message = otherKit
    ? 'This equipment was just added to another kit. Refresh to see its current kit.'
    : 'This equipment is already in the kit.'
  return new DomainError('conflict', message, { assetId: message })
}

// -----------------------------------------------------------------------------
// Availability - the one calculation of "can this kit go out"
// -----------------------------------------------------------------------------

export type KitAvailabilityReasonCode =
  | 'kit_removed'
  | 'kit_inactive'
  | 'kit_status'
  | 'live_booking'
  | 'asset_removed'
  | 'asset_status'
  | 'asset_maintenance'

export interface KitAvailabilityReason {
  code: KitAvailabilityReasonCode
  /** `blocking` reasons make the kit unavailable; `warning` reasons concern optional members. */
  severity: 'blocking' | 'warning'
  assetId: string | null
  assetCode: string | null
  slotLabel: string | null
  reason: string
}

export type KitAvailabilityState = 'ready' | 'reserved' | 'out' | 'unavailable'

export interface KitAvailability {
  available: boolean
  state: KitAvailabilityState
  reasons: KitAvailabilityReason[]
  blockingCount: number
  warningCount: number
  memberCount: number
  requiredCount: number
}

export const KIT_AVAILABILITY_LABEL: Record<KitAvailabilityState, string> = {
  ready: 'Ready',
  reserved: 'Reserved',
  out: 'Out',
  unavailable: 'Not ready',
}

/**
 * Pure: facts in, verdict out. A kit is available when it is live, its status
 * is AVAILABLE, no booking holds it, and every *required* member is available
 * with no maintenance in progress or on hold. Problems with optional members
 * are reported as warnings and do not block.
 */
export function evaluateKitAvailability(facts: KitAvailabilityFacts): KitAvailability {
  const reasons: KitAvailabilityReason[] = []
  const kitLevel = (code: KitAvailabilityReasonCode, reason: string) =>
    reasons.push({ code, severity: 'blocking', assetId: null, assetCode: null, slotLabel: null, reason })

  if (facts.deleted) kitLevel('kit_removed', 'The kit has been removed from the inventory.')
  else if (!facts.isActive) kitLevel('kit_inactive', 'The kit is inactive.')

  const out = new Set<string>(OUT_BOOKING_STATUSES)
  let state: KitAvailabilityState = 'unavailable'

  if (facts.liveBooking) {
    const booking = facts.liveBooking
    if (facts.status === KitStatus.CHECKED_OUT || out.has(booking.status)) {
      state = 'out'
      kitLevel('live_booking', `Checked out under ${booking.bookingNumber} by ${booking.editorName}.`)
    } else {
      state = 'reserved'
      kitLevel('live_booking', `Reserved under ${booking.bookingNumber} for ${booking.editorName}.`)
    }
  } else if (facts.status === KitStatus.CHECKED_OUT) {
    state = 'out'
    kitLevel('kit_status', 'The kit is checked out.')
  } else if (facts.status === KitStatus.RESERVED) {
    state = 'reserved'
    kitLevel('kit_status', 'The kit is reserved.')
  }

  if (facts.status === KitStatus.RETIRED) kitLevel('kit_status', 'The kit is retired.')
  else if (facts.status === KitStatus.MAINTENANCE) kitLevel('kit_status', 'The kit is in maintenance.')
  else if (facts.status === KitStatus.DAMAGED) kitLevel('kit_status', 'The kit is marked damaged.')

  for (const member of facts.members) {
    const severity = member.isRequired ? 'blocking' : 'warning'
    const base = { assetId: member.assetId, assetCode: member.assetCode, slotLabel: member.slotLabel, severity } as const

    if (member.deleted) {
      reasons.push({ ...base, code: 'asset_removed', reason: `${member.assetCode} has been removed from the inventory.` })
      continue
    }
    if (member.activeMaintenanceCount > 0) {
      reasons.push({ ...base, code: 'asset_maintenance', reason: `${member.assetCode} has maintenance in progress or on hold.` })
      continue
    }
    if (member.status !== AssetStatus.AVAILABLE) {
      reasons.push({ ...base, code: 'asset_status', reason: `${member.assetCode} is ${ASSET_STATUS_LABEL[member.status]}.` })
    }
  }

  const blockingCount = reasons.filter((reason) => reason.severity === 'blocking').length
  const warningCount = reasons.length - blockingCount
  const available = blockingCount === 0
  if (available) state = 'ready'

  return {
    available,
    state,
    reasons,
    blockingCount,
    warningCount,
    memberCount: facts.members.length,
    requiredCount: facts.members.filter((member) => member.isRequired).length,
  }
}

/** Availability for one kit, straight from the database. Reused by the booking phases. */
export async function getKitAvailability(db: Db, kitId: string): Promise<KitAvailability | null> {
  const facts = await getKitAvailabilityFacts(db, kitId)
  return facts ? evaluateKitAvailability(facts) : null
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function inTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  if ('$transaction' in db && typeof db.$transaction === 'function') {
    return db.$transaction((tx) => fn(tx))
  }
  return fn(db)
}

const KIT_UNIQUE_LABELS: Record<string, string> = { kitCode: 'This kit code', admBarcode: 'This ADM barcode' }

function kitConflictFrom(error: unknown): DomainError | null {
  const field = uniqueViolationField(error)
  if (!field) return null
  const label = KIT_UNIQUE_LABELS[field] ?? 'This value'
  const message = `${label} is already used by another kit.`
  return new DomainError('conflict', message, { [field]: message })
}

function actorFields(actor: Actor) {
  return { actorUserId: actor.id, actorName: actor.name, actorRole: actor.role }
}

const nullIfEmpty = (value: string | undefined): string | null => value ?? null

async function requireLiveKit(db: Db, kitId: string): Promise<{ id: string; kitCode: string; name: string }> {
  const kit = await db.kit.findFirst({ where: { id: kitId, deletedAt: null }, select: { id: true, kitCode: true, name: true } })
  if (!kit) throw new DomainError('not_found', 'Kit not found.')
  return kit
}

// -----------------------------------------------------------------------------
// Kit mutations
// -----------------------------------------------------------------------------

export async function createKit(db: Db, actor: Actor, input: CreateKitInput): Promise<{ id: string; kitCode: string }> {
  return inTransaction(db, async (tx) => {
    let kit: { id: string; kitCode: string; name: string }
    try {
      kit = await tx.kit.create({
        data: {
          kitCode: input.kitCode,
          name: input.name,
          admBarcode: nullIfEmpty(input.admBarcode),
          description: nullIfEmpty(input.description),
          location: nullIfEmpty(input.location),
          notes: nullIfEmpty(input.notes),
          suitcaseStatus: input.suitcaseStatus,
          status: input.status,
        },
        select: { id: true, kitCode: true, name: true },
      })
    } catch (error) {
      throw kitConflictFrom(error) ?? error
    }

    await recordAudit(tx, {
      action: AuditAction.CREATE,
      entityType: 'Kit',
      entityId: kit.id,
      ...actorFields(actor),
      summary: `Kit ${kit.kitCode} ${kit.name} created`,
      newValue: {
        kitCode: kit.kitCode,
        name: input.name,
        admBarcode: input.admBarcode ?? null,
        location: input.location ?? null,
        suitcaseStatus: input.suitcaseStatus,
        status: input.status,
      },
    })

    return { id: kit.id, kitCode: kit.kitCode }
  })
}

const EDITABLE_FIELDS = ['kitCode', 'name', 'admBarcode', 'description', 'location', 'notes', 'suitcaseStatus', 'status'] as const

export async function updateKit(
  db: Db,
  actor: Actor,
  id: string,
  input: UpdateKitInput,
): Promise<{ id: string; kitCode: string; statusChanged: boolean }> {
  return inTransaction(db, async (tx) => {
    const current = await tx.kit.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        kitCode: true,
        name: true,
        admBarcode: true,
        description: true,
        location: true,
        notes: true,
        suitcaseStatus: true,
        status: true,
      },
    })
    if (!current) throw new DomainError('not_found', 'Kit not found.')

    const context = await getKitLifecycleContext(tx, id)
    if (!context) throw new DomainError('not_found', 'Kit not found.')
    if (input.status !== current.status) assertKitStatusTransition(current.status, input.status, context)

    const next = {
      kitCode: input.kitCode,
      name: input.name,
      admBarcode: nullIfEmpty(input.admBarcode),
      description: nullIfEmpty(input.description),
      location: nullIfEmpty(input.location),
      notes: nullIfEmpty(input.notes),
      suitcaseStatus: input.suitcaseStatus,
      status: input.status,
    }

    const changed = EDITABLE_FIELDS.filter((field) => current[field] !== next[field])
    if (changed.length === 0) return { id, kitCode: current.kitCode, statusChanged: false }

    try {
      await tx.kit.update({ where: { id }, data: next })
    } catch (error) {
      throw kitConflictFrom(error) ?? error
    }

    const statusChanged = current.status !== input.status
    if (statusChanged) {
      await recordAudit(tx, {
        action: AuditAction.KIT_STATUS_CHANGED,
        entityType: 'Kit',
        entityId: id,
        ...actorFields(actor),
        summary: `Kit ${current.kitCode} status changed ${KIT_STATUS_LABEL[current.status]} → ${KIT_STATUS_LABEL[input.status]}${input.statusReason ? ` · ${input.statusReason}` : ''}`,
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
        entityType: 'Kit',
        entityId: id,
        ...actorFields(actor),
        summary: `Kit ${next.kitCode} details updated (${detailFields.join(', ')})`,
        previousValue: pick(current),
        newValue: pick(next),
      })
    }

    return { id, kitCode: next.kitCode, statusChanged }
  })
}

export async function removeKit(db: Db, actor: Actor, id: string): Promise<void> {
  await inTransaction(db, async (tx) => {
    const kit = await tx.kit.findUnique({ where: { id }, select: { id: true, kitCode: true, name: true } })
    if (!kit) throw new DomainError('not_found', 'Kit not found.')

    const context = await getKitLifecycleContext(tx, id)
    const blocker = context ? kitRemovalBlocker(context) : 'Kit not found.'
    if (blocker) throw new DomainError('lifecycle', blocker)

    await tx.kit.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } })
    await recordAudit(tx, {
      action: AuditAction.DELETE,
      entityType: 'Kit',
      entityId: id,
      ...actorFields(actor),
      summary: `Kit ${kit.kitCode} ${kit.name} removed from the inventory`,
    })
  })
}

// -----------------------------------------------------------------------------
// Membership
// -----------------------------------------------------------------------------

export async function addKitAsset(
  db: Db,
  actor: Actor,
  kitId: string,
  input: KitMemberInput,
): Promise<{ kitAssetId: string; assetCode: string }> {
  return inTransaction(db, async (tx) => {
    const kit = await requireLiveKit(tx, kitId)
    const context = await getKitLifecycleContext(tx, kitId)
    const kitBlocker = context ? kitAcceptsMembersBlocker(context) : 'Kit not found.'
    if (kitBlocker) throw new DomainError('lifecycle', kitBlocker, { assetId: kitBlocker })

    const asset = await getAssetAssignmentFacts(tx, input.assetId)
    if (!asset) throw new DomainError('not_found', 'Equipment not found.', { assetId: 'Equipment not found.' })
    const assetBlocker = assetAssignmentBlocker(asset, kitId)
    if (assetBlocker) {
      throw new DomainError(asset.currentKit ? 'conflict' : 'lifecycle', assetBlocker, { assetId: assetBlocker })
    }

    const sortOrder = context ? context.memberCount : 0
    const slotLabel = nullIfEmpty(input.slotLabel)

    // One row per kit and asset (composite key): a previous membership of this
    // asset in this kit is reactivated rather than duplicated. Its history is
    // preserved by the KIT_ASSET_ADDED / KIT_ASSET_REMOVED audit entries.
    const previous = await tx.kitAsset.findUnique({ where: { kitId_assetId: { kitId, assetId: asset.id } }, select: { id: true } })

    let membership: { id: string }
    try {
      membership = previous
        ? await tx.kitAsset.update({
            where: { id: previous.id },
            data: { removedAt: null, addedAt: new Date(), slotLabel, isRequired: input.isRequired, sortOrder },
            select: { id: true },
          })
        : await tx.kitAsset.create({
            data: { kitId, assetId: asset.id, slotLabel, isRequired: input.isRequired, sortOrder },
            select: { id: true },
          })
    } catch (error) {
      throw translateKitAssetError(error) ?? error
    }

    await recordAudit(tx, {
      action: AuditAction.KIT_ASSET_ADDED,
      entityType: 'Kit',
      entityId: kitId,
      ...actorFields(actor),
      summary: `${asset.assetCode} ${asset.name} added to kit ${kit.kitCode}${slotLabel ? ` as ${slotLabel}` : ''}`,
      metadata: { kitAssetId: membership.id, assetId: asset.id, assetCode: asset.assetCode, slotLabel, isRequired: input.isRequired },
    })

    return { kitAssetId: membership.id, assetCode: asset.assetCode }
  })
}

export async function updateKitAsset(
  db: Db,
  actor: Actor,
  kitAssetId: string,
  input: KitMemberUpdateInput,
): Promise<{ kitId: string }> {
  return inTransaction(db, async (tx) => {
    const membership = await getKitMembership(tx, kitAssetId)
    if (!membership || membership.removedAt || membership.kit.deletedAt) throw new DomainError('not_found', 'Kit member not found.')

    const slotLabel = nullIfEmpty(input.slotLabel)
    if (slotLabel === membership.slotLabel && input.isRequired === membership.isRequired) return { kitId: membership.kitId }

    await tx.kitAsset.update({ where: { id: kitAssetId }, data: { slotLabel, isRequired: input.isRequired } })
    await recordAudit(tx, {
      action: AuditAction.UPDATE,
      entityType: 'Kit',
      entityId: membership.kitId,
      ...actorFields(actor),
      summary: `${membership.asset.assetCode} in kit ${membership.kit.kitCode}: ${input.isRequired ? 'required' : 'optional'}${slotLabel ? `, slot ${slotLabel}` : ''}`,
      previousValue: { slotLabel: membership.slotLabel, isRequired: membership.isRequired },
      newValue: { slotLabel, isRequired: input.isRequired },
      metadata: { kitAssetId, assetId: membership.assetId, assetCode: membership.asset.assetCode },
    })

    return { kitId: membership.kitId }
  })
}

export async function removeKitAsset(db: Db, actor: Actor, kitAssetId: string): Promise<{ kitId: string; assetCode: string }> {
  return inTransaction(db, async (tx) => {
    const membership = await getKitMembership(tx, kitAssetId)
    if (!membership || membership.removedAt) throw new DomainError('not_found', 'Kit member not found.')

    const context = await getKitLifecycleContext(tx, membership.kitId)
    const blocker = context ? memberRemovalBlocker(context, membership.asset.status) : 'Kit not found.'
    if (blocker) throw new DomainError('lifecycle', blocker)

    // Soft removal: inspection lines keep their kitAssetId, and the row itself
    // records when the asset left.
    await tx.kitAsset.update({ where: { id: kitAssetId }, data: { removedAt: new Date() } })
    await recordAudit(tx, {
      action: AuditAction.KIT_ASSET_REMOVED,
      entityType: 'Kit',
      entityId: membership.kitId,
      ...actorFields(actor),
      summary: `${membership.asset.assetCode} ${membership.asset.name} removed from kit ${membership.kit.kitCode}`,
      metadata: { kitAssetId, assetId: membership.assetId, assetCode: membership.asset.assetCode },
    })

    return { kitId: membership.kitId, assetCode: membership.asset.assetCode }
  })
}

// -----------------------------------------------------------------------------
// Software expectations
// -----------------------------------------------------------------------------

export async function addKitSoftware(db: Db, actor: Actor, kitId: string, input: KitSoftwareInput): Promise<{ id: string }> {
  return inTransaction(db, async (tx) => {
    const kit = await requireLiveKit(tx, kitId)
    const application = await tx.softwareApplication.findFirst({
      where: { id: input.softwareApplicationId, deletedAt: null, isActive: true },
      select: { id: true, name: true, version: true },
    })
    if (!application) {
      throw new DomainError('validation', 'Choose an active application.', { softwareApplicationId: 'Choose an active application.' })
    }

    const sortOrder = await tx.kitSoftware.count({ where: { kitId } })
    let row: { id: string }
    try {
      row = await tx.kitSoftware.create({
        data: { kitId, softwareApplicationId: application.id, isRequired: input.isRequired, sortOrder },
        select: { id: true },
      })
    } catch (error) {
      if (uniqueViolationField(error)) {
        const message = `${application.name} is already listed for this kit.`
        throw new DomainError('conflict', message, { softwareApplicationId: message })
      }
      throw error
    }

    const label = application.version ? `${application.name} ${application.version}` : application.name
    await recordAudit(tx, {
      action: AuditAction.KIT_SOFTWARE_ADDED,
      entityType: 'Kit',
      entityId: kitId,
      ...actorFields(actor),
      summary: `${label} ${input.isRequired ? 'required' : 'listed'} on kit ${kit.kitCode}`,
      metadata: { kitSoftwareId: row.id, softwareApplicationId: application.id, isRequired: input.isRequired },
    })

    return row
  })
}

export async function removeKitSoftware(db: Db, actor: Actor, kitSoftwareId: string): Promise<{ kitId: string }> {
  return inTransaction(db, async (tx) => {
    const row = await tx.kitSoftware.findUnique({
      where: { id: kitSoftwareId },
      select: { id: true, kitId: true, kit: { select: { kitCode: true } }, software: { select: { id: true, name: true, version: true } } },
    })
    if (!row) throw new DomainError('not_found', 'Software requirement not found.')

    // Hard delete is safe: inspections record software checks against the
    // application, not against this row, and the audit entry keeps the history.
    await tx.kitSoftware.delete({ where: { id: kitSoftwareId } })

    const label = row.software.version ? `${row.software.name} ${row.software.version}` : row.software.name
    await recordAudit(tx, {
      action: AuditAction.KIT_SOFTWARE_REMOVED,
      entityType: 'Kit',
      entityId: row.kitId,
      ...actorFields(actor),
      summary: `${label} removed from kit ${row.kit.kitCode}`,
      metadata: { kitSoftwareId, softwareApplicationId: row.software.id },
    })

    return { kitId: row.kitId }
  })
}

// -----------------------------------------------------------------------------
// Checklist template
// -----------------------------------------------------------------------------

export async function setKitChecklistTemplate(db: Db, actor: Actor, kitId: string, input: KitChecklistInput): Promise<void> {
  await inTransaction(db, async (tx) => {
    const kit = await tx.kit.findFirst({
      where: { id: kitId, deletedAt: null },
      select: { id: true, kitCode: true, defaultChecklistTemplate: { select: { id: true, name: true } } },
    })
    if (!kit) throw new DomainError('not_found', 'Kit not found.')

    let template: { id: string; name: string } | null = null
    if (input.templateId) {
      template = await tx.checklistTemplate.findFirst({
        where: { id: input.templateId, deletedAt: null, isActive: true },
        select: { id: true, name: true },
      })
      if (!template) throw new DomainError('validation', 'Choose an active checklist template.', { templateId: 'Choose an active checklist template.' })
    }

    if ((template?.id ?? null) === (kit.defaultChecklistTemplate?.id ?? null)) return

    await tx.kit.update({ where: { id: kitId }, data: { defaultChecklistTemplateId: template?.id ?? null } })
    await recordAudit(tx, {
      action: AuditAction.KIT_CHECKLIST_CHANGED,
      entityType: 'Kit',
      entityId: kitId,
      ...actorFields(actor),
      summary: template
        ? `Kit ${kit.kitCode} handover checklist set to ${template.name}`
        : `Kit ${kit.kitCode} handover checklist cleared (system default applies)`,
      previousValue: { templateId: kit.defaultChecklistTemplate?.id ?? null, name: kit.defaultChecklistTemplate?.name ?? null },
      newValue: { templateId: template?.id ?? null, name: template?.name ?? null },
    })
  })
}

// -----------------------------------------------------------------------------
// Page loaders (authorise, then read)
// -----------------------------------------------------------------------------

export interface KitListRow extends KitListRecord {
  availability: KitAvailability
}

export interface KitListPage {
  actor: Actor
  result: KitListResult<KitListRow>
  statusCounts: Record<KitStatus, number>
  /** Set when the search term is exactly one kit's barcode. */
  scannedKitId: string | null
}

export async function loadKitList(query: KitListQuery): Promise<KitListPage> {
  const actor = await requirePermission('kit.read')
  const [result, statusCounts, scannedKitId] = await Promise.all([
    listKits(prisma, query),
    countKitsByStatus(prisma),
    query.search ? findKitIdByBarcode(prisma, query.search) : Promise.resolve(null),
  ])
  return {
    actor,
    result: { ...result, rows: result.rows.map((row) => ({ ...row, availability: evaluateKitAvailability(row.facts) })) },
    statusCounts,
    scannedKitId,
  }
}

export interface KitWorkspace {
  actor: Actor
  kit: KitDetail
  availability: KitAvailability
  history: KitHistoryEvent[]
  lifecycle: KitLifecycleContext
  /** Statuses the actor may move the kit to; empty without kit.manage. */
  allowedStatuses: KitStatus[]
  canManage: boolean
  removalBlocker: string | null
  /** Why equipment cannot be added right now; null when it can. */
  membersBlocker: string | null
  /** Per member: why it cannot be removed right now; null when it can. */
  memberRemovalBlockers: Record<string, string | null>
}

export async function loadKitWorkspace(db: Db, actor: Actor, id: string): Promise<KitWorkspace | null> {
  const includeIssues = can(actor, 'issue.read')
  const [kit, history, lifecycle] = await Promise.all([
    getKitDetail(db, id, { includeIssues }),
    getKitHistory(db, id, { includeIssues }),
    getKitLifecycleContext(db, id),
  ])
  if (!kit || !lifecycle) return null

  const canManage = can(actor, 'kit.manage')
  return {
    actor,
    kit,
    availability: evaluateKitAvailability(factsFromDetail(kit)),
    history,
    lifecycle,
    allowedStatuses: canManage && !lifecycle.deleted ? allowedKitStatusTransitions(kit.status, lifecycle) : [],
    canManage,
    removalBlocker: kitRemovalBlocker(lifecycle),
    membersBlocker: kitAcceptsMembersBlocker(lifecycle),
    memberRemovalBlockers: Object.fromEntries(kit.members.map((member) => [member.kitAssetId, memberRemovalBlocker(lifecycle, member.status)])),
  }
}

export interface AssetCandidateRow extends AssetCandidate {
  /** Why it cannot be added to this kit; null when it can. */
  blocker: string | null
  /** The term was exactly this asset's barcode or code - a scan. */
  scanned: boolean
}

/** Equipment matching `term`, each annotated with whether it may join the kit. */
export async function loadAssetCandidates(db: Db, kitId: string, term: string): Promise<AssetCandidateRow[]> {
  const [candidates, context] = await Promise.all([searchAssetCandidates(db, term), getKitLifecycleContext(db, kitId)])
  const kitBlocker = context ? kitAcceptsMembersBlocker(context) : 'Kit not found.'
  const upper = term.trim().toUpperCase()
  return candidates.map((candidate) => ({
    ...candidate,
    blocker: kitBlocker ?? assetAssignmentBlocker(candidate, kitId),
    scanned: candidate.admBarcode?.toUpperCase() === upper || candidate.assetCode.toUpperCase() === upper,
  }))
}

export interface KitConfigurationOptions {
  software: SoftwareApplicationOption[]
  templates: ChecklistTemplateOption[]
}

export async function loadKitSoftwareOptions(db: Db): Promise<SoftwareApplicationOption[]> {
  return listSoftwareApplications(db)
}

export async function loadKitChecklistOptions(db: Db): Promise<ChecklistTemplateOption[]> {
  return listChecklistTemplates(db)
}

export async function loadChecklistPreview(db: Db, templateId: string): Promise<ChecklistTemplateItemRow[]> {
  return listChecklistTemplateItems(db, templateId)
}
