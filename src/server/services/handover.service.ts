import 'server-only'

import { AssetStatus, AuditAction, BookingStatus, InspectionStatus, InspectionType, KitStatus, type Prisma, SignatureType, SignerRole } from '@prisma/client'

import type { ChecklistVerificationInput, EquipmentVerificationInput, SignerRoleValue } from '@/lib/validation/handover'
import { can } from '@/server/auth/permissions'
import type { Actor } from '@/server/auth/session'
import { getKitAvailabilityFacts } from '@/server/dal/kits.dal'
import {
  getChecklistTemplateForKit,
  getHandoverBooking,
  getHandoverSummary,
  getInspectionState,
  getLiveHandover,
  getLiveSignatureInternal,
  getSnapshotMembers,
  getSnapshotSoftware,
  type HandoverBooking,
  type HandoverInspection,
  type HandoverSummary,
} from '@/server/dal/handover.dal'
import type { Db } from '@/server/db/prisma'
import { recordAudit } from '@/server/services/audit.service'
import { DomainError, uniqueViolationField } from '@/server/services/errors'
import { evaluateKitReadinessForBooking, type KitAvailability } from '@/server/services/kits.service'
import { decodeSignatureImage, sha256, SignatureImageError, type SignatureStore } from '@/server/storage/signature-store'

/**
 * Handover: the point where the kit physically changes hands and the booking
 * goes READY_FOR_HANDOVER → CHECKED_OUT.
 *
 *  - `startHandover` opens the HANDOVER inspection and snapshots what the kit
 *    contains *now* - equipment lines with their accessories, the software
 *    list, and the booking's checklist copied from the template (Phase 7
 *    deferred that copy to this moment). The partial unique index
 *    `inspections_one_live_per_booking_and_type` makes starting idempotent.
 *  - The verification steps write into those snapshot rows; nothing is ever
 *    re-read from the template, so later template edits cannot change a
 *    handover in flight or on record.
 *  - Signatures are files (signature-store) plus an immutable row whose
 *    signer identity is taken from the server: the booking's editor for the
 *    editor signature, the authenticated actor for the engineer signature.
 *  - `completeHandover` is one Serializable transaction that locks the
 *    booking row, re-validates everything (state, editor, kit set aside,
 *    readiness, verification, signatures), freezes the inspection, moves the
 *    booking to CHECKED_OUT with a server collection time, the kit and its
 *    handed-over equipment to CHECKED_OUT, and audits it. A second attempt
 *    finds the booking already CHECKED_OUT and answers with a sentence.
 */

// -----------------------------------------------------------------------------
// Eligibility and verification rules (pure where possible)
// -----------------------------------------------------------------------------

export type HandoverBlockerCode = 'status' | 'editor' | 'kit' | 'readiness' | 'equipment' | 'checklist' | 'software' | 'signature'

export interface HandoverBlocker {
  code: HandoverBlockerCode
  reason: string
}

const STATUS_LABEL: Record<BookingStatus, string> = {
  DRAFT: 'a draft',
  RESERVED: 'reserved',
  READY_FOR_HANDOVER: 'ready for handover',
  CHECKED_OUT: 'already checked out',
  OVERDUE: 'out and overdue',
  RETURN_INSPECTION: 'in return inspection',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
}

/** Why the booking cannot be handed over at all (before any verification). */
export function bookingHandoverBlockers(booking: HandoverBooking, readiness: KitAvailability | null): HandoverBlocker[] {
  const blockers: HandoverBlocker[] = []
  if (booking.status !== BookingStatus.READY_FOR_HANDOVER) {
    blockers.push({
      code: 'status',
      reason:
        booking.status === BookingStatus.CHECKED_OUT
          ? `${booking.bookingNumber} has already been handed over.`
          : `${booking.bookingNumber} is ${STATUS_LABEL[booking.status]}; only a booking that is ready for handover can be handed over.`,
    })
  }
  if (booking.editor.deleted) blockers.push({ code: 'editor', reason: `${booking.editor.fullName} has been removed from the editor directory.` })
  else if (!booking.editor.isActive) blockers.push({ code: 'editor', reason: `${booking.editor.fullName} is inactive. Reactivate the editor or cancel the booking.` })
  if (booking.kit.deleted) blockers.push({ code: 'kit', reason: `Kit ${booking.kit.kitCode} has been removed from the inventory.` })
  else if (booking.status === BookingStatus.READY_FOR_HANDOVER && booking.kit.status !== KitStatus.RESERVED) {
    blockers.push({ code: 'kit', reason: `Kit ${booking.kit.kitCode} is not set aside for this booking (its status is ${booking.kit.status.toLowerCase().replace('_', ' ')}).` })
  }
  // A kit with nothing on it passes the Phase 5 readiness rule trivially -
  // there are no required members to be missing - but the point of a handover
  // is to verify equipment, and a signed document listing none proves nothing.
  if (readiness && readiness.memberCount === 0) {
    blockers.push({
      code: 'kit',
      reason: `Kit ${booking.kit.kitCode} has no equipment on it. Add the kit's items before handing it over.`,
    })
  }
  if (readiness && !readiness.available) {
    for (const reason of readiness.reasons.filter((item) => item.severity === 'blocking')) blockers.push({ code: 'readiness', reason: reason.reason })
  }
  return blockers
}

export interface VerificationVerdict {
  blockers: HandoverBlocker[]
  warnings: string[]
  /** Every step the engineer must record has been recorded. */
  complete: boolean
}

/** Whether the recorded verification allows completion. */
export function verificationVerdict(inspection: HandoverInspection): VerificationVerdict {
  const blockers: HandoverBlocker[] = []
  const warnings: string[] = []

  // Belt and braces for the empty-kit case: even if a handover somehow began
  // on a kit with no members, it cannot be completed with nothing recorded.
  if (inspection.lines.length === 0) {
    blockers.push({
      code: 'equipment',
      reason: 'This handover has no equipment to verify. Add the kit\'s items, then start the handover again.',
    })
  }

  for (const line of inspection.lines) {
    const problem = line.status !== 'INCLUDED'
    if (line.isRequired && problem) blockers.push({ code: 'equipment', reason: `${line.assetCodeSnapshot} ${line.nameSnapshot} is marked ${line.status.toLowerCase().replace('_', ' ')}; a required item must be handed over.` })
    else if (problem && line.status !== 'NOT_APPLICABLE') warnings.push(`${line.assetCodeSnapshot} (optional) is marked ${line.status.toLowerCase()}.`)
    if (line.isRequired && !line.current.stillInKit) blockers.push({ code: 'equipment', reason: `${line.assetCodeSnapshot} is no longer in the kit.` })
    if (line.isRequired && line.current.activeMaintenanceCount > 0) blockers.push({ code: 'equipment', reason: `${line.assetCodeSnapshot} has maintenance in progress or on hold.` })
    for (const accessory of line.accessories) {
      if (accessory.isRequired && accessory.status !== 'INCLUDED' && accessory.status !== 'NOT_APPLICABLE') {
        warnings.push(`${line.assetCodeSnapshot}: ${accessory.labelSnapshot} (${accessory.accessoryTypeSnapshot}) is marked ${accessory.status.toLowerCase()}.`)
      }
    }
  }

  const unanswered = inspection.checklist.filter((item) => item.isRequired && !item.result)
  if (unanswered.length > 0) blockers.push({ code: 'checklist', reason: `${unanswered.length} required ${unanswered.length === 1 ? 'check has' : 'checks have'} not been answered.` })
  for (const item of inspection.checklist) {
    if (item.isRequired && item.result?.status === 'FAIL') blockers.push({ code: 'checklist', reason: `Check "${item.label}" failed.` })
    if (!item.isRequired && item.result?.status === 'FAIL') warnings.push(`Optional check "${item.label}" failed.`)
  }

  for (const check of inspection.software) {
    const ok = check.status === 'INSTALLED' || check.status === 'NOT_APPLICABLE'
    if (check.isRequired && !ok) blockers.push({ code: 'software', reason: `${check.nameSnapshot}${check.versionSnapshot ? ` ${check.versionSnapshot}` : ''} is ${check.status.toLowerCase().replace('_', ' ')}.` })
    else if (!ok) warnings.push(`${check.nameSnapshot} (optional) is ${check.status.toLowerCase().replace('_', ' ')}.`)
  }

  const types = new Set(inspection.signatures.map((signature) => signature.type))
  if (!types.has(SignatureType.HANDOVER_EDITOR)) blockers.push({ code: 'signature', reason: 'The editor has not signed.' })
  if (!types.has(SignatureType.HANDOVER_ENGINEER)) blockers.push({ code: 'signature', reason: 'The engineer has not signed.' })

  return { blockers, warnings, complete: blockers.length === 0 }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function inTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> {
  if ('$transaction' in db && typeof db.$transaction === 'function') {
    return db.$transaction((tx) => fn(tx), options)
  }
  return fn(db)
}

function actorFields(actor: Actor) {
  return { actorUserId: actor.id, actorName: actor.name, actorRole: actor.role }
}

async function requireBooking(tx: Db, bookingId: string): Promise<HandoverBooking> {
  const booking = await getHandoverBooking(tx, bookingId)
  if (!booking) throw new DomainError('not_found', 'Booking not found.')
  return booking
}

async function requireOpenHandover(tx: Db, bookingId: string): Promise<HandoverInspection> {
  const inspection = await getLiveHandover(tx, bookingId)
  if (!inspection) throw new DomainError('lifecycle', 'The handover has not been started.')
  if (inspection.lockedAt || inspection.status === InspectionStatus.COMPLETED) throw new DomainError('lifecycle', 'This handover is complete and can no longer be changed.')
  return inspection
}

function assertReadyForHandover(booking: HandoverBooking): void {
  if (booking.status === BookingStatus.READY_FOR_HANDOVER) return
  throw new DomainError('lifecycle', bookingHandoverBlockers(booking, null)[0]?.reason ?? 'The booking is not ready for handover.')
}

async function kitReadiness(tx: Db, kitId: string): Promise<KitAvailability | null> {
  const facts = await getKitAvailabilityFacts(tx, kitId)
  return facts ? evaluateKitReadinessForBooking(facts) : null
}

// -----------------------------------------------------------------------------
// Start (snapshot)
// -----------------------------------------------------------------------------

export async function startHandover(db: Db, actor: Actor, bookingId: string): Promise<{ inspectionId: string; created: boolean }> {
  return inTransaction(db, async (tx) => {
    const booking = await requireBooking(tx, bookingId)
    const existing = await tx.inspection.findFirst({ where: { bookingId, type: InspectionType.HANDOVER, voidedAt: null }, select: { id: true } })
    if (existing) return { inspectionId: existing.id, created: false }

    assertReadyForHandover(booking)
    const blockers = bookingHandoverBlockers(booking, await kitReadiness(tx, booking.kit.id))
    if (blockers.length > 0) throw new DomainError('lifecycle', blockers.map((blocker) => blocker.reason).join(' '))

    const [members, software, template] = await Promise.all([getSnapshotMembers(tx, booking.kit.id), getSnapshotSoftware(tx, booking.kit.id), getChecklistTemplateForKit(tx, booking.kit.defaultChecklistTemplateId)])

    let inspection: { id: string }
    try {
      inspection = await tx.inspection.create({
        data: { bookingId, type: InspectionType.HANDOVER, status: InspectionStatus.IN_PROGRESS, suitcaseStatus: booking.kit.suitcaseStatus, startedById: actor.id },
        select: { id: true },
      })
    } catch (error) {
      // Two engineers pressed Start at once: the index kept one; reuse it.
      if (uniqueViolationField(error)) {
        const winner = await tx.inspection.findFirst({ where: { bookingId, type: InspectionType.HANDOVER, voidedAt: null }, select: { id: true } })
        if (winner) return { inspectionId: winner.id, created: false }
      }
      throw error
    }

    for (const member of members) {
      const line = await tx.assetInspection.create({
        data: {
          inspectionId: inspection.id,
          assetId: member.assetId,
          kitAssetId: member.kitAssetId,
          sortOrder: member.sortOrder,
          slotLabelSnapshot: member.slotLabel,
          assetCodeSnapshot: member.assetCode,
          categoryNameSnapshot: member.categoryName,
          nameSnapshot: member.name,
          manufacturerSnapshot: member.manufacturer,
          modelSnapshot: member.model,
          serialNumberSnapshot: member.serialNumber,
          admBarcodeSnapshot: member.admBarcode,
        },
        select: { id: true },
      })
      if (member.accessories.length > 0) {
        await tx.accessoryInspection.createMany({
          data: member.accessories.map((accessory) => ({
            inspectionId: inspection.id,
            assetInspectionId: line.id,
            accessoryId: accessory.id,
            quantityExpected: accessory.quantity,
            sortOrder: accessory.sortOrder,
            labelSnapshot: accessory.label ?? accessory.typeName,
            accessoryTypeSnapshot: accessory.typeName,
            serialNumberSnapshot: accessory.serialNumber,
            admBarcodeSnapshot: accessory.admBarcode,
          })),
        })
      }
    }

    if (software.length > 0) {
      await tx.softwareCheck.createMany({
        data: software.map((row) => ({
          inspectionId: inspection.id,
          softwareApplicationId: row.softwareApplicationId,
          sortOrder: row.sortOrder,
          nameSnapshot: row.name,
          versionSnapshot: row.version,
          vendorSnapshot: row.vendor,
        })),
      })
    }

    // The booking's own checklist: copied once, from the kit's template (or the
    // default) as it reads today. Reopening never copies again.
    const existingItems = await tx.bookingChecklistItem.count({ where: { bookingId } })
    if (existingItems === 0 && template) {
      await tx.bookingChecklistItem.createMany({
        data: template.items.map((item) => ({
          bookingId,
          sourceTemplateItemId: item.sourceTemplateItemId,
          label: item.label,
          description: item.description,
          phase: item.phase,
          isRequired: item.isRequired,
          sortOrder: item.sortOrder,
        })),
      })
      if (booking.checklistTemplateId !== template.id) await tx.booking.update({ where: { id: bookingId }, data: { checklistTemplateId: template.id } })
    }

    await recordAudit(tx, {
      action: AuditAction.HANDOVER_STARTED,
      entityType: 'Booking',
      entityId: bookingId,
      ...actorFields(actor),
      summary: `${booking.bookingNumber} handover started for ${booking.editor.fullName}: ${members.length} ${members.length === 1 ? 'item' : 'items'}, ${software.length} applications, ${template ? template.items.length : 0} checks snapshotted`,
      metadata: { inspectionId: inspection.id, templateId: template?.id ?? null },
    })

    return { inspectionId: inspection.id, created: true }
  })
}

// -----------------------------------------------------------------------------
// Verification steps
// -----------------------------------------------------------------------------

async function refreshInspectionStatus(tx: Db, inspectionId: string, bookingId: string): Promise<void> {
  const inspection = await getLiveHandover(tx, bookingId)
  if (!inspection || inspection.id !== inspectionId) return
  const verdict = verificationVerdict(inspection)
  const onlySignaturesMissing = verdict.blockers.every((blocker) => blocker.code === 'signature')
  const next = onlySignaturesMissing ? InspectionStatus.PENDING_SIGNATURES : InspectionStatus.IN_PROGRESS
  if (next !== inspection.status) await tx.inspection.update({ where: { id: inspectionId }, data: { status: next } })
}

export async function saveEquipmentVerification(db: Db, actor: Actor, bookingId: string, input: EquipmentVerificationInput): Promise<void> {
  await inTransaction(db, async (tx) => {
    const booking = await requireBooking(tx, bookingId)
    assertReadyForHandover(booking)
    const inspection = await requireOpenHandover(tx, bookingId)

    const lineIds = new Set(inspection.lines.map((line) => line.id))
    const accessoryIds = new Set(inspection.lines.flatMap((line) => line.accessories.map((accessory) => accessory.id)))
    for (const line of input.assets) {
      if (!lineIds.has(line.id)) throw new DomainError('validation', 'The equipment list changed. Reload the page and try again.')
      await tx.assetInspection.update({ where: { id: line.id }, data: { status: line.status, notes: line.notes ?? null } })
    }
    for (const accessory of input.accessories) {
      if (!accessoryIds.has(accessory.id)) throw new DomainError('validation', 'The accessory list changed. Reload the page and try again.')
      await tx.accessoryInspection.update({
        where: { id: accessory.id },
        data: { status: accessory.status, quantityReceived: accessory.quantityReceived ?? null, notes: accessory.notes ?? null },
      })
    }
    await tx.inspection.update({ where: { id: inspection.id }, data: { suitcaseStatus: input.suitcaseStatus, generalNotes: input.generalNotes ?? null } })
    await refreshInspectionStatus(tx, inspection.id, bookingId)

    const included = input.assets.filter((line) => line.status === 'INCLUDED').length
    const problems = input.assets.filter((line) => line.status === 'MISSING' || line.status === 'DAMAGED').length
    await recordAudit(tx, {
      action: AuditAction.UPDATE,
      entityType: 'Booking',
      entityId: bookingId,
      ...actorFields(actor),
      summary: `${booking.bookingNumber} handover equipment verified: ${included} of ${input.assets.length} items handed over${problems > 0 ? `, ${problems} marked missing or damaged` : ''}`,
      metadata: { inspectionId: inspection.id, step: 'equipment' },
    })
  })
}

export async function saveChecklistVerification(db: Db, actor: Actor, bookingId: string, input: ChecklistVerificationInput): Promise<void> {
  await inTransaction(db, async (tx) => {
    const booking = await requireBooking(tx, bookingId)
    assertReadyForHandover(booking)
    const inspection = await requireOpenHandover(tx, bookingId)

    const itemIds = new Set(inspection.checklist.map((item) => item.id))
    const checkIds = new Set(inspection.software.map((check) => check.id))
    let answered = 0
    let passed = 0
    for (const answer of input.checks) {
      if (!itemIds.has(answer.id)) throw new DomainError('validation', 'The checklist changed. Reload the page and try again.')
      if (!answer.status) {
        await tx.checklistResult.deleteMany({ where: { inspectionId: inspection.id, bookingChecklistItemId: answer.id } })
        continue
      }
      answered += 1
      if (answer.status === 'PASS') passed += 1
      await tx.checklistResult.upsert({
        where: { inspectionId_bookingChecklistItemId: { inspectionId: inspection.id, bookingChecklistItemId: answer.id } },
        create: { inspectionId: inspection.id, bookingChecklistItemId: answer.id, status: answer.status, notes: answer.notes ?? null },
        update: { status: answer.status, notes: answer.notes ?? null },
      })
    }
    for (const software of input.software) {
      if (!checkIds.has(software.id)) throw new DomainError('validation', 'The software list changed. Reload the page and try again.')
      await tx.softwareCheck.update({ where: { id: software.id }, data: { status: software.status, installedVersion: software.installedVersion ?? null, notes: software.notes ?? null } })
    }
    await refreshInspectionStatus(tx, inspection.id, bookingId)

    await recordAudit(tx, {
      action: AuditAction.UPDATE,
      entityType: 'Booking',
      entityId: bookingId,
      ...actorFields(actor),
      summary: `${booking.bookingNumber} handover checklist saved: ${passed} of ${answered} answered checks passed${input.software.length > 0 ? `, ${input.software.filter((row) => row.status === 'INSTALLED').length} of ${input.software.length} applications installed` : ''}`,
      metadata: { inspectionId: inspection.id, step: 'checklist' },
    })
  })
}

// -----------------------------------------------------------------------------
// Signatures
// -----------------------------------------------------------------------------

export interface SignatureContext {
  ipAddress?: string | null
  userAgent?: string | null
}

const SIGNATURE_TYPE: Record<SignerRoleValue, SignatureType> = { EDITOR: SignatureType.HANDOVER_EDITOR, ENGINEER: SignatureType.HANDOVER_ENGINEER }

/**
 * Captures one handover signature. The image comes from the client; the
 * signer does not: the editor signature is attributed to the booking's editor
 * profile, the engineer signature to the authenticated actor. Re-signing voids
 * the previous live signature and stores a new one - rows are never edited.
 */
export async function captureSignature(
  db: Db,
  actor: Actor,
  bookingId: string,
  role: SignerRoleValue,
  imageDataUrl: string,
  store: SignatureStore,
  context: SignatureContext = {},
): Promise<{ signatureId: string }> {
  let bytes: Buffer
  try {
    bytes = decodeSignatureImage(imageDataUrl)
  } catch (error) {
    if (error instanceof SignatureImageError) throw new DomainError('validation', error.message, { image: error.message })
    throw error
  }

  // Validate everything that does not need the file before writing it.
  const booking = await requireBooking(db, bookingId)
  assertReadyForHandover(booking)
  const inspection = await requireOpenHandover(db, bookingId)
  if (role === 'EDITOR' && (booking.editor.deleted || !booking.editor.isActive)) {
    throw new DomainError('lifecycle', bookingHandoverBlockers(booking, null).find((blocker) => blocker.code === 'editor')?.reason ?? 'The editor cannot sign.')
  }
  const engineerProfile = role === 'ENGINEER' ? await db.engineerProfile.findFirst({ where: { userId: actor.id, deletedAt: null }, select: { id: true, staffId: true } }) : null

  const type = SIGNATURE_TYPE[role]
  const stored = await store.save({ bookingId, type, bytes })
  const hash = sha256(bytes)

  try {
    return await inTransaction(db, async (tx) => {
      const previous = await getLiveSignatureInternal(tx, inspection.id, type)
      if (previous) {
        await tx.signature.update({ where: { id: previous.id }, data: { voidedAt: new Date(), voidedById: actor.id, voidReason: 'Re-signed' } })
        await recordAudit(tx, {
          action: AuditAction.SIGNATURE_VOIDED,
          entityType: 'Booking',
          entityId: bookingId,
          ...actorFields(actor),
          summary: `${booking.bookingNumber} ${role === 'EDITOR' ? 'editor' : 'engineer'} signature replaced`,
          metadata: { inspectionId: inspection.id, signatureId: previous.id },
        })
      }
      let signature: { id: string }
      try {
        signature = await tx.signature.create({
          data: {
            bookingId,
            inspectionId: inspection.id,
            type,
            signerRole: role === 'EDITOR' ? SignerRole.EDITOR : SignerRole.ENGINEER,
            signerUserId: role === 'ENGINEER' ? actor.id : null,
            signerEditorProfileId: role === 'EDITOR' ? booking.editor.id : null,
            signerEngineerProfileId: role === 'ENGINEER' ? engineerProfile?.id ?? null : null,
            signerName: role === 'EDITOR' ? booking.editor.fullName : actor.name,
            signerStaffId: role === 'EDITOR' ? booking.editor.staffId : engineerProfile?.staffId ?? null,
            storageProvider: stored.provider,
            imagePath: stored.path,
            imageMimeType: 'image/png',
            imageHash: hash,
            ipAddress: context.ipAddress ?? null,
            userAgent: context.userAgent ?? null,
          },
          select: { id: true },
        })
      } catch (error) {
        if (uniqueViolationField(error)) throw new DomainError('conflict', 'A signature was captured a moment ago. Reload the page to see it.')
        throw error
      }
      await recordAudit(tx, {
        action: AuditAction.SIGNATURE_SUBMITTED,
        entityType: 'Booking',
        entityId: bookingId,
        ...actorFields(actor),
        summary: role === 'EDITOR' ? `${booking.bookingNumber} signed by editor ${booking.editor.fullName}` : `${booking.bookingNumber} signed by engineer ${actor.name}`,
        metadata: { inspectionId: inspection.id, signatureId: signature.id, type },
      })
      await refreshInspectionStatus(tx, inspection.id, bookingId)
      return { signatureId: signature.id }
    })
  } catch (error) {
    await store.remove(stored.path)
    throw error
  }
}

// -----------------------------------------------------------------------------
// Completion
// -----------------------------------------------------------------------------

export interface CompletedHandover {
  bookingId: string
  bookingNumber: string
  collectedAt: Date
}

export async function completeHandover(db: Db, actor: Actor, bookingId: string): Promise<CompletedHandover> {
  return inTransaction(
    db,
    async (tx) => {
      // 1. Lock the booking row: a concurrent completion waits here, then sees CHECKED_OUT.
      await tx.$queryRaw`SELECT "id" FROM "bookings" WHERE "id" = ${bookingId} FOR UPDATE`

      // 2. Re-read and validate the state.
      const booking = await requireBooking(tx, bookingId)
      if (booking.status === BookingStatus.CHECKED_OUT) throw new DomainError('lifecycle', `${booking.bookingNumber} has already been handed over.`)
      assertReadyForHandover(booking)
      const inspection = await requireOpenHandover(tx, bookingId)

      // 3. Re-validate the kit and the editor.
      const readiness = await kitReadiness(tx, booking.kit.id)
      const blockers = [...bookingHandoverBlockers(booking, readiness), ...verificationVerdict(inspection).blockers]
      if (blockers.length > 0) throw new DomainError('lifecycle', blockers.map((blocker) => blocker.reason).join(' '))

      // 4-5. Signatures: read the live rows with their hashes for the frozen document.
      const [editorSignature, engineerSignature] = await Promise.all([
        getLiveSignatureInternal(tx, inspection.id, SignatureType.HANDOVER_EDITOR),
        getLiveSignatureInternal(tx, inspection.id, SignatureType.HANDOVER_ENGINEER),
      ])
      if (!editorSignature || !engineerSignature) throw new DomainError('lifecycle', 'Both signatures are required to complete the handover.')

      const now = new Date()
      const documentSnapshot = {
        version: 1,
        booking: { number: booking.bookingNumber, bookingStart: booking.bookingStart.toISOString(), bookingEnd: booking.bookingEnd.toISOString(), expectedReturnDate: booking.expectedReturnDate.toISOString(), purpose: booking.purpose },
        collectedAt: now.toISOString(),
        editor: { name: booking.editor.fullName, staffId: booking.editor.staffId, type: booking.editor.isExternal ? 'EXTERNAL' : 'INTERNAL', contactNumber: booking.editor.contactNumber, company: booking.editor.company, department: booking.editor.department },
        kit: { code: booking.kit.kitCode, name: booking.kit.name, barcode: booking.kit.admBarcode, suitcaseStatus: inspection.suitcaseStatus },
        engineer: { assigned: booking.engineer.fullName, handedOverBy: actor.name },
        equipment: inspection.lines.map((line) => ({
          assetCode: line.assetCodeSnapshot,
          name: line.nameSnapshot,
          category: line.categoryNameSnapshot,
          slot: line.slotLabelSnapshot,
          manufacturer: line.manufacturerSnapshot,
          model: line.modelSnapshot,
          serialNumber: line.serialNumberSnapshot,
          barcode: line.admBarcodeSnapshot,
          required: line.isRequired,
          status: line.status,
          notes: line.notes,
          accessories: line.accessories.map((accessory) => ({ label: accessory.labelSnapshot, type: accessory.accessoryTypeSnapshot, expected: accessory.quantityExpected, received: accessory.quantityReceived, status: accessory.status, notes: accessory.notes })),
        })),
        software: inspection.software.map((check) => ({ name: check.nameSnapshot, version: check.versionSnapshot, required: check.isRequired, status: check.status, installedVersion: check.installedVersion, notes: check.notes })),
        checklist: inspection.checklist.map((item) => ({ label: item.label, required: item.isRequired, status: item.result?.status ?? null, notes: item.result?.notes ?? null })),
        generalNotes: inspection.generalNotes,
        signatures: [
          { type: 'HANDOVER_EDITOR', signerName: editorSignature.signerName, signedAt: editorSignature.signedAt.toISOString(), imageHash: editorSignature.imageHash },
          { type: 'HANDOVER_ENGINEER', signerName: engineerSignature.signerName, signedAt: engineerSignature.signedAt.toISOString(), imageHash: engineerSignature.imageHash },
        ],
      }

      // 6-7. Freeze the inspection (the trigger makes it immutable from here).
      await tx.inspection.update({
        where: { id: inspection.id },
        data: { status: InspectionStatus.COMPLETED, completedAt: now, completedById: actor.id, lockedAt: now, documentSnapshot: documentSnapshot as Prisma.InputJsonValue },
      })

      // 8-9. The booking: collected now, by the server clock; expected return untouched.
      await tx.booking.update({ where: { id: bookingId }, data: { status: BookingStatus.CHECKED_OUT, collectionDate: now, updatedById: actor.id } })

      // 10. The kit and the equipment that left with it.
      await tx.kit.update({ where: { id: booking.kit.id }, data: { status: KitStatus.CHECKED_OUT } })
      const handedOver: string[] = []
      for (const line of inspection.lines) {
        const target = line.status === 'INCLUDED' ? AssetStatus.CHECKED_OUT : line.status === 'MISSING' ? AssetStatus.MISSING : line.status === 'DAMAGED' ? AssetStatus.DAMAGED : null
        if (!target || target === line.current.status || line.current.deleted) continue
        await tx.asset.update({ where: { id: line.assetId }, data: { status: target } })
        await tx.assetStatusLog.create({
          data: { assetId: line.assetId, fromStatus: line.current.status as AssetStatus, toStatus: target, reason: target === AssetStatus.CHECKED_OUT ? `Handed over under ${booking.bookingNumber}` : `Recorded ${target.toLowerCase()} at handover of ${booking.bookingNumber}`, bookingId, changedById: actor.id },
        })
        if (target === AssetStatus.CHECKED_OUT) handedOver.push(line.assetCodeSnapshot)
      }

      // 11. Audit.
      await recordAudit(tx, {
        action: AuditAction.HANDOVER_COMPLETED,
        entityType: 'Booking',
        entityId: bookingId,
        ...actorFields(actor),
        summary: `${booking.bookingNumber} handed over to ${booking.editor.fullName} by ${actor.name}: kit ${booking.kit.kitCode}, ${handedOver.length} ${handedOver.length === 1 ? 'item' : 'items'}`,
        newValue: { collectedAt: now.toISOString(), expectedReturnDate: booking.expectedReturnDate.toISOString(), items: handedOver },
        metadata: { inspectionId: inspection.id, detail: 'Collected' },
      })
      await recordAudit(tx, {
        action: AuditAction.BOOKING_STATUS_CHANGED,
        entityType: 'Booking',
        entityId: bookingId,
        ...actorFields(actor),
        summary: `${booking.bookingNumber} Ready for handover → Checked out`,
        previousValue: { status: BookingStatus.READY_FOR_HANDOVER },
        newValue: { status: BookingStatus.CHECKED_OUT },
        metadata: { detail: `Collected by ${booking.editor.fullName}` },
      })
      await recordAudit(tx, {
        action: AuditAction.KIT_STATUS_CHANGED,
        entityType: 'Kit',
        entityId: booking.kit.id,
        ...actorFields(actor),
        summary: `Kit ${booking.kit.kitCode} handed over under ${booking.bookingNumber} (Reserved → Checked out)`,
        previousValue: { status: booking.kit.status },
        newValue: { status: KitStatus.CHECKED_OUT, bookingNumber: booking.bookingNumber, items: handedOver },
      })

      return { bookingId, bookingNumber: booking.bookingNumber, collectedAt: now }
    },
    { isolationLevel: 'Serializable' },
  )
}

// -----------------------------------------------------------------------------
// Page loader
// -----------------------------------------------------------------------------

export interface HandoverWorkspace {
  actor: Actor
  booking: HandoverBooking
  inspection: HandoverInspection | null
  readiness: KitAvailability | null
  /** Why the handover cannot start or complete, before verification. */
  bookingBlockers: HandoverBlocker[]
  /** Verification state of the open handover; null before it starts. */
  verdict: VerificationVerdict | null
  canPerform: boolean
  canComplete: boolean
  /** True once the handover has been completed (booking CHECKED_OUT or later). */
  completed: boolean
}

export async function loadHandoverWorkspace(db: Db, actor: Actor, bookingId: string): Promise<HandoverWorkspace | null> {
  const booking = await getHandoverBooking(db, bookingId)
  if (!booking) return null
  const [inspection, readiness] = await Promise.all([getLiveHandover(db, bookingId), kitReadiness(db, booking.kit.id)])
  const completed = inspection?.status === InspectionStatus.COMPLETED || booking.status !== BookingStatus.READY_FOR_HANDOVER
  const bookingBlockers = completed ? [] : bookingHandoverBlockers(booking, readiness)
  const verdict = inspection && !completed ? verificationVerdict(inspection) : null
  return {
    actor,
    booking,
    inspection,
    readiness,
    bookingBlockers,
    verdict,
    canPerform: can(actor, 'handover.perform') && !completed,
    canComplete: can(actor, 'handover.complete') && !completed && bookingBlockers.length === 0 && verdict !== null && verdict.complete,
    completed,
  }
}

export async function loadHandoverSummary(db: Db, bookingId: string): Promise<HandoverSummary | null> {
  return getHandoverSummary(db, bookingId)
}

export async function getInspectionStateForBooking(db: Db, inspectionId: string) {
  return getInspectionState(db, inspectionId)
}
