import 'server-only'

import {
  AssetStatus,
  AuditAction,
  BookingStatus,
  InspectionStatus,
  InspectionType,
  IssueSeverity,
  IssueType,
  KitStatus,
  NumberScope,
  type Prisma,
  SignatureType,
  SignerRole,
} from '@prisma/client'

import { canStartReturn, minutesLate, returnPunctuality } from '@/lib/booking-rules'
import type { ReturnChecklistInput, ReturnEquipmentInput, SignerRoleValue } from '@/lib/validation/return'
import { can } from '@/server/auth/permissions'
import type { Actor } from '@/server/auth/session'
import { getHandoverBooking, getLiveSignatureInternal, type HandoverBooking } from '@/server/dal/handover.dal'
import { getKitAvailabilityFacts } from '@/server/dal/kits.dal'
import { getHandoverForReturn, getLiveReturn, getReturnSummary, type HandoverRecord, type ReturnInspection, type ReturnSummary } from '@/server/dal/return.dal'
import type { Db } from '@/server/db/prisma'
import { recordAudit } from '@/server/services/audit.service'
import { DomainError, uniqueViolationField } from '@/server/services/errors'
import { evaluateKitReadinessForBooking, type KitAvailability } from '@/server/services/kits.service'
import { nextNumber } from '@/server/services/numbering.service'
import { decodeSignatureImage, sha256, SignatureImageError, type SignatureStore } from '@/server/storage/signature-store'

/**
 * Return / kit return: the kit comes back and the booking goes
 * CHECKED_OUT (or OVERDUE) → RETURN_INSPECTION → COMPLETED.
 *
 *  - `startReturn` opens the RETURN inspection and copies its lines from the
 *    *completed handover*, not from the kit as it stands today. If an
 *    administrator has since removed an asset from the kit, that asset is
 *    still expected back; an asset added to the kit after the handover is not
 *    part of this return at all. The one-live-inspection index makes starting
 *    idempotent, and starting also moves the booking to RETURN_INSPECTION.
 *  - Every item that actually went out starts as NOT_APPLICABLE, which here
 *    means "not yet accounted for", so completion can insist on an explicit
 *    returned / damaged / not-returned answer for each one.
 *  - `completeReturn` is one Serializable transaction: it locks the booking,
 *    re-validates, freezes the return document, sets `actualReturnDate` from
 *    the server clock, moves the booking to COMPLETED, puts each asset back to
 *    the status its condition implies, raises an Issue for anything damaged or
 *    missing, and then re-evaluates the kit through the Phase 5 readiness
 *    service rather than assuming it is available again.
 *  - Handover signatures are never touched: return signatures are new rows of
 *    the RETURN_* types on the return inspection.
 */

// -----------------------------------------------------------------------------
// Eligibility and verification (pure where possible)
// -----------------------------------------------------------------------------

export type ReturnBlockerCode = 'status' | 'handover' | 'kit' | 'equipment' | 'checklist' | 'signature'

export interface ReturnBlocker {
  code: ReturnBlockerCode
  reason: string
}

const STATUS_LABEL: Record<BookingStatus, string> = {
  DRAFT: 'a draft',
  RESERVED: 'reserved',
  READY_FOR_HANDOVER: 'ready for handover',
  CHECKED_OUT: 'checked out',
  OVERDUE: 'out and overdue',
  RETURN_INSPECTION: 'in return inspection',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
}

const CONDITION_WORD: Record<string, string> = {
  INCLUDED: 'returned',
  MISSING: 'not returned',
  DAMAGED: 'returned damaged',
  NOT_APPLICABLE: 'not accounted for',
}

/**
 * Why this booking cannot be returned at all, before any verification. The
 * handover is part of the answer: without a completed one there is nothing to
 * check the returned equipment against.
 */
export function bookingReturnBlockers(booking: HandoverBooking, handover: HandoverRecord | null, started: boolean): ReturnBlocker[] {
  const blockers: ReturnBlocker[] = []

  if (booking.status === BookingStatus.COMPLETED) {
    blockers.push({ code: 'status', reason: `${booking.bookingNumber} has already been returned and completed.` })
  } else if (started) {
    if (booking.status !== BookingStatus.RETURN_INSPECTION) {
      blockers.push({ code: 'status', reason: `${booking.bookingNumber} is ${STATUS_LABEL[booking.status]}; the return inspection cannot continue.` })
    }
  } else if (!canStartReturn(booking.status)) {
    blockers.push({
      code: 'status',
      reason: `${booking.bookingNumber} is ${STATUS_LABEL[booking.status]}; only a kit that is out can be returned.`,
    })
  }

  if (!handover) {
    blockers.push({ code: 'handover', reason: `${booking.bookingNumber} has no handover on record, so there is nothing to check the return against.` })
  } else if (!handover.completed) {
    blockers.push({ code: 'handover', reason: `The handover for ${booking.bookingNumber} was never completed. Complete or void it first.` })
  } else if (handover.lines.length === 0) {
    blockers.push({ code: 'handover', reason: `The handover for ${booking.bookingNumber} recorded no equipment.` })
  }

  if (booking.kit.deleted) blockers.push({ code: 'kit', reason: `Kit ${booking.kit.kitCode} has been removed from the inventory; an administrator must restore it before the return can be recorded.` })

  return blockers
}

export interface ReturnVerdict {
  blockers: ReturnBlocker[]
  warnings: string[]
  complete: boolean
  /** Lines that went out and still have no answer. */
  unanswered: number
}

/** Whether what has been recorded allows the return to be completed. */
export function returnVerdict(inspection: ReturnInspection): ReturnVerdict {
  const blockers: ReturnBlocker[] = []
  const warnings: string[] = []

  const expected = inspection.lines.filter((line) => line.wasHandedOver)
  if (expected.length === 0) {
    blockers.push({ code: 'equipment', reason: 'This return has no handed-over equipment to account for.' })
  }

  const unanswered = expected.filter((line) => line.status === 'NOT_APPLICABLE')
  if (unanswered.length > 0) {
    blockers.push({
      code: 'equipment',
      reason: `${unanswered.length} handed-over ${unanswered.length === 1 ? 'item has' : 'items have'} no return answer: ${unanswered
        .slice(0, 4)
        .map((line) => line.assetCodeSnapshot)
        .join(', ')}${unanswered.length > 4 ? ' and more' : ''}.`,
    })
  }

  // Problems do not block the return - the kit is back and the booking has to
  // close - but each one is stated plainly and becomes an Issue at completion.
  for (const line of inspection.lines) {
    if (line.status === 'MISSING') warnings.push(`${line.assetCodeSnapshot} ${line.nameSnapshot} did not come back; an issue will be raised.`)
    if (line.status === 'DAMAGED') warnings.push(`${line.assetCodeSnapshot} ${line.nameSnapshot} came back damaged; an issue will be raised.`)
    for (const accessory of line.accessories) {
      if (!accessory.wasHandedOver) continue
      if (accessory.status === 'NOT_APPLICABLE') {
        warnings.push(`${line.assetCodeSnapshot}: ${accessory.labelSnapshot} has no return answer; it will be recorded as not accounted for.`)
      } else if (accessory.status === 'MISSING' || accessory.status === 'DAMAGED') {
        warnings.push(`${line.assetCodeSnapshot}: ${accessory.labelSnapshot} is ${CONDITION_WORD[accessory.status]}; an issue will be raised.`)
      }
    }
  }

  const requiredChecks = inspection.checklist.filter((item) => item.isRequired)
  const unansweredChecks = requiredChecks.filter((item) => !item.result)
  if (unansweredChecks.length > 0) {
    blockers.push({ code: 'checklist', reason: `${unansweredChecks.length} required return ${unansweredChecks.length === 1 ? 'check has' : 'checks have'} not been answered.` })
  }
  for (const item of inspection.checklist) {
    if (item.result?.status !== 'FAIL') continue
    if (item.isRequired) warnings.push(`Return check "${item.label}" failed; an issue will be raised.`)
    else warnings.push(`Optional return check "${item.label}" failed.`)
  }

  const types = new Set(inspection.signatures.map((signature) => signature.type))
  if (!types.has(SignatureType.RETURN_ENGINEER)) {
    blockers.push({ code: 'signature', reason: 'The engineer receiving the kit has not signed.' })
  }
  if (!types.has(SignatureType.RETURN_EDITOR)) {
    warnings.push('The editor has not signed for the return. That is expected when the kit is dropped off without them.')
  }

  return { blockers, warnings, complete: blockers.length === 0, unanswered: unanswered.length }
}

/**
 * The kit's status once its equipment has been put back. Deliberately not
 * "available because the booking closed": the Phase 5 readiness rule decides,
 * from the assets as they now stand.
 */
export function kitStatusAfterReturn(readiness: KitAvailability | null): { status: KitStatus; reason: string } {
  if (!readiness) return { status: KitStatus.MAINTENANCE, reason: 'the kit could not be evaluated after the return' }
  if (readiness.available) return { status: KitStatus.AVAILABLE, reason: 'every required item is back and healthy' }
  const blocking = readiness.reasons.filter((reason) => reason.severity === 'blocking')
  if (blocking.some((reason) => reason.code === 'asset_maintenance')) {
    return { status: KitStatus.MAINTENANCE, reason: blocking.map((reason) => reason.reason).join(' ') }
  }
  return { status: KitStatus.DAMAGED, reason: blocking.map((reason) => reason.reason).join(' ') || 'the kit is not ready' }
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

async function requireOpenReturn(tx: Db, bookingId: string): Promise<ReturnInspection> {
  const inspection = await getLiveReturn(tx, bookingId)
  if (!inspection) throw new DomainError('lifecycle', 'The return inspection has not been started.')
  if (inspection.lockedAt || inspection.status === InspectionStatus.COMPLETED) {
    throw new DomainError('lifecycle', 'This return is complete and can no longer be changed.')
  }
  return inspection
}

async function assertReturnable(tx: Db, booking: HandoverBooking, started: boolean): Promise<HandoverRecord> {
  const handover = await getHandoverForReturn(tx, booking.id)
  const blockers = bookingReturnBlockers(booking, handover, started)
  if (blockers.length > 0) throw new DomainError('lifecycle', blockers.map((blocker) => blocker.reason).join(' '))
  // The blocker list has already proved the handover is present and completed.
  return handover as HandoverRecord
}

async function kitReadiness(tx: Db, kitId: string): Promise<KitAvailability | null> {
  const facts = await getKitAvailabilityFacts(tx, kitId)
  return facts ? evaluateKitReadinessForBooking(facts) : null
}

// -----------------------------------------------------------------------------
// Start: copy the handover document into a return document
// -----------------------------------------------------------------------------

export async function startReturn(db: Db, actor: Actor, bookingId: string): Promise<{ inspectionId: string; created: boolean }> {
  return inTransaction(db, async (tx) => {
    const booking = await requireBooking(tx, bookingId)
    const existing = await tx.inspection.findFirst({ where: { bookingId, type: InspectionType.RETURN, voidedAt: null }, select: { id: true, status: true, lockedAt: true } })
    if (existing) {
      // Reloading or a second click reuses the open document; a finished one is
      // not reopened - that would be a second return for the same booking.
      if (existing.status === InspectionStatus.COMPLETED || existing.lockedAt) {
        throw new DomainError('lifecycle', `${booking.bookingNumber} has already been returned and completed.`)
      }
      return { inspectionId: existing.id, created: false }
    }

    const handover = await assertReturnable(tx, booking, false)

    let inspection: { id: string }
    try {
      inspection = await tx.inspection.create({
        data: {
          bookingId,
          type: InspectionType.RETURN,
          status: InspectionStatus.IN_PROGRESS,
          suitcaseStatus: handover.suitcaseStatus,
          startedById: actor.id,
        },
        select: { id: true },
      })
    } catch (error) {
      // Two engineers pressed Start at once: the partial unique index kept one.
      if (uniqueViolationField(error)) {
        const winner = await tx.inspection.findFirst({ where: { bookingId, type: InspectionType.RETURN, voidedAt: null }, select: { id: true } })
        if (winner) return { inspectionId: winner.id, created: false }
      }
      throw error
    }

    // Lines come from the handover, in its order, with its snapshots. Nothing
    // is read from the kit's current composition.
    for (const source of handover.lines) {
      const line = await tx.assetInspection.create({
        data: {
          inspectionId: inspection.id,
          assetId: source.assetId,
          kitAssetId: source.kitAssetId,
          sortOrder: source.sortOrder,
          // NOT_APPLICABLE means "no answer yet" for something that went out.
          status: 'NOT_APPLICABLE',
          slotLabelSnapshot: source.slotLabelSnapshot,
          assetCodeSnapshot: source.assetCodeSnapshot,
          categoryNameSnapshot: source.categoryNameSnapshot,
          nameSnapshot: source.nameSnapshot,
          manufacturerSnapshot: source.manufacturerSnapshot,
          modelSnapshot: source.modelSnapshot,
          serialNumberSnapshot: source.serialNumberSnapshot,
          admBarcodeSnapshot: source.admBarcodeSnapshot,
        },
        select: { id: true },
      })
      if (source.accessories.length > 0) {
        await tx.accessoryInspection.createMany({
          data: source.accessories.map((accessory) => ({
            inspectionId: inspection.id,
            assetInspectionId: line.id,
            accessoryId: accessory.accessoryId,
            status: 'NOT_APPLICABLE' as const,
            quantityExpected: accessory.quantityHandedOver,
            sortOrder: accessory.sortOrder,
            labelSnapshot: accessory.labelSnapshot,
            accessoryTypeSnapshot: accessory.accessoryTypeSnapshot,
            serialNumberSnapshot: accessory.serialNumberSnapshot,
            admBarcodeSnapshot: accessory.admBarcodeSnapshot,
          })),
        })
      }
    }

    const previous = booking.status
    await tx.booking.update({ where: { id: bookingId }, data: { status: BookingStatus.RETURN_INSPECTION, updatedById: actor.id } })

    const handedOver = handover.lines.filter((line) => line.wasHandedOver).length
    await recordAudit(tx, {
      action: AuditAction.RETURN_STARTED,
      entityType: 'Booking',
      entityId: bookingId,
      ...actorFields(actor),
      summary: `${booking.bookingNumber} return inspection started by ${actor.name}: ${handedOver} handed-over ${handedOver === 1 ? 'item' : 'items'} to account for`,
      metadata: { inspectionId: inspection.id, handoverInspectionId: handover.inspectionId, detail: 'Kit received for inspection' },
    })
    await recordAudit(tx, {
      action: AuditAction.BOOKING_STATUS_CHANGED,
      entityType: 'Booking',
      entityId: bookingId,
      ...actorFields(actor),
      summary: `${booking.bookingNumber} ${previous === BookingStatus.OVERDUE ? 'Overdue' : 'Checked out'} → Return inspection`,
      previousValue: { status: previous },
      newValue: { status: BookingStatus.RETURN_INSPECTION },
      metadata: { detail: 'Return inspection opened' },
    })

    return { inspectionId: inspection.id, created: true }
  })
}

// -----------------------------------------------------------------------------
// Verification steps
// -----------------------------------------------------------------------------

async function refreshReturnStatus(tx: Db, inspectionId: string, bookingId: string): Promise<void> {
  const inspection = await getLiveReturn(tx, bookingId)
  if (!inspection || inspection.id !== inspectionId) return
  const verdict = returnVerdict(inspection)
  const onlySignaturesMissing = verdict.blockers.every((blocker) => blocker.code === 'signature')
  const next = onlySignaturesMissing ? InspectionStatus.PENDING_SIGNATURES : InspectionStatus.IN_PROGRESS
  if (next !== inspection.status) await tx.inspection.update({ where: { id: inspectionId }, data: { status: next } })
}

export async function saveReturnEquipment(db: Db, actor: Actor, bookingId: string, input: ReturnEquipmentInput): Promise<void> {
  await inTransaction(db, async (tx) => {
    const booking = await requireBooking(tx, bookingId)
    await assertReturnable(tx, booking, true)
    const inspection = await requireOpenReturn(tx, bookingId)

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
    await refreshReturnStatus(tx, inspection.id, bookingId)

    const returned = input.assets.filter((line) => line.status === 'INCLUDED').length
    const problems = input.assets.filter((line) => line.status === 'MISSING' || line.status === 'DAMAGED').length
    await recordAudit(tx, {
      action: AuditAction.UPDATE,
      entityType: 'Booking',
      entityId: bookingId,
      ...actorFields(actor),
      summary: `${booking.bookingNumber} return equipment recorded: ${returned} of ${input.assets.length} back${problems > 0 ? `, ${problems} missing or damaged` : ''}`,
      metadata: { inspectionId: inspection.id, step: 'return-equipment' },
    })
  })
}

export async function saveReturnChecklist(db: Db, actor: Actor, bookingId: string, input: ReturnChecklistInput): Promise<void> {
  await inTransaction(db, async (tx) => {
    const booking = await requireBooking(tx, bookingId)
    await assertReturnable(tx, booking, true)
    const inspection = await requireOpenReturn(tx, bookingId)

    const itemIds = new Set(inspection.checklist.map((item) => item.id))
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
    await refreshReturnStatus(tx, inspection.id, bookingId)

    await recordAudit(tx, {
      action: AuditAction.UPDATE,
      entityType: 'Booking',
      entityId: bookingId,
      ...actorFields(actor),
      summary: `${booking.bookingNumber} return checklist saved: ${passed} of ${answered} answered checks passed`,
      metadata: { inspectionId: inspection.id, step: 'return-checklist' },
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

const RETURN_SIGNATURE_TYPE: Record<SignerRoleValue, SignatureType> = {
  EDITOR: SignatureType.RETURN_EDITOR,
  ENGINEER: SignatureType.RETURN_ENGINEER,
}

/**
 * One return signature. As at handover, the image comes from the client and the
 * signer does not: the editor signature is attributed to the booking's editor,
 * the engineer signature to the authenticated actor. Both are new rows of the
 * RETURN_* types on the return inspection - the handover's signatures are on a
 * different inspection and are never read, voided or rewritten here.
 */
export async function captureReturnSignature(
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

  const booking = await requireBooking(db, bookingId)
  await assertReturnable(db, booking, true)
  const inspection = await requireOpenReturn(db, bookingId)
  const engineerProfile = role === 'ENGINEER' ? await db.engineerProfile.findFirst({ where: { userId: actor.id, deletedAt: null }, select: { id: true, staffId: true } }) : null

  const type = RETURN_SIGNATURE_TYPE[role]
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
          summary: `${booking.bookingNumber} return ${role === 'EDITOR' ? 'editor' : 'engineer'} signature replaced`,
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
        summary: role === 'EDITOR' ? `${booking.bookingNumber} return signed by editor ${booking.editor.fullName}` : `${booking.bookingNumber} return signed by engineer ${actor.name}`,
        metadata: { inspectionId: inspection.id, signatureId: signature.id, type },
      })
      await refreshReturnStatus(tx, inspection.id, bookingId)
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

export interface CompletedReturn {
  bookingId: string
  bookingNumber: string
  returnedAt: Date
  punctuality: ReturnType<typeof returnPunctuality>
  kitStatus: KitStatus
  issueNumbers: string[]
}

const ISSUE_SEVERITY: Record<'MISSING' | 'DAMAGED', IssueSeverity> = {
  MISSING: IssueSeverity.HIGH,
  DAMAGED: IssueSeverity.MEDIUM,
}

export async function completeReturn(db: Db, actor: Actor, bookingId: string): Promise<CompletedReturn> {
  return inTransaction(
    db,
    async (tx) => {
      // 1. Lock the booking: a second attempt waits here and then sees COMPLETED.
      await tx.$queryRaw`SELECT "id" FROM "bookings" WHERE "id" = ${bookingId} FOR UPDATE`

      // 2. Re-read and validate.
      const booking = await requireBooking(tx, bookingId)
      if (booking.status === BookingStatus.COMPLETED) throw new DomainError('lifecycle', `${booking.bookingNumber} has already been returned and completed.`)
      const handover = await assertReturnable(tx, booking, true)
      const inspection = await requireOpenReturn(tx, bookingId)

      // 3. Re-validate every recorded answer and the engineer's signature.
      const verdict = returnVerdict(inspection)
      if (verdict.blockers.length > 0) throw new DomainError('lifecycle', verdict.blockers.map((blocker) => blocker.reason).join(' '))

      const [engineerSignature, editorSignature] = await Promise.all([
        getLiveSignatureInternal(tx, inspection.id, SignatureType.RETURN_ENGINEER),
        getLiveSignatureInternal(tx, inspection.id, SignatureType.RETURN_EDITOR),
      ])
      if (!engineerSignature) throw new DomainError('lifecycle', 'The engineer receiving the kit must sign before the return can be completed.')

      const now = new Date()
      const punctuality = returnPunctuality(booking.expectedReturnDate, now)
      const late = minutesLate(booking.expectedReturnDate, now)

      // 4. The frozen return document, including what it was checked against.
      const documentSnapshot = {
        version: 1,
        booking: {
          number: booking.bookingNumber,
          bookingStart: booking.bookingStart.toISOString(),
          bookingEnd: booking.bookingEnd.toISOString(),
          collectionDate: booking.collectionDate?.toISOString() ?? null,
          expectedReturnDate: booking.expectedReturnDate.toISOString(),
          purpose: booking.purpose,
        },
        returnedAt: now.toISOString(),
        punctuality,
        minutesLate: late,
        editor: { name: booking.editor.fullName, staffId: booking.editor.staffId, type: booking.editor.isExternal ? 'EXTERNAL' : 'INTERNAL', contactNumber: booking.editor.contactNumber, company: booking.editor.company, department: booking.editor.department },
        kit: { code: booking.kit.kitCode, name: booking.kit.name, barcode: booking.kit.admBarcode, suitcaseStatus: inspection.suitcaseStatus },
        engineer: { assigned: booking.engineer.fullName, handedOverBy: handover.completedByName, returnReceivedBy: actor.name },
        handover: { inspectionId: handover.inspectionId, completedAt: handover.completedAt?.toISOString() ?? null, lineCount: handover.lines.length },
        equipment: inspection.lines.map((line) => ({
          assetCode: line.assetCodeSnapshot,
          name: line.nameSnapshot,
          category: line.categoryNameSnapshot,
          slot: line.slotLabelSnapshot,
          manufacturer: line.manufacturerSnapshot,
          model: line.modelSnapshot,
          serialNumber: line.serialNumberSnapshot,
          barcode: line.admBarcodeSnapshot,
          handedOver: line.wasHandedOver,
          handoverStatus: line.handoverStatus,
          returnStatus: line.status,
          notes: line.notes,
          accessories: line.accessories.map((accessory) => ({
            label: accessory.labelSnapshot,
            type: accessory.accessoryTypeSnapshot,
            handedOver: accessory.wasHandedOver,
            expected: accessory.quantityExpected,
            received: accessory.quantityReceived,
            returnStatus: accessory.status,
            notes: accessory.notes,
          })),
        })),
        checklist: inspection.checklist.map((item) => ({ label: item.label, required: item.isRequired, status: item.result?.status ?? null, notes: item.result?.notes ?? null })),
        generalNotes: inspection.generalNotes,
        signatures: [
          { type: 'RETURN_ENGINEER', signerName: engineerSignature.signerName, signedAt: engineerSignature.signedAt.toISOString(), imageHash: engineerSignature.imageHash },
          ...(editorSignature ? [{ type: 'RETURN_EDITOR', signerName: editorSignature.signerName, signedAt: editorSignature.signedAt.toISOString(), imageHash: editorSignature.imageHash }] : []),
        ],
      }

      // 5. Freeze the return document (the trigger makes it immutable from here).
      await tx.inspection.update({
        where: { id: inspection.id },
        data: { status: InspectionStatus.COMPLETED, completedAt: now, completedById: actor.id, lockedAt: now, documentSnapshot: documentSnapshot as Prisma.InputJsonValue },
      })

      // 6. The booking: returned now, by the server clock. Collection and
      //    expected return are left exactly as they were.
      await tx.booking.update({ where: { id: bookingId }, data: { status: BookingStatus.COMPLETED, actualReturnDate: now, updatedById: actor.id } })

      // 7. Each asset back to the status its recorded condition implies.
      const returned: string[] = []
      const problems: Array<{ assetId: string; assetCode: string; name: string; kind: 'MISSING' | 'DAMAGED'; notes: string | null }> = []
      for (const line of inspection.lines) {
        if (line.status === 'MISSING' || line.status === 'DAMAGED') {
          problems.push({ assetId: line.assetId, assetCode: line.assetCodeSnapshot, name: line.nameSnapshot, kind: line.status, notes: line.notes })
        }
        const target = line.status === 'INCLUDED' ? AssetStatus.AVAILABLE : line.status === 'MISSING' ? AssetStatus.MISSING : line.status === 'DAMAGED' ? AssetStatus.DAMAGED : null
        if (!target || line.current.deleted) continue
        if (line.status === 'INCLUDED') returned.push(line.assetCodeSnapshot)
        if (target === line.current.status) continue
        await tx.asset.update({ where: { id: line.assetId }, data: { status: target } })
        await tx.assetStatusLog.create({
          data: {
            assetId: line.assetId,
            fromStatus: line.current.status as AssetStatus,
            toStatus: target,
            reason:
              target === AssetStatus.AVAILABLE
                ? `Returned under ${booking.bookingNumber}`
                : `Recorded ${CONDITION_WORD[line.status]} at the return of ${booking.bookingNumber}`,
            bookingId,
            changedById: actor.id,
          },
        })
        if (target !== AssetStatus.AVAILABLE) {
          await recordAudit(tx, {
            action: AuditAction.ASSET_STATUS_CHANGED,
            entityType: 'Asset',
            entityId: line.assetId,
            ...actorFields(actor),
            summary: `${line.assetCodeSnapshot} ${CONDITION_WORD[line.status]} at the return of ${booking.bookingNumber}`,
            previousValue: { status: line.current.status },
            newValue: { status: target },
          })
        }
      }

      // 8. Accessory problems, recorded against the accessory - the accessory's
      //    own master data is never rewritten because of a return.
      const accessoryProblems = inspection.lines.flatMap((line) =>
        line.accessories
          .filter((accessory) => accessory.status === 'MISSING' || accessory.status === 'DAMAGED')
          .map((accessory) => ({
            assetCode: line.assetCodeSnapshot,
            assetId: line.assetId,
            accessoryId: accessory.accessoryId,
            label: accessory.labelSnapshot,
            type: accessory.accessoryTypeSnapshot,
            kind: accessory.status as 'MISSING' | 'DAMAGED',
            notes: accessory.notes,
          })),
      )

      // 9. One Issue per problem, through the existing issue model.
      const issueNumbers: string[] = []
      for (const problem of problems) {
        const issueNumber = await nextNumber(tx, NumberScope.ISSUE, now)
        const issue = await tx.issue.create({
          data: {
            issueNumber,
            type: problem.kind === 'MISSING' ? IssueType.MISSING : IssueType.DAMAGED,
            severity: ISSUE_SEVERITY[problem.kind],
            title: `${problem.assetCode} ${problem.kind === 'MISSING' ? 'not returned' : 'returned damaged'}`,
            description: [
              `${problem.assetCode} ${problem.name} was ${CONDITION_WORD[problem.kind]} at the return of ${booking.bookingNumber} by ${booking.editor.fullName}.`,
              problem.notes ? `Engineer's note: ${problem.notes}` : null,
              inspection.generalNotes ? `Return notes: ${inspection.generalNotes}` : null,
            ]
              .filter(Boolean)
              .join('\n'),
            bookingId,
            inspectionId: inspection.id,
            kitId: booking.kit.id,
            assetId: problem.assetId,
            reportedById: actor.id,
            reportedAt: now,
          },
          select: { id: true },
        })
        issueNumbers.push(issueNumber)
        await recordAudit(tx, {
          action: AuditAction.ISSUE_CREATED,
          entityType: 'Booking',
          entityId: bookingId,
          ...actorFields(actor),
          summary: `${issueNumber} raised: ${problem.assetCode} ${problem.kind === 'MISSING' ? 'not returned' : 'returned damaged'} on ${booking.bookingNumber}`,
          newValue: { issueNumber, type: problem.kind, assetCode: problem.assetCode },
          metadata: { issueId: issue.id, inspectionId: inspection.id, detail: problem.kind === 'MISSING' ? 'Reported missing' : 'Reported damaged' },
        })
      }
      for (const problem of accessoryProblems) {
        const issueNumber = await nextNumber(tx, NumberScope.ISSUE, now)
        const issue = await tx.issue.create({
          data: {
            issueNumber,
            type: problem.kind === 'MISSING' ? IssueType.MISSING : IssueType.DAMAGED,
            severity: IssueSeverity.LOW,
            title: `${problem.label} ${problem.kind === 'MISSING' ? 'not returned' : 'returned damaged'} (${problem.assetCode})`,
            description: [
              `${problem.label} (${problem.type}), handed over with ${problem.assetCode}, was ${CONDITION_WORD[problem.kind]} at the return of ${booking.bookingNumber}.`,
              problem.notes ? `Engineer's note: ${problem.notes}` : null,
            ]
              .filter(Boolean)
              .join('\n'),
            bookingId,
            inspectionId: inspection.id,
            kitId: booking.kit.id,
            assetId: problem.assetId,
            accessoryId: problem.accessoryId,
            reportedById: actor.id,
            reportedAt: now,
          },
          select: { id: true },
        })
        issueNumbers.push(issueNumber)
        await recordAudit(tx, {
          action: AuditAction.ISSUE_CREATED,
          entityType: 'Booking',
          entityId: bookingId,
          ...actorFields(actor),
          summary: `${issueNumber} raised: ${problem.label} ${problem.kind === 'MISSING' ? 'not returned' : 'returned damaged'} with ${problem.assetCode}`,
          newValue: { issueNumber, type: problem.kind, accessory: problem.label },
          metadata: { issueId: issue.id, inspectionId: inspection.id, detail: 'Accessory problem' },
        })
      }

      // 10. The kit: re-evaluated from its equipment, not assumed available.
      const readiness = await kitReadiness(tx, booking.kit.id)
      const kitOutcome = kitStatusAfterReturn(readiness)
      if (kitOutcome.status !== booking.kit.status) {
        await tx.kit.update({ where: { id: booking.kit.id }, data: { status: kitOutcome.status } })
      }

      // 11. Audit: the return, the booking, the kit.
      await recordAudit(tx, {
        action: AuditAction.RETURN_COMPLETED,
        entityType: 'Booking',
        entityId: bookingId,
        ...actorFields(actor),
        summary: `${booking.bookingNumber} returned by ${booking.editor.fullName}, received by ${actor.name}: ${returned.length} of ${inspection.lines.filter((line) => line.wasHandedOver).length} back${problems.length > 0 ? `, ${problems.length} with problems` : ''} (${punctuality === 'late' ? `${late} minutes late` : punctuality === 'early' ? 'early' : 'on time'})`,
        newValue: {
          returnedAt: now.toISOString(),
          expectedReturnDate: booking.expectedReturnDate.toISOString(),
          punctuality,
          minutesLate: late,
          returned,
          problems: problems.map((problem) => ({ assetCode: problem.assetCode, kind: problem.kind })),
          issues: issueNumbers,
        },
        metadata: { inspectionId: inspection.id, detail: punctuality === 'late' ? 'Returned late' : punctuality === 'early' ? 'Returned early' : 'Returned on time' },
      })
      await recordAudit(tx, {
        action: AuditAction.BOOKING_STATUS_CHANGED,
        entityType: 'Booking',
        entityId: bookingId,
        ...actorFields(actor),
        summary: `${booking.bookingNumber} Return inspection → Completed`,
        previousValue: { status: BookingStatus.RETURN_INSPECTION },
        newValue: { status: BookingStatus.COMPLETED },
        metadata: { detail: `Kit ${booking.kit.kitCode} received back` },
      })
      await recordAudit(tx, {
        action: AuditAction.KIT_STATUS_CHANGED,
        entityType: 'Kit',
        entityId: booking.kit.id,
        ...actorFields(actor),
        summary:
          kitOutcome.status === KitStatus.AVAILABLE
            ? `Kit ${booking.kit.kitCode} available again after ${booking.bookingNumber}: ${kitOutcome.reason}`
            : `Kit ${booking.kit.kitCode} unavailable after ${booking.bookingNumber} (${kitOutcome.status.toLowerCase()}): ${kitOutcome.reason}`,
        previousValue: { status: booking.kit.status },
        newValue: { status: kitOutcome.status, bookingNumber: booking.bookingNumber },
      })

      return { bookingId, bookingNumber: booking.bookingNumber, returnedAt: now, punctuality, kitStatus: kitOutcome.status, issueNumbers }
    },
    { isolationLevel: 'Serializable' },
  )
}

// -----------------------------------------------------------------------------
// Page loader
// -----------------------------------------------------------------------------

export interface ReturnWorkspace {
  actor: Actor
  booking: HandoverBooking
  handover: HandoverRecord | null
  inspection: ReturnInspection | null
  bookingBlockers: ReturnBlocker[]
  verdict: ReturnVerdict | null
  canPerform: boolean
  canComplete: boolean
  /** True once the return has been completed (booking COMPLETED). */
  completed: boolean
}

export async function loadReturnWorkspace(db: Db, actor: Actor, bookingId: string): Promise<ReturnWorkspace | null> {
  const booking = await getHandoverBooking(db, bookingId)
  if (!booking) return null
  const [inspection, handover] = await Promise.all([getLiveReturn(db, bookingId), getHandoverForReturn(db, bookingId)])
  const completed = booking.status === BookingStatus.COMPLETED || inspection?.status === InspectionStatus.COMPLETED
  const started = inspection !== null
  const bookingBlockers = completed ? [] : bookingReturnBlockers(booking, handover, started)
  const verdict = inspection && !completed ? returnVerdict(inspection) : null
  return {
    actor,
    booking,
    handover,
    inspection,
    bookingBlockers,
    verdict,
    canPerform: can(actor, 'return.perform') && !completed,
    canComplete: can(actor, 'return.complete') && !completed && bookingBlockers.length === 0 && verdict !== null && verdict.complete,
    completed: completed === true,
  }
}

export async function loadReturnSummary(db: Db, bookingId: string): Promise<ReturnSummary | null> {
  return getReturnSummary(db, bookingId)
}
