import 'server-only'

import { AuditAction, ChecklistPhase, UserRole, UserStatus } from '@prisma/client'

import type { ChecklistItemInput, ChecklistTemplateInput, SoftwareInput } from '@/lib/validation/admin'
import type { Actor } from '@/server/auth/session'
import type { Db } from '@/server/db/prisma'
import { recordAudit } from '@/server/services/audit.service'
import { DomainError, uniqueViolationField } from '@/server/services/errors'

/**
 * Administration writes: roles and lockouts, the software catalogue, and the
 * checklist templates.
 *
 * Three rules run through all of it.
 *
 *  - **A role change is a security event, so it revokes sessions.** Bumping
 *    `sessionVersion` means the JWT the user is holding stops being accepted
 *    on their next request (AD-2), so a demotion takes effect immediately
 *    rather than whenever they happen to sign in again. Suspension already
 *    worked this way; the role change now matches it.
 *  - **Nothing is deleted while something references it.** Software and
 *    templates are deactivated, which removes them from the pickers and
 *    changes nothing else, exactly as categories work. A checklist item can be
 *    removed only if no booking has copied it - and once one has, the copy is
 *    that booking's own record and is never touched.
 *  - **Every change is audited with a sentence a person can read**, because
 *    that sentence is what the audit log shows.
 */

function actorFields(actor: Actor) {
  return { actorUserId: actor.id, actorName: actor.name, actorRole: actor.role }
}

async function inTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  if ('$transaction' in db && typeof db.$transaction === 'function') return db.$transaction((tx) => fn(tx))
  return fn(db)
}

// -----------------------------------------------------------------------------
// Accounts
// -----------------------------------------------------------------------------

export async function setUserRole(db: Db, actor: Actor, userId: string, role: UserRole, reason?: string): Promise<{ id: string; role: UserRole }> {
  if (userId === actor.id) throw new DomainError('lifecycle', 'You cannot change your own role.')

  return inTransaction(db, async (tx) => {
    const target = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, email: true, name: true, role: true } })
    if (!target) throw new DomainError('not_found', 'Account not found.')
    if (target.role === role) return { id: target.id, role }

    // The last administrator must not be able to demote themselves out of
    // existence: somebody has to be able to grant the role back.
    if (target.role === UserRole.ADMIN && role !== UserRole.ADMIN) {
      const remaining = await tx.user.count({ where: { deletedAt: null, role: UserRole.ADMIN, status: UserStatus.ACTIVE, id: { not: target.id } } })
      if (remaining === 0) throw new DomainError('lifecycle', 'This is the last active administrator. Grant the role to somebody else first.')
    }

    await tx.user.update({
      where: { id: target.id },
      // A role change revokes every session this account holds (AD-2).
      data: { role, sessionVersion: { increment: 1 } },
    })

    await recordAudit(tx, {
      action: AuditAction.ROLE_CHANGED,
      entityType: 'User',
      entityId: target.id,
      ...actorFields(actor),
      summary: `${target.name} changed from ${target.role.toLowerCase()} to ${role.toLowerCase()}`,
      previousValue: { role: target.role },
      newValue: { role },
      metadata: reason ? { reason } : undefined,
    })

    return { id: target.id, role }
  })
}

/**
 * Clears a lockout after too many failed sign-ins, without changing the
 * account's status. The password is untouched: this says "let them try again",
 * not "let them in".
 */
export async function unlockUser(db: Db, actor: Actor, userId: string): Promise<{ id: string }> {
  return inTransaction(db, async (tx) => {
    const target = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, name: true, failedLoginAttempts: true, lockedUntil: true } })
    if (!target) throw new DomainError('not_found', 'Account not found.')
    if (!target.lockedUntil && target.failedLoginAttempts === 0) throw new DomainError('lifecycle', `${target.name} is not locked out.`)

    await tx.user.update({ where: { id: target.id }, data: { lockedUntil: null, failedLoginAttempts: 0 } })

    await recordAudit(tx, {
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: target.id,
      ...actorFields(actor),
      summary: `Lockout cleared for ${target.name}`,
      previousValue: { lockedUntil: target.lockedUntil, failedLoginAttempts: target.failedLoginAttempts },
      newValue: { lockedUntil: null, failedLoginAttempts: 0 },
    })

    return { id: target.id }
  })
}

// -----------------------------------------------------------------------------
// Software catalogue
// -----------------------------------------------------------------------------

function softwareConflict(error: unknown): DomainError | null {
  if (!uniqueViolationField(error)) return null
  const message = 'Another application already has this name and version.'
  return new DomainError('conflict', message, { name: message })
}

export async function createSoftware(db: Db, actor: Actor, input: SoftwareInput): Promise<{ id: string }> {
  return inTransaction(db, async (tx) => {
    let created: { id: string; name: string; version: string | null }
    try {
      created = await tx.softwareApplication.create({
        data: {
          name: input.name,
          vendor: input.vendor ?? null,
          version: input.version ?? null,
          licenseType: input.licenseType ?? null,
          notes: input.notes ?? null,
          sortOrder: input.sortOrder,
        },
        select: { id: true, name: true, version: true },
      })
    } catch (error) {
      throw softwareConflict(error) ?? error
    }

    await recordAudit(tx, {
      action: AuditAction.CREATE,
      entityType: 'SoftwareApplication',
      entityId: created.id,
      ...actorFields(actor),
      summary: `Software ${created.name}${created.version ? ` ${created.version}` : ''} added to the catalogue`,
      newValue: { name: input.name, vendor: input.vendor ?? null, version: input.version ?? null },
    })

    return { id: created.id }
  })
}

export async function updateSoftware(db: Db, actor: Actor, id: string, input: SoftwareInput): Promise<{ id: string }> {
  return inTransaction(db, async (tx) => {
    const current = await tx.softwareApplication.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, vendor: true, version: true, licenseType: true, notes: true, sortOrder: true },
    })
    if (!current) throw new DomainError('not_found', 'Application not found.')

    const next = {
      name: input.name,
      vendor: input.vendor ?? null,
      version: input.version ?? null,
      licenseType: input.licenseType ?? null,
      notes: input.notes ?? null,
      sortOrder: input.sortOrder,
    }

    try {
      await tx.softwareApplication.update({ where: { id }, data: next })
    } catch (error) {
      throw softwareConflict(error) ?? error
    }

    await recordAudit(tx, {
      action: AuditAction.UPDATE,
      entityType: 'SoftwareApplication',
      entityId: id,
      ...actorFields(actor),
      summary: `Software ${next.name}${next.version ? ` ${next.version}` : ''} updated`,
      previousValue: { name: current.name, vendor: current.vendor, version: current.version, licenseType: current.licenseType, sortOrder: current.sortOrder },
      newValue: next,
    })

    return { id }
  })
}

export async function setSoftwareActive(db: Db, actor: Actor, id: string, isActive: boolean): Promise<{ id: string; isActive: boolean }> {
  return inTransaction(db, async (tx) => {
    const current = await tx.softwareApplication.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true, version: true, isActive: true } })
    if (!current) throw new DomainError('not_found', 'Application not found.')
    if (current.isActive === isActive) return { id, isActive }

    await tx.softwareApplication.update({ where: { id }, data: { isActive } })

    await recordAudit(tx, {
      action: AuditAction.UPDATE,
      entityType: 'SoftwareApplication',
      entityId: id,
      ...actorFields(actor),
      summary: `Software ${current.name}${current.version ? ` ${current.version}` : ''} ${isActive ? 'activated' : 'deactivated'}`,
      previousValue: { isActive: current.isActive },
      newValue: { isActive },
    })

    return { id, isActive }
  })
}

// -----------------------------------------------------------------------------
// Checklist templates
// -----------------------------------------------------------------------------

function templateConflict(error: unknown): DomainError | null {
  if (!uniqueViolationField(error)) return null
  const message = 'Another template already has this name.'
  return new DomainError('conflict', message, { name: message })
}

export async function createChecklistTemplate(db: Db, actor: Actor, input: ChecklistTemplateInput): Promise<{ id: string }> {
  return inTransaction(db, async (tx) => {
    let created: { id: string; name: string }
    try {
      created = await tx.checklistTemplate.create({
        data: { name: input.name, description: input.description ?? null },
        select: { id: true, name: true },
      })
    } catch (error) {
      throw templateConflict(error) ?? error
    }

    await recordAudit(tx, {
      action: AuditAction.CREATE,
      entityType: 'ChecklistTemplate',
      entityId: created.id,
      ...actorFields(actor),
      summary: `Checklist template ${created.name} created`,
      newValue: { name: input.name },
    })

    return { id: created.id }
  })
}

export async function updateChecklistTemplate(db: Db, actor: Actor, id: string, input: ChecklistTemplateInput): Promise<{ id: string }> {
  return inTransaction(db, async (tx) => {
    const current = await tx.checklistTemplate.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true, description: true } })
    if (!current) throw new DomainError('not_found', 'Template not found.')

    try {
      await tx.checklistTemplate.update({ where: { id }, data: { name: input.name, description: input.description ?? null } })
    } catch (error) {
      throw templateConflict(error) ?? error
    }

    await recordAudit(tx, {
      action: AuditAction.UPDATE,
      entityType: 'ChecklistTemplate',
      entityId: id,
      ...actorFields(actor),
      summary: `Checklist template ${input.name} updated`,
      previousValue: { name: current.name, description: current.description },
      newValue: { name: input.name, description: input.description ?? null },
    })

    return { id }
  })
}

export async function setChecklistTemplateActive(db: Db, actor: Actor, id: string, isActive: boolean): Promise<{ id: string; isActive: boolean }> {
  return inTransaction(db, async (tx) => {
    const current = await tx.checklistTemplate.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true, isActive: true, isDefault: true } })
    if (!current) throw new DomainError('not_found', 'Template not found.')
    if (current.isActive === isActive) return { id, isActive }
    if (!isActive && current.isDefault) throw new DomainError('lifecycle', 'This is the default template. Make another template the default first.')

    await tx.checklistTemplate.update({ where: { id }, data: { isActive } })

    await recordAudit(tx, {
      action: AuditAction.UPDATE,
      entityType: 'ChecklistTemplate',
      entityId: id,
      ...actorFields(actor),
      summary: `Checklist template ${current.name} ${isActive ? 'activated' : 'deactivated'}`,
      previousValue: { isActive: current.isActive },
      newValue: { isActive },
    })

    return { id, isActive }
  })
}

/** Exactly one template is the default; making one the default clears the rest. */
export async function setChecklistTemplateDefault(db: Db, actor: Actor, id: string): Promise<{ id: string }> {
  return inTransaction(db, async (tx) => {
    const current = await tx.checklistTemplate.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true, isDefault: true, isActive: true } })
    if (!current) throw new DomainError('not_found', 'Template not found.')
    if (!current.isActive) throw new DomainError('lifecycle', 'Activate the template before making it the default.')
    if (current.isDefault) return { id }

    await tx.checklistTemplate.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
    await tx.checklistTemplate.update({ where: { id }, data: { isDefault: true } })

    await recordAudit(tx, {
      action: AuditAction.UPDATE,
      entityType: 'ChecklistTemplate',
      entityId: id,
      ...actorFields(actor),
      summary: `Checklist template ${current.name} is now the default`,
      previousValue: { isDefault: false },
      newValue: { isDefault: true },
    })

    return { id }
  })
}

export async function addChecklistItem(db: Db, actor: Actor, templateId: string, input: ChecklistItemInput): Promise<{ id: string }> {
  return inTransaction(db, async (tx) => {
    const template = await tx.checklistTemplate.findFirst({ where: { id: templateId, deletedAt: null }, select: { id: true, name: true } })
    if (!template) throw new DomainError('not_found', 'Template not found.')

    const created = await tx.checklistTemplateItem.create({
      data: {
        templateId,
        label: input.label,
        description: input.description ?? null,
        phase: input.phase as ChecklistPhase,
        isRequired: input.isRequired,
        sortOrder: input.sortOrder,
      },
      select: { id: true, label: true },
    })

    await recordAudit(tx, {
      action: AuditAction.KIT_CHECKLIST_CHANGED,
      entityType: 'ChecklistTemplate',
      entityId: templateId,
      ...actorFields(actor),
      summary: `Check "${created.label}" added to ${template.name}`,
      newValue: { label: input.label, phase: input.phase, isRequired: input.isRequired },
    })

    return { id: created.id }
  })
}

export async function updateChecklistItem(db: Db, actor: Actor, itemId: string, input: ChecklistItemInput): Promise<{ id: string; templateId: string }> {
  return inTransaction(db, async (tx) => {
    const current = await tx.checklistTemplateItem.findUnique({
      where: { id: itemId },
      select: { id: true, templateId: true, label: true, description: true, phase: true, isRequired: true, sortOrder: true, template: { select: { name: true, deletedAt: true } } },
    })
    if (!current || current.template.deletedAt) throw new DomainError('not_found', 'Check not found.')

    await tx.checklistTemplateItem.update({
      where: { id: itemId },
      data: {
        label: input.label,
        description: input.description ?? null,
        phase: input.phase as ChecklistPhase,
        isRequired: input.isRequired,
        sortOrder: input.sortOrder,
      },
    })

    await recordAudit(tx, {
      action: AuditAction.KIT_CHECKLIST_CHANGED,
      entityType: 'ChecklistTemplate',
      entityId: current.templateId,
      ...actorFields(actor),
      summary: `Check "${input.label}" updated in ${current.template.name}`,
      previousValue: { label: current.label, phase: current.phase, isRequired: current.isRequired, sortOrder: current.sortOrder },
      newValue: { label: input.label, phase: input.phase, isRequired: input.isRequired, sortOrder: input.sortOrder },
    })

    return { id: itemId, templateId: current.templateId }
  })
}

/**
 * Removes a check from a template. Refused once a booking has copied it: the
 * copy belongs to that booking's record, and a template whose items have been
 * used should be edited forward, not rewritten backwards.
 */
export async function removeChecklistItem(db: Db, actor: Actor, itemId: string): Promise<{ templateId: string }> {
  return inTransaction(db, async (tx) => {
    const current = await tx.checklistTemplateItem.findUnique({
      where: { id: itemId },
      select: { id: true, templateId: true, label: true, template: { select: { name: true, deletedAt: true } }, _count: { select: { bookingItems: true } } },
    })
    if (!current || current.template.deletedAt) throw new DomainError('not_found', 'Check not found.')
    if (current._count.bookingItems > 0) {
      throw new DomainError('lifecycle', `"${current.label}" has already been used on ${current._count.bookingItems} ${current._count.bookingItems === 1 ? 'booking' : 'bookings'} and cannot be removed. Edit it instead.`)
    }

    await tx.checklistTemplateItem.delete({ where: { id: itemId } })

    await recordAudit(tx, {
      action: AuditAction.KIT_CHECKLIST_CHANGED,
      entityType: 'ChecklistTemplate',
      entityId: current.templateId,
      ...actorFields(actor),
      summary: `Check "${current.label}" removed from ${current.template.name}`,
      previousValue: { label: current.label },
    })

    return { templateId: current.templateId }
  })
}
