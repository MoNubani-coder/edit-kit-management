import 'server-only'

import { AuditAction, type Prisma, UserStatus } from '@prisma/client'

import type { CreateEditorInput, EditorActiveInput, UpdateEditorInput } from '@/lib/validation/editors'
import { can } from '@/server/auth/permissions'
import { type Actor, requirePermission } from '@/server/auth/session'
import {
  countEditorsByView,
  type EditorActivityEvent,
  type EditorBookingsResult,
  type EditorDetail,
  type EditorIssueRow,
  type EditorLifecycleContext,
  type EditorListQuery,
  type EditorListResult,
  type EditorPickerRow,
  type EditorViewCounts,
  findEditorIdByStaffId,
  getEditorActivity,
  getEditorDetail,
  getEditorLifecycleContext,
  getUserLinkFacts,
  type LinkableUser,
  listEditorBookings,
  listEditorIssues,
  listEditors,
  listLinkableUsers,
  searchActiveEditors,
  type UserLinkFacts,
} from '@/server/dal/editors.dal'
import { prisma, type Db } from '@/server/db/prisma'
import { recordAudit } from '@/server/services/audit.service'
import { DomainError, uniqueViolationField } from '@/server/services/errors'

/**
 * Editor profile business rules.
 *
 * The profile is the identity every booking, handover and signature points
 * at. It is never destroyed once it has history; it is deactivated
 * (`isActive = false`) so it stops appearing in pickers while every past
 * booking keeps its editor. External editors have no account. Internal
 * editors may be linked to one User - optional, one-to-one, audited - and
 * that link is what gives a signed-in EDITOR their own bookings
 * (`booking.readOwn`); it is never a route to the editor directory.
 */

// -----------------------------------------------------------------------------
// Rules
// -----------------------------------------------------------------------------

/** Why the editor cannot be removed from the directory, or null. */
export function editorRemovalBlocker(context: EditorLifecycleContext): string | null {
  if (context.deleted) return 'This editor has already been removed.'
  if (context.totalBookingCount > 0 || context.signatureCount > 0)
    return 'An editor with booking or signature history cannot be removed. Deactivate the profile instead; its history stays readable.'
  return null
}

/** Why the editor cannot be deactivated right now, or null. */
export function editorDeactivationBlocker(context: EditorLifecycleContext): string | null {
  if (context.deleted) return 'This editor has been removed.'
  if (context.activeBookingCount > 0)
    return `The editor has ${context.activeBookingCount} live ${context.activeBookingCount === 1 ? 'booking' : 'bookings'}. Complete or cancel them before deactivating.`
  return null
}

/**
 * Why `user` cannot be linked to this editor, or null. Only internal editors
 * carry an account; the account must be live and not disabled, and must not
 * already belong to another editor (also enforced by the unique `userId`).
 */
export function userLinkBlocker(editor: Pick<EditorLifecycleContext, 'deleted' | 'isExternal' | 'userId'>, editorId: string, user: UserLinkFacts): string | null {
  if (editor.deleted) return 'This editor has been removed.'
  if (editor.isExternal) return 'External editors do not have accounts. Change the editor type to internal before linking one.'
  if (editor.userId && editor.userId !== user.id) return 'This editor is already linked to an account. Unlink it first.'
  if (user.deleted) return 'That user account has been deleted.'
  if (user.status === UserStatus.DISABLED) return 'That user account is disabled and cannot be linked.'
  if (user.linkedEditor && user.linkedEditor.id !== editorId) return `${user.name} is already linked to editor ${user.linkedEditor.fullName}.`
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

const UNIQUE_MESSAGES: Record<string, { field: string; message: string }> = {
  staffId: { field: 'staffId', message: 'This staff ID is already used by another editor.' },
  userId: { field: 'userId', message: 'This user account is already linked to another editor.' },
}

function conflictFrom(error: unknown): DomainError | null {
  const field = uniqueViolationField(error)
  if (!field) return null
  const mapped = UNIQUE_MESSAGES[field] ?? { field, message: 'This value is already used by another editor.' }
  return new DomainError('conflict', mapped.message, { [mapped.field]: mapped.message })
}

function actorFields(actor: Actor) {
  return { actorUserId: actor.id, actorName: actor.name, actorRole: actor.role }
}

const nullIfEmpty = (value: string | undefined): string | null => value ?? null

function editorLabel(editor: { fullName: string; staffId: string | null }): string {
  return editor.staffId ? `${editor.fullName} (${editor.staffId})` : editor.fullName
}

async function requireLinkableUser(tx: Db, editorId: string, editor: Pick<EditorLifecycleContext, 'deleted' | 'isExternal' | 'userId'>, userId: string): Promise<UserLinkFacts> {
  const user = await getUserLinkFacts(tx, userId)
  if (!user) throw new DomainError('not_found', 'User account not found.', { userId: 'User account not found.' })
  const blocker = userLinkBlocker(editor, editorId, user)
  if (blocker) throw new DomainError(user.linkedEditor ? 'conflict' : 'lifecycle', blocker, { userId: blocker })
  return user
}

// -----------------------------------------------------------------------------
// Mutations
// -----------------------------------------------------------------------------

export async function createEditor(db: Db, actor: Actor, input: CreateEditorInput): Promise<{ id: string }> {
  return inTransaction(db, async (tx) => {
    const isExternal = input.type === 'EXTERNAL'
    if (input.userId && isExternal) {
      const message = 'External editors do not have accounts. Choose Internal to link one.'
      throw new DomainError('validation', message, { userId: message })
    }
    const user = input.userId ? await requireLinkableUser(tx, '', { deleted: false, isExternal, userId: null }, input.userId) : null

    let editor: { id: string; fullName: string; staffId: string | null }
    try {
      editor = await tx.editorProfile.create({
        data: {
          fullName: input.fullName,
          staffId: nullIfEmpty(input.staffId),
          email: nullIfEmpty(input.email),
          contactNumber: nullIfEmpty(input.contactNumber),
          department: nullIfEmpty(input.department),
          company: nullIfEmpty(input.company),
          notes: nullIfEmpty(input.notes),
          isExternal,
          isActive: input.isActive,
          userId: user?.id ?? null,
        },
        select: { id: true, fullName: true, staffId: true },
      })
    } catch (error) {
      throw conflictFrom(error) ?? error
    }

    await recordAudit(tx, {
      action: AuditAction.CREATE,
      entityType: 'EditorProfile',
      entityId: editor.id,
      ...actorFields(actor),
      summary: `${isExternal ? 'External' : 'Internal'} editor ${editorLabel(editor)} added`,
      newValue: {
        fullName: input.fullName,
        staffId: input.staffId ?? null,
        type: input.type,
        email: input.email ?? null,
        contactNumber: input.contactNumber ?? null,
        company: input.company ?? null,
        department: input.department ?? null,
        isActive: input.isActive,
      },
    })

    if (user) {
      await recordAudit(tx, {
        action: AuditAction.EDITOR_USER_LINKED,
        entityType: 'EditorProfile',
        entityId: editor.id,
        ...actorFields(actor),
        summary: `Editor ${editorLabel(editor)} linked to account ${user.name}`,
        newValue: { userId: user.id, userName: user.name, role: user.role },
      })
    }

    return { id: editor.id }
  })
}

const EDITABLE_FIELDS = ['fullName', 'staffId', 'email', 'contactNumber', 'department', 'company', 'isExternal', 'notes'] as const

export async function updateEditor(db: Db, actor: Actor, id: string, input: UpdateEditorInput): Promise<{ id: string }> {
  return inTransaction(db, async (tx) => {
    const current = await tx.editorProfile.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, fullName: true, staffId: true, email: true, contactNumber: true, department: true, company: true, isExternal: true, notes: true, userId: true },
    })
    if (!current) throw new DomainError('not_found', 'Editor not found.')

    const next = {
      fullName: input.fullName,
      staffId: nullIfEmpty(input.staffId),
      email: nullIfEmpty(input.email),
      contactNumber: nullIfEmpty(input.contactNumber),
      department: nullIfEmpty(input.department),
      company: nullIfEmpty(input.company),
      isExternal: input.type === 'EXTERNAL',
      notes: nullIfEmpty(input.notes),
    }

    if (next.isExternal && !current.isExternal && current.userId) {
      const message = 'Unlink the user account before making this editor external.'
      throw new DomainError('lifecycle', message, { type: message })
    }

    const changed = EDITABLE_FIELDS.filter((field) => current[field] !== next[field])
    if (changed.length === 0) return { id }

    try {
      await tx.editorProfile.update({ where: { id }, data: next })
    } catch (error) {
      throw conflictFrom(error) ?? error
    }

    const pick = (source: typeof next | typeof current) =>
      Object.fromEntries(changed.map((field) => [field, source[field]])) as Prisma.InputJsonObject
    await recordAudit(tx, {
      action: AuditAction.UPDATE,
      entityType: 'EditorProfile',
      entityId: id,
      ...actorFields(actor),
      summary: `Editor ${editorLabel(next)} details updated (${changed.map((field) => (field === 'isExternal' ? 'type' : field)).join(', ')})`,
      previousValue: pick(current),
      newValue: pick(next),
    })

    return { id }
  })
}

export async function setEditorActive(db: Db, actor: Actor, id: string, input: EditorActiveInput): Promise<{ id: string; changed: boolean }> {
  return inTransaction(db, async (tx) => {
    const editor = await tx.editorProfile.findFirst({ where: { id, deletedAt: null }, select: { id: true, fullName: true, staffId: true, isActive: true } })
    if (!editor) throw new DomainError('not_found', 'Editor not found.')
    if (editor.isActive === input.isActive) return { id, changed: false }

    if (!input.isActive) {
      const context = await getEditorLifecycleContext(tx, id)
      const blocker = context ? editorDeactivationBlocker(context) : 'Editor not found.'
      if (blocker) throw new DomainError('lifecycle', blocker)
    }

    await tx.editorProfile.update({ where: { id }, data: { isActive: input.isActive } })
    await recordAudit(tx, {
      action: AuditAction.EDITOR_STATUS_CHANGED,
      entityType: 'EditorProfile',
      entityId: id,
      ...actorFields(actor),
      summary: `Editor ${editorLabel(editor)} ${input.isActive ? 'reactivated' : 'deactivated'}${input.reason ? ` · ${input.reason}` : ''}`,
      previousValue: { isActive: editor.isActive },
      newValue: { isActive: input.isActive, reason: input.reason ?? null },
    })

    return { id, changed: true }
  })
}

export async function linkEditorUser(db: Db, actor: Actor, editorId: string, userId: string): Promise<{ id: string }> {
  return inTransaction(db, async (tx) => {
    const editor = await tx.editorProfile.findFirst({
      where: { id: editorId, deletedAt: null },
      select: { id: true, fullName: true, staffId: true, isExternal: true, userId: true },
    })
    if (!editor) throw new DomainError('not_found', 'Editor not found.')
    if (editor.userId === userId) return { id: editorId }

    const user = await requireLinkableUser(tx, editorId, { deleted: false, isExternal: editor.isExternal, userId: editor.userId }, userId)

    try {
      await tx.editorProfile.update({ where: { id: editorId }, data: { userId: user.id } })
    } catch (error) {
      throw conflictFrom(error) ?? error
    }

    await recordAudit(tx, {
      action: AuditAction.EDITOR_USER_LINKED,
      entityType: 'EditorProfile',
      entityId: editorId,
      ...actorFields(actor),
      summary: `Editor ${editorLabel(editor)} linked to account ${user.name}`,
      newValue: { userId: user.id, userName: user.name, role: user.role },
    })

    return { id: editorId }
  })
}

export async function unlinkEditorUser(db: Db, actor: Actor, editorId: string): Promise<{ id: string }> {
  return inTransaction(db, async (tx) => {
    const editor = await tx.editorProfile.findFirst({
      where: { id: editorId, deletedAt: null },
      select: { id: true, fullName: true, staffId: true, user: { select: { id: true, name: true } } },
    })
    if (!editor) throw new DomainError('not_found', 'Editor not found.')
    if (!editor.user) return { id: editorId }

    await tx.editorProfile.update({ where: { id: editorId }, data: { userId: null } })
    await recordAudit(tx, {
      action: AuditAction.EDITOR_USER_UNLINKED,
      entityType: 'EditorProfile',
      entityId: editorId,
      ...actorFields(actor),
      summary: `Editor ${editorLabel(editor)} unlinked from account ${editor.user.name}`,
      previousValue: { userId: editor.user.id, userName: editor.user.name },
    })

    return { id: editorId }
  })
}

/** Soft delete, and only for a profile with no history at all. */
export async function removeEditor(db: Db, actor: Actor, id: string): Promise<void> {
  await inTransaction(db, async (tx) => {
    const editor = await tx.editorProfile.findUnique({ where: { id }, select: { id: true, fullName: true, staffId: true } })
    if (!editor) throw new DomainError('not_found', 'Editor not found.')

    const context = await getEditorLifecycleContext(tx, id)
    const blocker = context ? editorRemovalBlocker(context) : 'Editor not found.'
    if (blocker) throw new DomainError('lifecycle', blocker)

    await tx.editorProfile.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, userId: null } })
    await recordAudit(tx, {
      action: AuditAction.DELETE,
      entityType: 'EditorProfile',
      entityId: id,
      ...actorFields(actor),
      summary: `Editor ${editorLabel(editor)} removed from the directory`,
    })
  })
}

// -----------------------------------------------------------------------------
// Page loaders (authorise, then read)
// -----------------------------------------------------------------------------

export interface EditorListPage {
  actor: Actor
  result: EditorListResult
  counts: EditorViewCounts
  /** Set when the search term is exactly one editor's staff id. */
  matchedEditorId: string | null
}

export async function loadEditorList(query: EditorListQuery): Promise<EditorListPage> {
  const actor = await requirePermission('editor.read')
  const [result, counts, matchedEditorId] = await Promise.all([
    listEditors(prisma, query),
    countEditorsByView(prisma),
    query.search ? findEditorIdByStaffId(prisma, query.search) : Promise.resolve(null),
  ])
  return { actor, result, counts, matchedEditorId }
}

export interface EditorWorkspace {
  actor: Actor
  editor: EditorDetail
  lifecycle: EditorLifecycleContext
  canManage: boolean
  canReadIssues: boolean
  removalBlocker: string | null
  deactivationBlocker: string | null
}

export async function loadEditorWorkspace(db: Db, actor: Actor, id: string): Promise<EditorWorkspace | null> {
  const [editor, lifecycle] = await Promise.all([getEditorDetail(db, id), getEditorLifecycleContext(db, id)])
  if (!editor || !lifecycle) return null
  return {
    actor,
    editor,
    lifecycle,
    canManage: can(actor, 'editor.manage'),
    canReadIssues: can(actor, 'issue.read'),
    removalBlocker: editorRemovalBlocker(lifecycle),
    deactivationBlocker: editor.isActive ? editorDeactivationBlocker(lifecycle) : null,
  }
}

export async function loadEditorBookings(db: Db, editorId: string, scope: 'active' | 'history', page: number): Promise<EditorBookingsResult> {
  return listEditorBookings(db, editorId, { scope, page, pageSize: 25 })
}

export async function loadEditorIssues(db: Db, editorId: string): Promise<EditorIssueRow[]> {
  return listEditorIssues(db, editorId)
}

export async function loadEditorActivity(db: Db, editorId: string): Promise<EditorActivityEvent[]> {
  return getEditorActivity(db, editorId)
}

export async function loadLinkableUsers(db: Db): Promise<LinkableUser[]> {
  return listLinkableUsers(db)
}

/**
 * The editor picker for bookings (Phase 7): active editors by name, staff id
 * or contact number, exact staff id first. Requires `editor.read` when called
 * from a request; the DAL function itself is permission-free for services.
 */
export async function searchEditorsForPicker(db: Db, term: string, limit = 10): Promise<EditorPickerRow[]> {
  return searchActiveEditors(db, term, limit)
}
