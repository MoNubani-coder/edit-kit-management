import 'server-only'

import { AuditAction, IssueSeverity, IssueStatus, IssueType, NumberScope, type Prisma } from '@prisma/client'

import type { AssignIssueInput, CloseIssueInput, CreateIssueInput, InvestigateIssueInput, IssueFilter, IssueListParams, ReopenIssueInput, ResolveIssueInput, UpdateIssueInput } from '@/lib/validation/issues'
import { ISSUE_STATUS_LABELS } from '@/lib/validation/issues'
import { can } from '@/server/auth/permissions'
import { type Actor, requirePermission } from '@/server/auth/session'
import {
  type AssigneeOption,
  countIssuesByFilter,
  getIssueActivity,
  getIssueDetail,
  getIssueState,
  type IssueActivityEvent,
  type IssueDetail,
  type IssueListResult,
  listAssignableUsers,
  listIssuesPage,
} from '@/server/dal/issues.dal'
import { prisma, type Db } from '@/server/db/prisma'
import { recordAudit } from '@/server/services/audit.service'
import { DomainError } from '@/server/services/errors'
import { nextNumber } from '@/server/services/numbering.service'

/**
 * Issue management: the record of something wrong with equipment, from the
 * moment it is noticed to the moment it is done with.
 *
 * Most issues arrive on their own. A return that records a missing or damaged
 * item raises one itself (Phase 9), numbered from the same atomic counter as
 * everything else, already pointing at the asset, the kit, the booking and the
 * inspection that found it. This service is what happens next: someone picks it
 * up, says what they found, and closes it - and, when a problem turns up
 * outside a return, reports one by hand.
 *
 * Nothing here touches asset or kit status. An issue records a fact; putting
 * equipment back into service is the maintenance workflow's job, and a
 * deliberate decision by a person. Resolving an issue does not quietly make a
 * damaged asset available again.
 */

// -----------------------------------------------------------------------------
// Lifecycle rules (pure)
// -----------------------------------------------------------------------------

/**
 * Where an issue may go from where it is.
 *
 *  - anything open may be picked up, resolved, or closed outright (a report
 *    that turns out to be nothing still deserves a written reason);
 *  - a resolved issue may be closed, or reopened when the fix did not hold;
 *  - a closed issue may be reopened - the same fault coming back is the same
 *    issue, not a new one.
 */
export const ISSUE_TRANSITIONS: Record<IssueStatus, readonly IssueStatus[]> = {
  OPEN: [IssueStatus.UNDER_INVESTIGATION, IssueStatus.RESOLVED, IssueStatus.CLOSED],
  UNDER_INVESTIGATION: [IssueStatus.OPEN, IssueStatus.RESOLVED, IssueStatus.CLOSED],
  RESOLVED: [IssueStatus.CLOSED, IssueStatus.OPEN],
  CLOSED: [IssueStatus.OPEN],
}

export function canTransitionIssue(from: IssueStatus, to: IssueStatus): boolean {
  return ISSUE_TRANSITIONS[from].includes(to)
}

/** An issue that is finished is a record, not a working document. */
export function isIssueEditable(status: IssueStatus): boolean {
  return status === IssueStatus.OPEN || status === IssueStatus.UNDER_INVESTIGATION
}

export interface IssuePermissions {
  canReport: boolean
  canManage: boolean
  canAddPhoto: boolean
}

export function issuePermissionsFor(actor: Actor, status: IssueStatus): IssuePermissions {
  const manage = can(actor, 'issue.manage')
  return {
    canReport: can(actor, 'issue.create'),
    canManage: manage,
    // Evidence can be attached while the issue is live; a closed record is closed.
    canAddPhoto: manage && isIssueEditable(status),
  }
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

async function requireIssue(tx: Db, id: string) {
  const issue = await getIssueState(tx, id)
  if (!issue) throw new DomainError('not_found', 'Issue not found.')
  return issue
}

function assertTransition(issue: { issueNumber: string; status: IssueStatus }, to: IssueStatus): void {
  if (canTransitionIssue(issue.status, to)) return
  throw new DomainError(
    'lifecycle',
    `${issue.issueNumber} is ${ISSUE_STATUS_LABELS[issue.status].toLowerCase()}; it cannot be marked ${ISSUE_STATUS_LABELS[to].toLowerCase()} from there.`,
  )
}

/** Every link an issue carries must point at something that exists. */
async function resolveTargets(tx: Db, input: { assetId?: string; kitId?: string; bookingId?: string; accessoryId?: string }) {
  const [asset, kit, booking, accessory] = await Promise.all([
    input.assetId ? tx.asset.findFirst({ where: { id: input.assetId, deletedAt: null }, select: { id: true, assetCode: true, name: true } }) : null,
    input.kitId ? tx.kit.findFirst({ where: { id: input.kitId, deletedAt: null }, select: { id: true, kitCode: true } }) : null,
    input.bookingId ? tx.booking.findFirst({ where: { id: input.bookingId, deletedAt: null }, select: { id: true, bookingNumber: true } }) : null,
    input.accessoryId ? tx.accessory.findFirst({ where: { id: input.accessoryId, deletedAt: null }, select: { id: true, label: true, assetId: true } }) : null,
  ])

  if (input.assetId && !asset) throw new DomainError('validation', 'That equipment could not be found.', { assetId: 'That equipment could not be found.' })
  if (input.kitId && !kit) throw new DomainError('validation', 'That kit could not be found.', { kitId: 'That kit could not be found.' })
  if (input.bookingId && !booking) throw new DomainError('validation', 'That booking could not be found.', { bookingId: 'That booking could not be found.' })
  if (input.accessoryId && !accessory) throw new DomainError('validation', 'That accessory could not be found.', { accessoryId: 'That accessory could not be found.' })

  return { asset, kit, booking, accessory }
}

async function requireAssignee(tx: Db, userId: string) {
  const user = await tx.user.findFirst({
    where: { id: userId, deletedAt: null, status: 'ACTIVE', role: { in: ['ADMIN', 'ENGINEER'] } },
    select: { id: true, name: true },
  })
  if (!user) throw new DomainError('validation', 'Choose an active engineer or administrator.', { assignedToId: 'Choose an active engineer or administrator.' })
  return user
}

/** What the issue is about, in one phrase, for an audit summary. */
function subjectOf(links: { asset?: { assetCode: string } | null; kit?: { kitCode: string } | null; booking?: { bookingNumber: string } | null }): string {
  if (links.asset) return links.asset.assetCode
  if (links.kit) return `kit ${links.kit.kitCode}`
  if (links.booking) return links.booking.bookingNumber
  return 'no specific equipment'
}

// -----------------------------------------------------------------------------
// Reporting
// -----------------------------------------------------------------------------

export interface CreatedIssue {
  id: string
  issueNumber: string
}

/**
 * Reports a problem by hand: the path for something noticed on the shelf
 * rather than during a return.
 */
export async function createIssue(db: Db, actor: Actor, input: CreateIssueInput): Promise<CreatedIssue> {
  return inTransaction(db, async (tx) => {
    const links = await resolveTargets(tx, input)
    const assignee = input.assignedToId ? await requireAssignee(tx, input.assignedToId) : null

    // An accessory belongs to an asset: if only the accessory was named, the
    // asset is implied, so the issue shows up on the equipment page too.
    const assetId = links.asset?.id ?? links.accessory?.assetId ?? null

    const issueNumber = await nextNumber(tx, NumberScope.ISSUE)
    const issue = await tx.issue.create({
      data: {
        issueNumber,
        type: input.type as IssueType,
        severity: input.severity as IssueSeverity,
        status: IssueStatus.OPEN,
        title: input.title,
        description: input.description,
        assetId,
        accessoryId: links.accessory?.id ?? null,
        kitId: links.kit?.id ?? null,
        bookingId: links.booking?.id ?? null,
        reportedById: actor.id,
        assignedToId: assignee?.id ?? null,
      },
      select: { id: true, issueNumber: true },
    })

    await recordAudit(tx, {
      action: AuditAction.ISSUE_CREATED,
      entityType: 'Issue',
      entityId: issue.id,
      ...actorFields(actor),
      summary: `${issueNumber} reported by ${actor.name}: ${input.title} (${subjectOf(links)})`,
      newValue: { type: input.type, severity: input.severity, title: input.title, assignedTo: assignee?.name ?? null },
      metadata: { detail: 'Reported by hand', assetId, kitId: links.kit?.id ?? null, bookingId: links.booking?.id ?? null },
    })

    return issue
  })
}

// -----------------------------------------------------------------------------
// Editing and assignment
// -----------------------------------------------------------------------------

export async function updateIssue(db: Db, actor: Actor, id: string, input: UpdateIssueInput): Promise<void> {
  await inTransaction(db, async (tx) => {
    const issue = await requireIssue(tx, id)
    if (!isIssueEditable(issue.status)) {
      throw new DomainError('lifecycle', `${issue.issueNumber} is ${ISSUE_STATUS_LABELS[issue.status].toLowerCase()}; reopen it before changing what it says.`)
    }

    await tx.issue.update({
      where: { id },
      data: { type: input.type as IssueType, severity: input.severity as IssueSeverity, title: input.title, description: input.description },
    })

    await recordAudit(tx, {
      action: AuditAction.ISSUE_UPDATED,
      entityType: 'Issue',
      entityId: id,
      ...actorFields(actor),
      summary: `${issue.issueNumber} updated by ${actor.name}${issue.severity !== input.severity ? `: severity ${issue.severity.toLowerCase()} → ${input.severity.toLowerCase()}` : ''}`,
      previousValue: { severity: issue.severity, title: issue.title },
      newValue: { type: input.type, severity: input.severity, title: input.title },
      metadata: { detail: 'Details corrected' },
    })
  })
}

export async function assignIssue(db: Db, actor: Actor, id: string, input: AssignIssueInput): Promise<void> {
  await inTransaction(db, async (tx) => {
    const issue = await requireIssue(tx, id)
    if (!isIssueEditable(issue.status)) {
      throw new DomainError('lifecycle', `${issue.issueNumber} is ${ISSUE_STATUS_LABELS[issue.status].toLowerCase()}; there is nothing left to assign.`)
    }

    const assignee = input.assignedToId ? await requireAssignee(tx, input.assignedToId) : null
    if ((assignee?.id ?? null) === issue.assignedToId) return

    await tx.issue.update({ where: { id }, data: { assignedToId: assignee?.id ?? null } })
    await recordAudit(tx, {
      action: AuditAction.ISSUE_UPDATED,
      entityType: 'Issue',
      entityId: id,
      ...actorFields(actor),
      summary: assignee ? `${issue.issueNumber} assigned to ${assignee.name} by ${actor.name}` : `${issue.issueNumber} left unassigned by ${actor.name}`,
      newValue: { assignedToId: assignee?.id ?? null, assignedToName: assignee?.name ?? null },
      metadata: { detail: assignee ? 'Assigned' : 'Unassigned' },
    })
  })
}

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

/** Picks the issue up: someone is looking at it now. */
export async function startInvestigation(db: Db, actor: Actor, id: string, input: InvestigateIssueInput = {}): Promise<void> {
  await inTransaction(db, async (tx) => {
    const issue = await requireIssue(tx, id)
    assertTransition(issue, IssueStatus.UNDER_INVESTIGATION)

    // Picking something up without an owner assigns it to whoever did.
    const assignedToId = issue.assignedToId ?? actor.id
    await tx.issue.update({ where: { id }, data: { status: IssueStatus.UNDER_INVESTIGATION, assignedToId } })

    await recordAudit(tx, {
      action: AuditAction.ISSUE_UPDATED,
      entityType: 'Issue',
      entityId: id,
      ...actorFields(actor),
      summary: `${issue.issueNumber} being investigated by ${actor.name}${input.note ? `: ${input.note}` : ''}`,
      previousValue: { status: issue.status },
      newValue: { status: IssueStatus.UNDER_INVESTIGATION, assignedToId },
      metadata: { detail: 'Investigation started' },
    })
  })
}

/** Records what was done about it. */
export async function resolveIssue(db: Db, actor: Actor, id: string, input: ResolveIssueInput): Promise<void> {
  await inTransaction(db, async (tx) => {
    const issue = await requireIssue(tx, id)
    assertTransition(issue, IssueStatus.RESOLVED)
    const now = new Date()

    await tx.issue.update({
      where: { id },
      data: { status: IssueStatus.RESOLVED, resolution: input.resolution, resolvedAt: now, resolvedById: actor.id, closedAt: null },
    })

    await recordAudit(tx, {
      action: AuditAction.ISSUE_RESOLVED,
      entityType: 'Issue',
      entityId: id,
      ...actorFields(actor),
      summary: `${issue.issueNumber} resolved by ${actor.name}: ${input.resolution}`,
      previousValue: { status: issue.status },
      newValue: { status: IssueStatus.RESOLVED, resolution: input.resolution, resolvedAt: now.toISOString() },
      metadata: { detail: 'Resolved' },
    })
  })
}

/**
 * Closes it. A resolved issue closes as a formality; one that was never
 * resolved needs a written reason, because "closed without explanation" is how
 * a fault gets forgotten.
 */
export async function closeIssue(db: Db, actor: Actor, id: string, input: CloseIssueInput): Promise<void> {
  await inTransaction(db, async (tx) => {
    const issue = await requireIssue(tx, id)
    assertTransition(issue, IssueStatus.CLOSED)

    const wasResolved = issue.status === IssueStatus.RESOLVED
    const resolution = input.resolution ?? (wasResolved ? issue.resolution : null)
    if (!resolution) {
      const message = 'Say why it is being closed without a fix.'
      throw new DomainError('validation', message, { resolution: message })
    }

    const now = new Date()
    await tx.issue.update({
      where: { id },
      data: {
        status: IssueStatus.CLOSED,
        resolution,
        closedAt: now,
        // Closing something never resolved still records who decided that.
        resolvedAt: issue.status === IssueStatus.RESOLVED ? undefined : now,
        resolvedById: issue.status === IssueStatus.RESOLVED ? undefined : actor.id,
      },
    })

    await recordAudit(tx, {
      action: AuditAction.ISSUE_CLOSED,
      entityType: 'Issue',
      entityId: id,
      ...actorFields(actor),
      summary: wasResolved ? `${issue.issueNumber} closed by ${actor.name}` : `${issue.issueNumber} closed by ${actor.name} without a fix: ${resolution}`,
      previousValue: { status: issue.status },
      newValue: { status: IssueStatus.CLOSED, resolution, closedAt: now.toISOString() },
      metadata: { detail: wasResolved ? 'Closed' : 'Closed without a fix' },
    })
  })
}

/** The fault came back, or it was closed too soon. */
export async function reopenIssue(db: Db, actor: Actor, id: string, input: ReopenIssueInput): Promise<void> {
  await inTransaction(db, async (tx) => {
    const issue = await requireIssue(tx, id)
    assertTransition(issue, IssueStatus.OPEN)

    // The previous resolution stays on the record; only the timestamps that
    // say "this is finished" are cleared.
    await tx.issue.update({ where: { id }, data: { status: IssueStatus.OPEN, resolvedAt: null, resolvedById: null, closedAt: null } })

    await recordAudit(tx, {
      action: AuditAction.ISSUE_UPDATED,
      entityType: 'Issue',
      entityId: id,
      ...actorFields(actor),
      summary: `${issue.issueNumber} reopened by ${actor.name}: ${input.reason}`,
      previousValue: { status: issue.status, resolution: issue.resolution },
      newValue: { status: IssueStatus.OPEN, reason: input.reason },
      metadata: { detail: 'Reopened' },
    })
  })
}

// -----------------------------------------------------------------------------
// Page loaders
// -----------------------------------------------------------------------------

export interface IssueListPage {
  actor: Actor
  result: IssueListResult
  counts: Record<IssueFilter, number>
  canReport: boolean
  canManage: boolean
}

export async function loadIssueList(params: IssueListParams): Promise<IssueListPage> {
  const actor = await requirePermission('issue.read')
  const [result, counts] = await Promise.all([listIssuesPage(prisma, actor.id, params), countIssuesByFilter(prisma, actor.id)])
  return { actor, result, counts, canReport: can(actor, 'issue.create'), canManage: can(actor, 'issue.manage') }
}

export interface IssueWorkspace {
  actor: Actor
  issue: IssueDetail
  activity: IssueActivityEvent[]
  assignees: AssigneeOption[]
  permissions: IssuePermissions
  /** Statuses this issue may move to right now. */
  nextStatuses: IssueStatus[]
  canReadAsset: boolean
  canReadKit: boolean
  canReadBooking: boolean
}

export async function loadIssueWorkspace(db: Db, actor: Actor, id: string): Promise<IssueWorkspace | null> {
  const issue = await getIssueDetail(db, id)
  if (!issue) return null

  const permissions = issuePermissionsFor(actor, issue.status)
  const [activity, assignees] = await Promise.all([getIssueActivity(db, id), permissions.canManage ? listAssignableUsers(db) : Promise.resolve([])])

  return {
    actor,
    issue,
    activity,
    assignees,
    permissions,
    nextStatuses: permissions.canManage ? [...ISSUE_TRANSITIONS[issue.status]] : [],
    canReadAsset: can(actor, 'asset.read'),
    canReadKit: can(actor, 'kit.read'),
    canReadBooking: can(actor, 'booking.read'),
  }
}
