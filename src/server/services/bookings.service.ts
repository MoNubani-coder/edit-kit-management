import 'server-only'

import { AuditAction, BookingStatus, KitStatus, NumberScope } from '@prisma/client'

import {
  type BookingSchedule,
  canTransition,
  editorBookingBlocker,
  editScopeFor,
  isBookingOverdue,
  isCancellable,
  isDueSoon,
  isHoldingStatus,
  rangesOverlap,
  scheduleErrors,
} from '@/lib/booking-rules'
import { env } from '@/lib/env'
import { type CancelBookingInput, type CreateBookingInput, parseSchedule, type UpdateBookingInput } from '@/lib/validation/bookings'
import { can } from '@/server/auth/permissions'
import { type Actor, requirePermission } from '@/server/auth/session'
import {
  type BookingActivityEvent,
  type BookingDetail,
  type BookingLifecycleContext,
  type BookingListQuery,
  type BookingListResult,
  type BookingListRow,
  countBookingsByFilter,
  DUE_SOON_HOURS,
  type EngineerOption,
  findOverlappingBookings,
  getBookableEditor,
  getBookingActivity,
  getBookingDetailForActor,
  getBookingLifecycleContext,
  getEngineerOption,
  listActiveEngineers,
  listBookingsPage,
  type OverlappingBooking,
} from '@/server/dal/bookings.dal'
import { searchActiveEditors } from '@/server/dal/editors.dal'
import { getKitAvailabilityFacts, getKitDetail, type KitCandidate, type KitDetail, searchKitCandidates } from '@/server/dal/kits.dal'
import { prisma, type Db } from '@/server/db/prisma'
import { recordAudit } from '@/server/services/audit.service'
import { DomainError, uniqueViolationField } from '@/server/services/errors'
import { evaluateKitAvailability, evaluateKitReadinessForBooking, type KitAvailability } from '@/server/services/kits.service'
import { nextNumber } from '@/server/services/numbering.service'

/**
 * Booking business rules (Phase 7: reservation, before the physical handover).
 *
 *  - Numbers come from the locked counter row (`BK-YYYY-NNNNNN`) inside the
 *    same transaction as the insert, so a failed reservation burns nothing.
 *  - A DRAFT does not hold the kit. Reserving does: it checks the editor,
 *    the kit's structural readiness (Phase 5 rule) and the window against
 *    other live bookings, then writes - and the database exclusion constraint
 *    `bookings_no_overlapping_period_per_kit` is the final authority when two
 *    people race for the same kit and window.
 *  - Status is never chosen from a dropdown: `reserveBooking`,
 *    `returnToDraft`, `markReadyForHandover`, `revertReadyForHandover` and
 *    `cancelBooking` are the only transitions here; CHECKED_OUT and beyond
 *    belong to Phases 8 and 9.
 *  - READY_FOR_HANDOVER sets the kit aside: `Kit.status` becomes RESERVED and
 *    is restored when the booking reverts or is cancelled.
 */

// -----------------------------------------------------------------------------
// Error translation
// -----------------------------------------------------------------------------

/**
 * Database refusals as domain errors: the exclusion constraint (a race for the
 * same kit and window), the two schedule check constraints, and the impossible
 * duplicate booking number.
 */
export function translateBookingDbError(error: unknown): DomainError | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { code?: unknown; meta?: unknown; message?: unknown }
  const text = `${JSON.stringify(candidate.meta ?? '')} ${String(candidate.message ?? '')}`
  if (/no_overlapping_period_per_kit/i.test(text)) {
    const message = 'This kit was just reserved by someone else for an overlapping period. Choose another window or kit.'
    return new DomainError('conflict', message, { kitId: message })
  }
  if (/period_is_ordered/i.test(text)) return new DomainError('validation', 'The booking must end after it starts.', { bookingEnd: 'The booking must end after it starts.' })
  if (/return_after_collection/i.test(text)) {
    return new DomainError('validation', 'The expected return cannot be before collection.', { expectedReturnDate: 'The expected return cannot be before collection.' })
  }
  if (uniqueViolationField(error)) {
    return new DomainError('conflict', 'The booking number was already taken. Please try again.')
  }
  return null
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

function actorFields(actor: Actor) {
  return { actorUserId: actor.id, actorName: actor.name, actorRole: actor.role }
}

const nullIfEmpty = (value: string | undefined): string | null => value ?? null

const STATUS_LABEL: Record<BookingStatus, string> = {
  DRAFT: 'Draft',
  RESERVED: 'Reserved',
  READY_FOR_HANDOVER: 'Ready for handover',
  CHECKED_OUT: 'Checked out',
  OVERDUE: 'Overdue',
  RETURN_INSPECTION: 'Return inspection',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

function describeOverlap(conflicts: OverlappingBooking[]): string {
  const first = conflicts[0]
  const more = conflicts.length > 1 ? ` and ${conflicts.length - 1} more` : ''
  return `The kit is already booked under ${first.bookingNumber} for ${first.editorName} from ${first.bookingStart.toISOString()} to ${first.bookingEnd.toISOString()}${more}.`
}

/** The editor may receive a new booking, or a validation error names why not. */
async function requireBookableEditor(tx: Db, editorId: string) {
  const editor = await getBookableEditor(tx, editorId)
  if (!editor) throw new DomainError('not_found', 'Editor not found.', { editorId: 'Editor not found.' })
  const blocker = editorBookingBlocker(editor)
  if (blocker) throw new DomainError('lifecycle', blocker, { editorId: blocker })
  return editor
}

async function requireEngineer(tx: Db, engineerId: string): Promise<EngineerOption> {
  const engineer = await getEngineerOption(tx, engineerId)
  if (!engineer) throw new DomainError('validation', 'Choose an active engineer.', { engineerId: 'Choose an active engineer.' })
  return engineer
}

/** The kit exists and is live; readiness is a separate question answered at reservation time. */
async function requireKit(tx: Db, kitId: string) {
  const kit = await tx.kit.findFirst({
    where: { id: kitId, deletedAt: null },
    select: { id: true, kitCode: true, name: true, status: true, defaultChecklistTemplateId: true },
  })
  if (!kit) throw new DomainError('not_found', 'Kit not found.', { kitId: 'Kit not found.' })
  if (kit.status === KitStatus.RETIRED) throw new DomainError('lifecycle', `Kit ${kit.kitCode} is retired.`, { kitId: `Kit ${kit.kitCode} is retired.` })
  return kit
}

/**
 * Reservation gate: the kit must be structurally ready (Phase 5 rule) and the
 * window free of other live bookings. Blocking reasons are reported in full so
 * the operator can act on them.
 */
async function assertReservable(tx: Db, kitId: string, schedule: BookingSchedule, excludeBookingId?: string): Promise<KitAvailability> {
  const facts = await getKitAvailabilityFacts(tx, kitId)
  if (!facts) throw new DomainError('not_found', 'Kit not found.', { kitId: 'Kit not found.' })
  const readiness = evaluateKitReadinessForBooking(facts)
  if (!readiness.available) {
    const blocking = readiness.reasons.filter((reason) => reason.severity === 'blocking').map((reason) => reason.reason)
    const message = `Kit ${facts.kitCode} is not ready to be reserved: ${blocking.join(' ')}`
    throw new DomainError('lifecycle', message, { kitId: message })
  }
  const conflicts = await findOverlappingBookings(tx, kitId, schedule.bookingStart, schedule.bookingEnd, excludeBookingId)
  if (conflicts.length > 0) {
    const message = describeOverlap(conflicts)
    throw new DomainError('conflict', message, { bookingStart: message })
  }
  return readiness
}

function assertSchedule(schedule: BookingSchedule, parseErrors: Record<string, string>): void {
  const errors = { ...scheduleErrors(schedule), ...parseErrors }
  if (Object.keys(errors).length > 0) throw new DomainError('validation', 'Check the schedule.', errors)
}

function scheduleFrom(input: Pick<CreateBookingInput, 'bookingStart' | 'bookingEnd' | 'collectionDate' | 'expectedReturnDate'>): BookingSchedule {
  const { schedule, errors } = parseSchedule(input, env.APP_TIMEZONE)
  if (Object.keys(errors).length > 0) throw new DomainError('validation', 'Check the schedule.', errors)
  assertSchedule(schedule, {})
  return schedule
}

async function setKitAside(tx: Db, actor: Actor, kitId: string, bookingNumber: string, aside: boolean): Promise<void> {
  const kit = await tx.kit.findUniqueOrThrow({ where: { id: kitId }, select: { id: true, kitCode: true, status: true } })
  const target = aside ? KitStatus.RESERVED : KitStatus.AVAILABLE
  // Only move between AVAILABLE and RESERVED; anything else is owned elsewhere.
  if (aside && kit.status !== KitStatus.AVAILABLE) return
  if (!aside && kit.status !== KitStatus.RESERVED) return
  await tx.kit.update({ where: { id: kitId }, data: { status: target } })
  await recordAudit(tx, {
    action: AuditAction.KIT_STATUS_CHANGED,
    entityType: 'Kit',
    entityId: kitId,
    ...actorFields(actor),
    summary: aside ? `Kit ${kit.kitCode} set aside for ${bookingNumber} (Available → Reserved)` : `Kit ${kit.kitCode} released from ${bookingNumber} (Reserved → Available)`,
    previousValue: { status: kit.status },
    newValue: { status: target, bookingNumber },
  })
}

async function auditStatus(tx: Db, actor: Actor, booking: { id: string; bookingNumber: string }, from: BookingStatus, to: BookingStatus, detail?: string) {
  await recordAudit(tx, {
    action: AuditAction.BOOKING_STATUS_CHANGED,
    entityType: 'Booking',
    entityId: booking.id,
    ...actorFields(actor),
    summary: `${booking.bookingNumber} ${STATUS_LABEL[from]} → ${STATUS_LABEL[to]}`,
    previousValue: { status: from },
    newValue: { status: to },
    metadata: detail ? { detail } : undefined,
  })
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export interface CreatedBooking {
  id: string
  bookingNumber: string
  status: BookingStatus
}

export async function createBooking(db: Db, actor: Actor, input: CreateBookingInput): Promise<CreatedBooking> {
  return inTransaction(db, async (tx) => {
    const schedule = scheduleFrom(input)
    const editor = await requireBookableEditor(tx, input.editorId)
    const kit = await requireKit(tx, input.kitId)
    const engineer = await requireEngineer(tx, input.engineerId)
    const reserve = input.intent === 'reserve'
    if (reserve) await assertReservable(tx, kit.id, schedule)

    const bookingNumber = await nextNumber(tx, NumberScope.BOOKING)
    const status = reserve ? BookingStatus.RESERVED : BookingStatus.DRAFT

    let booking: { id: string }
    try {
      booking = await tx.booking.create({
        data: {
          bookingNumber,
          kitId: kit.id,
          editorId: editor.id,
          engineerId: engineer.id,
          status,
          bookingStart: schedule.bookingStart,
          bookingEnd: schedule.bookingEnd,
          collectionDate: schedule.collectionDate,
          expectedReturnDate: schedule.expectedReturnDate,
          purpose: nullIfEmpty(input.purpose),
          notes: nullIfEmpty(input.notes),
          checklistTemplateId: kit.defaultChecklistTemplateId,
          createdById: actor.id,
        },
        select: { id: true },
      })
    } catch (error) {
      throw translateBookingDbError(error) ?? error
    }

    await recordAudit(tx, {
      action: AuditAction.BOOKING_CREATED,
      entityType: 'Booking',
      entityId: booking.id,
      ...actorFields(actor),
      summary: `${bookingNumber} created as ${STATUS_LABEL[status]} for ${editor.fullName} on kit ${kit.kitCode}`,
      newValue: {
        bookingNumber,
        status,
        editor: editor.fullName,
        kit: kit.kitCode,
        engineer: engineer.fullName,
        bookingStart: schedule.bookingStart.toISOString(),
        bookingEnd: schedule.bookingEnd.toISOString(),
        collectionDate: schedule.collectionDate?.toISOString() ?? null,
        expectedReturnDate: schedule.expectedReturnDate.toISOString(),
        purpose: input.purpose ?? null,
      },
    })
    if (reserve) await auditStatus(tx, actor, { id: booking.id, bookingNumber }, BookingStatus.DRAFT, BookingStatus.RESERVED, 'Reserved on creation')

    return { id: booking.id, bookingNumber, status }
  })
}

// -----------------------------------------------------------------------------
// Transitions
// -----------------------------------------------------------------------------

async function requireLifecycle(tx: Db, id: string): Promise<BookingLifecycleContext> {
  const context = await getBookingLifecycleContext(tx, id)
  if (!context || context.deleted) throw new DomainError('not_found', 'Booking not found.')
  return context
}

function assertTransition(context: BookingLifecycleContext, to: BookingStatus): void {
  if (canTransition(context.status, to)) return
  const reason =
    context.status === BookingStatus.CANCELLED || context.status === BookingStatus.COMPLETED
      ? `${context.bookingNumber} is ${STATUS_LABEL[context.status].toLowerCase()} and cannot change.`
      : `${context.bookingNumber} is ${STATUS_LABEL[context.status].toLowerCase()}; it cannot be moved to ${STATUS_LABEL[to].toLowerCase()} here.`
  throw new DomainError('lifecycle', reason)
}

/** DRAFT → RESERVED: the editor, the kit's readiness and the window are all checked. */
export async function reserveBooking(db: Db, actor: Actor, id: string): Promise<void> {
  await inTransaction(db, async (tx) => {
    const context = await requireLifecycle(tx, id)
    assertTransition(context, BookingStatus.RESERVED)
    await requireBookableEditor(tx, context.editorId)
    await requireKit(tx, context.kitId)
    await assertReservable(tx, context.kitId, context, id)
    try {
      await tx.booking.update({ where: { id }, data: { status: BookingStatus.RESERVED, updatedById: actor.id } })
    } catch (error) {
      throw translateBookingDbError(error) ?? error
    }
    await auditStatus(tx, actor, context, context.status, BookingStatus.RESERVED)
  })
}

/** RESERVED → DRAFT: releases the kit for the window without cancelling. */
export async function returnToDraft(db: Db, actor: Actor, id: string): Promise<void> {
  await inTransaction(db, async (tx) => {
    const context = await requireLifecycle(tx, id)
    assertTransition(context, BookingStatus.DRAFT)
    await tx.booking.update({ where: { id }, data: { status: BookingStatus.DRAFT, updatedById: actor.id } })
    await auditStatus(tx, actor, context, context.status, BookingStatus.DRAFT, 'Reservation released; the window is open again')
  })
}

/** RESERVED → READY_FOR_HANDOVER: readiness re-checked, kit set aside. */
export async function markReadyForHandover(db: Db, actor: Actor, id: string): Promise<void> {
  await inTransaction(db, async (tx) => {
    const context = await requireLifecycle(tx, id)
    assertTransition(context, BookingStatus.READY_FOR_HANDOVER)
    await requireBookableEditor(tx, context.editorId)
    await assertReservable(tx, context.kitId, context, id)
    await tx.booking.update({ where: { id }, data: { status: BookingStatus.READY_FOR_HANDOVER, updatedById: actor.id } })
    await setKitAside(tx, actor, context.kitId, context.bookingNumber, true)
    await auditStatus(tx, actor, context, context.status, BookingStatus.READY_FOR_HANDOVER, 'Kit set aside for handover')
  })
}

/** READY_FOR_HANDOVER → RESERVED: the kit goes back on the shelf. */
export async function revertReadyForHandover(db: Db, actor: Actor, id: string): Promise<void> {
  await inTransaction(db, async (tx) => {
    const context = await requireLifecycle(tx, id)
    assertTransition(context, BookingStatus.RESERVED)
    await tx.booking.update({ where: { id }, data: { status: BookingStatus.RESERVED, updatedById: actor.id } })
    await setKitAside(tx, actor, context.kitId, context.bookingNumber, false)
    await auditStatus(tx, actor, context, context.status, BookingStatus.RESERVED, 'Handover preparation undone')
  })
}

export async function cancelBooking(db: Db, actor: Actor, id: string, input: CancelBookingInput): Promise<void> {
  await inTransaction(db, async (tx) => {
    const context = await requireLifecycle(tx, id)
    if (!isCancellable(context.status)) {
      const reason =
        context.status === BookingStatus.CANCELLED
          ? `${context.bookingNumber} is already cancelled.`
          : `${context.bookingNumber} is ${STATUS_LABEL[context.status].toLowerCase()} and cannot be cancelled here. ${
              context.status === BookingStatus.COMPLETED ? '' : 'Use the return workflow.'
            }`.trim()
      throw new DomainError('lifecycle', reason)
    }
    const now = new Date()
    await tx.booking.update({
      where: { id },
      data: { status: BookingStatus.CANCELLED, cancelledAt: now, cancelReason: input.reason, updatedById: actor.id },
    })
    if (context.status === BookingStatus.READY_FOR_HANDOVER) await setKitAside(tx, actor, context.kitId, context.bookingNumber, false)
    await recordAudit(tx, {
      action: AuditAction.BOOKING_CANCELLED,
      entityType: 'Booking',
      entityId: id,
      ...actorFields(actor),
      summary: `${context.bookingNumber} cancelled (was ${STATUS_LABEL[context.status].toLowerCase()}): ${input.reason}`,
      previousValue: { status: context.status },
      newValue: { status: BookingStatus.CANCELLED, cancelledAt: now.toISOString(), reason: input.reason },
      metadata: { detail: input.reason },
    })
  })
}

// -----------------------------------------------------------------------------
// Edit
// -----------------------------------------------------------------------------

export interface UpdatedBooking {
  id: string
  changed: string[]
}

/**
 * Edits within the lifecycle. DRAFT and RESERVED accept everything; a
 * reservation whose kit or window changes is re-validated for readiness and
 * overlap (excluding itself). READY_FOR_HANDOVER accepts engineer, purpose and
 * notes only. Anything later is read-only.
 */
export async function updateBooking(db: Db, actor: Actor, id: string, input: UpdateBookingInput): Promise<UpdatedBooking> {
  return inTransaction(db, async (tx) => {
    const context = await requireLifecycle(tx, id)
    const scope = editScopeFor(context.status)
    if (scope === 'none') throw new DomainError('lifecycle', `${context.bookingNumber} is ${STATUS_LABEL[context.status].toLowerCase()} and cannot be edited.`)

    const schedule = scheduleFrom(input)
    const engineer = await requireEngineer(tx, input.engineerId)

    const next = {
      editorId: input.editorId,
      kitId: input.kitId,
      engineerId: engineer.id,
      bookingStart: schedule.bookingStart,
      bookingEnd: schedule.bookingEnd,
      collectionDate: schedule.collectionDate,
      expectedReturnDate: schedule.expectedReturnDate,
      purpose: nullIfEmpty(input.purpose),
      notes: nullIfEmpty(input.notes),
    }
    const same = (a: Date | string | null, b: Date | string | null) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b)
    const changed = (Object.keys(next) as Array<keyof typeof next>).filter((field) => !same(next[field], context[field]))
    if (changed.length === 0) return { id, changed: [] }

    const structural = changed.filter((field) => field !== 'engineerId' && field !== 'purpose' && field !== 'notes')
    if (scope === 'restricted' && structural.length > 0) {
      const message = `${context.bookingNumber} is ready for handover; only the engineer, purpose and notes can change now. Revert it to reserved to change the ${structural.join(', ')}.`
      throw new DomainError('lifecycle', message, Object.fromEntries(structural.map((field) => [field, message])))
    }

    const editor = changed.includes('editorId') ? await requireBookableEditor(tx, input.editorId) : null
    const kit = changed.includes('kitId') ? await requireKit(tx, input.kitId) : null
    if (isHoldingStatus(context.status) && (changed.includes('kitId') || changed.includes('bookingStart') || changed.includes('bookingEnd'))) {
      await assertReservable(tx, input.kitId, schedule, id)
    }

    try {
      await tx.booking.update({
        where: { id },
        data: { ...next, checklistTemplateId: kit ? kit.defaultChecklistTemplateId : undefined, updatedById: actor.id },
      })
    } catch (error) {
      throw translateBookingDbError(error) ?? error
    }

    const previousValue: Record<string, string | null> = {}
    const newValue: Record<string, string | null> = {}
    for (const field of changed) {
      const before = context[field]
      const after = next[field]
      previousValue[field] = before instanceof Date ? before.toISOString() : before
      newValue[field] = after instanceof Date ? after.toISOString() : after
    }
    const parts: string[] = []
    if (changed.includes('engineerId')) parts.push(`engineer assigned: ${engineer.fullName}`)
    if (editor) parts.push(`editor changed to ${editor.fullName}`)
    if (kit) parts.push(`kit changed to ${kit.kitCode}`)
    const scheduleFields = changed.filter((field) => ['bookingStart', 'bookingEnd', 'collectionDate', 'expectedReturnDate'].includes(field))
    if (scheduleFields.length > 0) parts.push('schedule changed')
    if (changed.includes('purpose') || changed.includes('notes')) parts.push('details updated')

    await recordAudit(tx, {
      action: AuditAction.BOOKING_UPDATED,
      entityType: 'Booking',
      entityId: id,
      ...actorFields(actor),
      summary: `${context.bookingNumber} ${parts.join('; ')}`,
      previousValue,
      newValue,
      metadata: { changed },
    })

    return { id, changed }
  })
}

// -----------------------------------------------------------------------------
// Derived display state
// -----------------------------------------------------------------------------

export interface BookingTimeState {
  overdue: boolean
  dueSoon: boolean
}

export function bookingTimeState(row: { status: BookingStatus; expectedReturnDate: Date }, now: Date): BookingTimeState {
  return {
    overdue: isBookingOverdue(row.status, row.expectedReturnDate, now),
    dueSoon: isDueSoon(row.status, row.expectedReturnDate, now, DUE_SOON_HOURS),
  }
}

// -----------------------------------------------------------------------------
// Page loaders
// -----------------------------------------------------------------------------

export interface BookingWorkspaceRow extends BookingListRow, BookingTimeState {}

export interface BookingListPage {
  actor: Actor
  result: Omit<BookingListResult, 'rows'> & { rows: BookingWorkspaceRow[] }
  counts: Record<BookingListQuery['filter'], number>
  seesAll: boolean
  canCreate: boolean
}

export async function loadBookingList(query: Omit<BookingListQuery, 'now' | 'timeZone'> & { now?: Date }): Promise<BookingListPage> {
  const actor = await requirePermission(['booking.read', 'booking.readOwn'])
  const now = query.now ?? new Date()
  const full: BookingListQuery = { ...query, now, timeZone: env.APP_TIMEZONE }
  const [result, counts] = await Promise.all([listBookingsPage(prisma, actor, full), countBookingsByFilter(prisma, actor, now, env.APP_TIMEZONE)])
  return {
    actor,
    result: { ...result, rows: result.rows.map((row) => ({ ...row, ...bookingTimeState(row, now) })) },
    counts,
    seesAll: can(actor, 'booking.read'),
    canCreate: can(actor, 'booking.create'),
  }
}

export interface BookingWorkspace {
  actor: Actor
  booking: BookingDetail
  time: BookingTimeState
  /** The kit's readiness for this booking (structural rule), null when the kit read failed. */
  readiness: KitAvailability | null
  /** The kit's state right now, for the operational status panel. */
  kitNow: KitAvailability | null
  kit: KitDetail | null
  activity: BookingActivityEvent[]
  editScope: ReturnType<typeof editScopeFor>
  canUpdate: boolean
  canCancel: boolean
  canReserve: boolean
  canReturnToDraft: boolean
  canMarkReady: boolean
  canRevertReady: boolean
  canReadKit: boolean
  canReadEditor: boolean
  canReadAssets: boolean
}

export async function loadBookingWorkspace(db: Db, actor: Actor, id: string, now: Date = new Date()): Promise<BookingWorkspace | null> {
  const booking = await getBookingDetailForActor(db, actor, id)
  if (!booking) return null

  const [facts, kit, activity] = await Promise.all([
    getKitAvailabilityFacts(db, booking.kit.id),
    getKitDetail(db, booking.kit.id, { includeIssues: false }),
    getBookingActivity(db, id),
  ])

  const manage = can(actor, 'booking.update')
  const scope = editScopeFor(booking.status)
  return {
    actor,
    booking,
    time: bookingTimeState(booking, now),
    readiness: facts ? evaluateKitReadinessForBooking(facts) : null,
    kitNow: facts ? evaluateKitAvailability(facts, now) : null,
    kit,
    activity,
    editScope: scope,
    canUpdate: manage && scope !== 'none',
    canCancel: can(actor, 'booking.cancel') && isCancellable(booking.status),
    canReserve: manage && canTransition(booking.status, 'RESERVED') && booking.status === BookingStatus.DRAFT,
    canReturnToDraft: manage && booking.status === BookingStatus.RESERVED,
    canMarkReady: manage && booking.status === BookingStatus.RESERVED,
    canRevertReady: manage && booking.status === BookingStatus.READY_FOR_HANDOVER,
    canReadKit: can(actor, 'kit.read'),
    canReadEditor: can(actor, 'editor.read'),
    canReadAssets: can(actor, 'asset.read'),
  }
}

export interface EditorChoice {
  id: string
  fullName: string
  staffId: string | null
  isExternal: boolean
  contactNumber: string | null
  company: string | null
  department: string | null
  /** Why the editor cannot be booked; null when they can. */
  blocker: string | null
}

/** Active editors matching the term, each with the booking-eligibility verdict. */
export async function searchEditorsForBooking(db: Db, term: string): Promise<EditorChoice[]> {
  const rows = await searchActiveEditors(db, term, 10)
  return rows.map((row) => ({
    ...row,
    blocker: editorBookingBlocker({ fullName: row.fullName, staffId: row.staffId, isExternal: row.isExternal, isActive: true, deleted: false }),
  }))
}

export interface KitChoice extends KitCandidate {
  readiness: KitAvailability
  /** Live bookings that overlap the requested window, when a window was given. */
  conflicts: KitCandidate['upcoming']
}

/** Kits matching the term with their readiness and, given a window, the bookings in the way. */
export async function searchKitsForBooking(db: Db, term: string, window: { start: Date; end: Date } | null, now: Date = new Date()): Promise<KitChoice[]> {
  const candidates = await searchKitCandidates(db, term, now)
  return candidates.map((candidate) => ({
    ...candidate,
    readiness: evaluateKitReadinessForBooking(candidate.facts),
    conflicts: window
      ? candidate.upcoming.filter((booking) => rangesOverlap(booking.bookingStart, booking.bookingEnd, window.start, window.end))
      : [],
  }))
}

export async function loadEngineerOptions(db: Db): Promise<EngineerOption[]> {
  return listActiveEngineers(db)
}

export async function loadEditorChoice(db: Db, editorId: string): Promise<EditorChoice | null> {
  const editor = await getBookableEditor(db, editorId)
  if (!editor) return null
  return {
    id: editor.id,
    fullName: editor.fullName,
    staffId: editor.staffId,
    isExternal: editor.isExternal,
    contactNumber: editor.contactNumber,
    company: editor.company,
    department: editor.department,
    blocker: editorBookingBlocker(editor),
  }
}

export async function loadKitChoice(db: Db, kitId: string, window: { start: Date; end: Date } | null, excludeBookingId?: string): Promise<KitChoice | null> {
  const facts = await getKitAvailabilityFacts(db, kitId)
  if (!facts) return null
  const kit = await db.kit.findUnique({ where: { id: kitId }, select: { id: true, kitCode: true, name: true, admBarcode: true, status: true } })
  if (!kit) return null
  const conflicts = window ? await findOverlappingBookings(db, kitId, window.start, window.end, excludeBookingId) : []
  return {
    ...kit,
    facts,
    upcoming: [],
    readiness: evaluateKitReadinessForBooking(facts),
    conflicts: conflicts.map((booking) => ({
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
      bookingStart: booking.bookingStart,
      bookingEnd: booking.bookingEnd,
      editorName: booking.editorName,
    })),
  }
}
