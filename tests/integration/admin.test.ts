import { randomUUID } from 'node:crypto'

import { ChecklistPhase, UserRole, UserStatus } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { PAGE_SIZE_MAX, PAGE_SIZE_MIN } from '@/lib/pagination'
import {
  CHECKLIST_PHASE_LABELS,
  CHECKLIST_PHASES,
  parseUserListParams,
  USER_DEFAULT_PAGE_SIZE,
  USER_ROLES,
  USER_STATUS_LABELS,
  USER_STATUSES,
  usersHref,
} from '@/lib/validation/admin'
import { countUsersByFilter, getChecklistTemplate, getUserForAdmin, listChecklistTemplates, listSettings, listSoftware, listUsersPage } from '@/server/dal/admin.dal'
import type { Db } from '@/server/db/prisma'
import {
  addChecklistItem,
  createChecklistTemplate,
  createSoftware,
  removeChecklistItem,
  setChecklistTemplateActive,
  setChecklistTemplateDefault,
  setSoftwareActive,
  setUserRole,
  unlockUser,
  updateChecklistItem,
  updateChecklistTemplate,
  updateSoftware,
} from '@/server/services/admin.service'

import { actorFor, createTestUser, withRollback } from '../helpers/db'

/**
 * The three Administration areas that were placeholders: accounts, the
 * software catalogue and the checklist templates.
 *
 * Everything runs against the real database inside rolled-back transactions.
 * What is being checked is the part a screen cannot be trusted with: that a
 * role change revokes sessions, that the last administrator cannot demote
 * themselves, that nothing is deleted while something references it, and that
 * an account row never carries its password hash out of the data layer.
 */

const tag = () => randomUUID().slice(0, 8).toUpperCase()
const NOW = new Date('2044-07-01T08:00:00.000Z')

const listParams = (overrides: Partial<ReturnType<typeof parseUserListParams>> = {}) => ({
  filter: 'all' as const,
  sort: 'name' as const,
  dir: 'asc' as const,
  page: 1,
  pageSize: USER_DEFAULT_PAGE_SIZE,
  ...overrides,
})

// -----------------------------------------------------------------------------
// Accounts
// -----------------------------------------------------------------------------

describe('the accounts list', () => {
  it('never carries a password hash out of the data layer', async () => {
    await withRollback(async (tx) => {
      const user = await createTestUser(tx, { role: UserRole.ENGINEER, tag: `adm-${tag()}` })
      const page = await listUsersPage(tx, listParams({ q: user.email }), NOW)

      expect(page.rows).toHaveLength(1)
      const row = page.rows[0]
      expect(row).not.toHaveProperty('passwordHash')
      expect(row).not.toHaveProperty('sessionVersion')
      expect(JSON.stringify(page)).not.toContain('$2b$')
      // What it does say is whether a password exists at all.
      expect(row.hasPassword).toBe(true)
    })
  })

  it('says when an account has no password rather than pretending it has one', async () => {
    await withRollback(async (tx) => {
      const user = await createTestUser(tx, { role: UserRole.VIEWER, password: null, tag: `adm-${tag()}` })
      const page = await listUsersPage(tx, listParams({ q: user.email }), NOW)
      expect(page.rows[0].hasPassword).toBe(false)
    })
  })

  it('searches by name, email and staff ID', async () => {
    await withRollback(async (tx) => {
      const user = await createTestUser(tx, { role: UserRole.ENGINEER, tag: `adm-${tag()}` })
      const staffId = `STAFF-${tag()}`
      await tx.user.update({ where: { id: user.id }, data: { staffId } })

      expect((await listUsersPage(tx, listParams({ q: user.email }), NOW)).total).toBe(1)
      expect((await listUsersPage(tx, listParams({ q: user.name }), NOW)).total).toBe(1)
      expect((await listUsersPage(tx, listParams({ q: staffId }), NOW)).total).toBe(1)
    })
  })

  it('filters by role and by status', async () => {
    await withRollback(async (tx) => {
      const marker = tag()
      const engineer = await createTestUser(tx, { role: UserRole.ENGINEER, tag: `adm-${marker}` })
      const viewer = await createTestUser(tx, { role: UserRole.VIEWER, tag: `adm-${marker}` })
      await tx.user.update({ where: { id: viewer.id }, data: { status: UserStatus.SUSPENDED } })

      const engineers = await listUsersPage(tx, listParams({ q: `adm-${marker}`, role: 'ENGINEER' }), NOW)
      expect(engineers.rows.map((row) => row.id)).toEqual([engineer.id])

      const suspended = await listUsersPage(tx, listParams({ q: `adm-${marker}`, filter: 'suspended' }), NOW)
      expect(suspended.rows.map((row) => row.id)).toEqual([viewer.id])
    })
  })

  it('finds accounts that are locked out, and those that have never signed in', async () => {
    await withRollback(async (tx) => {
      const marker = tag()
      const locked = await createTestUser(tx, { role: UserRole.ENGINEER, tag: `adm-${marker}` })
      await tx.user.update({ where: { id: locked.id }, data: { lockedUntil: new Date(NOW.getTime() + 600_000), failedLoginAttempts: 5, lastLoginAt: NOW } })

      const lockedOut = await listUsersPage(tx, listParams({ q: `adm-${marker}`, filter: 'locked' }), NOW)
      expect(lockedOut.rows.map((row) => row.id)).toEqual([locked.id])
      expect(lockedOut.rows[0].failedLoginAttempts).toBe(5)

      const never = await listUsersPage(tx, listParams({ q: `adm-${marker}`, filter: 'never-signed-in' }), NOW)
      expect(never.rows.map((row) => row.id)).not.toContain(locked.id)
    })
  })

  it('counts every filter for the tabs', async () => {
    await withRollback(async (tx) => {
      const before = await countUsersByFilter(tx, NOW)
      const user = await createTestUser(tx, { role: UserRole.VIEWER, tag: `adm-${tag()}` })
      await tx.user.update({ where: { id: user.id }, data: { status: UserStatus.DISABLED } })

      const after = await countUsersByFilter(tx, NOW)
      expect(after.all).toBe(before.all + 1)
      expect(after.suspended).toBe(before.suspended + 1)
      expect(after['never-signed-in']).toBe(before['never-signed-in'] + 1)
    })
  })

  it('leaves a removed account out of the list entirely', async () => {
    await withRollback(async (tx) => {
      const user = await createTestUser(tx, { role: UserRole.VIEWER, tag: `adm-${tag()}` })
      await tx.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } })

      expect((await listUsersPage(tx, listParams({ q: user.email }), NOW)).total).toBe(0)
      expect(await getUserForAdmin(tx, user.id)).toBeNull()
    })
  })

  it('shows which profile an account is linked to', async () => {
    await withRollback(async (tx) => {
      const user = await createTestUser(tx, { role: UserRole.EDITOR, withEditorProfile: true, tag: `adm-${tag()}` })
      const page = await listUsersPage(tx, listParams({ q: user.email }), NOW)
      expect(page.rows[0].editorProfileId).toBe(user.editorProfileId)
      expect(page.rows[0].editorName).toBe(user.name)
    })
  })
})

describe('changing a role', () => {
  it('changes it and revokes every session that account holds', async () => {
    await withRollback(async (tx) => {
      const admin = await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` })
      const target = await createTestUser(tx, { role: UserRole.VIEWER, tag: `adm-${tag()}` })
      const before = await tx.user.findUniqueOrThrow({ where: { id: target.id }, select: { sessionVersion: true } })

      await setUserRole(tx, actorFor(admin), target.id, UserRole.ENGINEER, 'joining the workshop')

      const after = await tx.user.findUniqueOrThrow({ where: { id: target.id }, select: { role: true, sessionVersion: true } })
      expect(after.role).toBe(UserRole.ENGINEER)
      expect(after.sessionVersion).toBe(before.sessionVersion + 1)
    })
  })

  it('records who did it, what it was, and any reason given', async () => {
    await withRollback(async (tx) => {
      const admin = await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` })
      const target = await createTestUser(tx, { role: UserRole.VIEWER, tag: `adm-${tag()}` })

      await setUserRole(tx, actorFor(admin), target.id, UserRole.ENGINEER, 'joining the workshop')

      const audit = await tx.auditLog.findFirst({ where: { entityType: 'User', entityId: target.id, action: 'ROLE_CHANGED' }, select: { summary: true, actorUserId: true } })
      expect(audit?.actorUserId).toBe(admin.id)
      expect(audit?.summary).toContain('from viewer to engineer')
    })
  })

  it('refuses to change your own role', async () => {
    await withRollback(async (tx) => {
      const admin = await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` })
      await expect(setUserRole(tx, actorFor(admin), admin.id, UserRole.VIEWER)).rejects.toThrow(/your own role/i)
    })
  })

  it('does nothing when the role is already what was asked for', async () => {
    await withRollback(async (tx) => {
      const admin = await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` })
      const target = await createTestUser(tx, { role: UserRole.ENGINEER, tag: `adm-${tag()}` })
      const before = await tx.user.findUniqueOrThrow({ where: { id: target.id }, select: { sessionVersion: true } })

      await setUserRole(tx, actorFor(admin), target.id, UserRole.ENGINEER)

      const after = await tx.user.findUniqueOrThrow({ where: { id: target.id }, select: { sessionVersion: true } })
      expect(after.sessionVersion).toBe(before.sessionVersion)
    })
  })

  it('refuses to demote the last active administrator', async () => {
    await withRollback(async (tx) => {
      // Take the seeded administrators out of the way so the one under test is
      // genuinely the last active one.
      await tx.user.updateMany({ where: { role: UserRole.ADMIN, deletedAt: null }, data: { status: UserStatus.SUSPENDED } })
      const actingAdmin = await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` })
      const lastAdmin = await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` })
      await tx.user.update({ where: { id: actingAdmin.id }, data: { status: UserStatus.SUSPENDED } })

      await expect(setUserRole(tx, actorFor(actingAdmin), lastAdmin.id, UserRole.VIEWER)).rejects.toThrow(/last active administrator/i)
    })
  })

  it('allows a demotion while another active administrator remains', async () => {
    await withRollback(async (tx) => {
      const acting = await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` })
      const target = await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` })

      await setUserRole(tx, actorFor(acting), target.id, UserRole.ENGINEER)
      expect((await tx.user.findUniqueOrThrow({ where: { id: target.id }, select: { role: true } })).role).toBe(UserRole.ENGINEER)
    })
  })

  it('refuses an account that does not exist', async () => {
    await withRollback(async (tx) => {
      const admin = await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` })
      await expect(setUserRole(tx, actorFor(admin), 'no-such-user', UserRole.VIEWER)).rejects.toThrow(/not found/i)
    })
  })
})

describe('clearing a lockout', () => {
  it('clears the lock and the failed attempts, and audits it', async () => {
    await withRollback(async (tx) => {
      const admin = await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` })
      const target = await createTestUser(tx, { role: UserRole.ENGINEER, tag: `adm-${tag()}` })
      await tx.user.update({ where: { id: target.id }, data: { lockedUntil: new Date(Date.now() + 600_000), failedLoginAttempts: 5 } })

      await unlockUser(tx, actorFor(admin), target.id)

      const after = await tx.user.findUniqueOrThrow({ where: { id: target.id }, select: { lockedUntil: true, failedLoginAttempts: true, passwordHash: true } })
      expect(after.lockedUntil).toBeNull()
      expect(after.failedLoginAttempts).toBe(0)
      // The password is untouched: this says "try again", not "come in".
      expect(after.passwordHash).not.toBeNull()

      const audit = await tx.auditLog.findFirst({ where: { entityType: 'User', entityId: target.id, action: 'UPDATE' }, select: { summary: true } })
      expect(audit?.summary).toContain('Lockout cleared')
    })
  })

  it('refuses when the account is not locked out', async () => {
    await withRollback(async (tx) => {
      const admin = await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` })
      const target = await createTestUser(tx, { role: UserRole.ENGINEER, tag: `adm-${tag()}` })
      await expect(unlockUser(tx, actorFor(admin), target.id)).rejects.toThrow(/not locked out/i)
    })
  })
})

// -----------------------------------------------------------------------------
// Software catalogue
// -----------------------------------------------------------------------------

describe('the software catalogue', () => {
  it('adds an application and audits it', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const name = `Test Suite ${tag()}`

      const { id } = await createSoftware(tx, admin, { name, vendor: 'Acme', version: '2044', licenseType: 'site', notes: undefined, sortOrder: 3 })

      const rows = await listSoftware(tx, { includeInactive: true })
      const created = rows.find((row) => row.id === id)
      expect(created?.name).toBe(name)
      expect(created?.vendor).toBe('Acme')
      expect(created?.isActive).toBe(true)

      const audit = await tx.auditLog.findFirst({ where: { entityType: 'SoftwareApplication', entityId: id, action: 'CREATE' }, select: { summary: true } })
      expect(audit?.summary).toContain(name)
    })
  })

  it('refuses a second application with the same name and version', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const name = `Duplicate ${tag()}`
      await createSoftware(tx, admin, { name, vendor: undefined, version: '1', licenseType: undefined, notes: undefined, sortOrder: 0 })
      await expect(createSoftware(tx, admin, { name, vendor: undefined, version: '1', licenseType: undefined, notes: undefined, sortOrder: 0 })).rejects.toThrow(/already has this name and version/i)
    })
  })

  it('allows the same application at a different version', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const name = `Versioned ${tag()}`
      await createSoftware(tx, admin, { name, vendor: undefined, version: '19', licenseType: undefined, notes: undefined, sortOrder: 0 })
      await createSoftware(tx, admin, { name, vendor: undefined, version: '20', licenseType: undefined, notes: undefined, sortOrder: 1 })

      const rows = await listSoftware(tx, { includeInactive: true })
      expect(rows.filter((row) => row.name === name)).toHaveLength(2)
    })
  })

  it('edits an application and records what changed', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const { id } = await createSoftware(tx, admin, { name: `Editable ${tag()}`, vendor: 'Old', version: undefined, licenseType: undefined, notes: undefined, sortOrder: 0 })

      await updateSoftware(tx, admin, id, { name: 'Renamed application', vendor: 'New', version: '2', licenseType: 'named user', notes: 'moved to subscription', sortOrder: 5 })

      const rows = await listSoftware(tx, { includeInactive: true })
      const updated = rows.find((row) => row.id === id)
      expect(updated?.name).toBe('Renamed application')
      expect(updated?.vendor).toBe('New')
      expect(updated?.sortOrder).toBe(5)

      const audit = await tx.auditLog.findFirst({ where: { entityType: 'SoftwareApplication', entityId: id, action: 'UPDATE' }, select: { summary: true } })
      expect(audit?.summary).toContain('Renamed application')
    })
  })

  it('deactivates rather than deletes, and keeps it out of the active list', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const { id } = await createSoftware(tx, admin, { name: `Retired ${tag()}`, vendor: undefined, version: undefined, licenseType: undefined, notes: undefined, sortOrder: 0 })

      await setSoftwareActive(tx, admin, id, false)

      expect((await listSoftware(tx)).map((row) => row.id)).not.toContain(id)
      const all = await listSoftware(tx, { includeInactive: true })
      expect(all.find((row) => row.id === id)?.isActive).toBe(false)
    })
  })

  it('reports how many kits expect an application, and how many require it', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const { id } = await createSoftware(tx, admin, { name: `In use ${tag()}`, vendor: undefined, version: undefined, licenseType: undefined, notes: undefined, sortOrder: 0 })
      const kit = await tx.kit.create({ data: { kitCode: `SW-${tag()}`, name: 'Software kit' }, select: { id: true } })
      await tx.kitSoftware.create({ data: { kitId: kit.id, softwareApplicationId: id, isRequired: true } })

      const rows = await listSoftware(tx, { includeInactive: true })
      const row = rows.find((entry) => entry.id === id)
      expect(row?.kitCount).toBe(1)
      expect(row?.requiredKitCount).toBe(1)
    })
  })

  it('refuses to edit an application that does not exist', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      await expect(updateSoftware(tx, admin, 'no-such-app', { name: 'Nothing', vendor: undefined, version: undefined, licenseType: undefined, notes: undefined, sortOrder: 0 })).rejects.toThrow(/not found/i)
    })
  })
})

// -----------------------------------------------------------------------------
// Checklist templates
// -----------------------------------------------------------------------------

async function template(tx: Db, admin: ReturnType<typeof actorFor>): Promise<string> {
  const { id } = await createChecklistTemplate(tx, admin, { name: `Template ${tag()}`, description: 'built by the tests' })
  return id
}

describe('checklist templates', () => {
  it('creates a template and audits it', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const id = await template(tx, admin)

      const detail = await getChecklistTemplate(tx, id)
      expect(detail?.items).toEqual([])
      expect(detail?.isActive).toBe(true)
      expect(detail?.isDefault).toBe(false)

      const audit = await tx.auditLog.findFirst({ where: { entityType: 'ChecklistTemplate', entityId: id, action: 'CREATE' }, select: { summary: true } })
      expect(audit?.summary).toContain('created')
    })
  })

  it('refuses two templates with the same name', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const name = `Shared ${tag()}`
      await createChecklistTemplate(tx, admin, { name, description: undefined })
      await expect(createChecklistTemplate(tx, admin, { name, description: undefined })).rejects.toThrow(/already has this name/i)
    })
  })

  it('adds checks with a phase and counts them per phase', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const id = await template(tx, admin)

      await addChecklistItem(tx, admin, id, { label: 'Battery health', description: 'above 80%', phase: 'HANDOVER', isRequired: true, sortOrder: 0 })
      await addChecklistItem(tx, admin, id, { label: 'Case intact', description: undefined, phase: 'RETURN', isRequired: true, sortOrder: 1 })
      await addChecklistItem(tx, admin, id, { label: 'Cables counted', description: undefined, phase: 'BOTH', isRequired: false, sortOrder: 2 })

      const detail = await getChecklistTemplate(tx, id)
      expect(detail?.itemCount).toBe(3)
      expect(detail?.handoverCount).toBe(2)
      expect(detail?.returnCount).toBe(2)
      expect(detail?.requiredCount).toBe(2)
      expect(detail?.items.map((item) => item.label)).toEqual(['Battery health', 'Case intact', 'Cables counted'])
    })
  })

  it('edits a check', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const id = await template(tx, admin)
      const item = await addChecklistItem(tx, admin, id, { label: 'Original', description: undefined, phase: 'BOTH', isRequired: true, sortOrder: 0 })

      await updateChecklistItem(tx, admin, item.id, { label: 'Corrected', description: 'with detail', phase: 'RETURN', isRequired: false, sortOrder: 4 })

      const detail = await getChecklistTemplate(tx, id)
      const updated = detail?.items[0]
      expect(updated?.label).toBe('Corrected')
      expect(updated?.phase).toBe(ChecklistPhase.RETURN)
      expect(updated?.isRequired).toBe(false)
      expect(updated?.sortOrder).toBe(4)
    })
  })

  it('removes a check that no booking has used', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const id = await template(tx, admin)
      const item = await addChecklistItem(tx, admin, id, { label: 'Removable', description: undefined, phase: 'BOTH', isRequired: true, sortOrder: 0 })

      await removeChecklistItem(tx, admin, item.id)

      expect((await getChecklistTemplate(tx, id))?.items).toEqual([])
    })
  })

  it('refuses to remove a check a booking has already copied, and says how many', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const id = await template(tx, admin)
      const item = await addChecklistItem(tx, admin, id, { label: 'Already used', description: undefined, phase: 'BOTH', isRequired: true, sortOrder: 0 })

      // A booking that has copied the check, which is what a handover does.
      const engineer = await tx.engineerProfile.findFirstOrThrow({ select: { id: true } })
      const kit = await tx.kit.create({ data: { kitCode: `CL-${tag()}`, name: 'Checklist kit' }, select: { id: true } })
      const editor = await tx.editorProfile.create({ data: { fullName: `Checklist editor ${tag()}`, isExternal: true }, select: { id: true } })
      const admins = await tx.user.findFirstOrThrow({ where: { role: UserRole.ADMIN, deletedAt: null }, select: { id: true } })
      const booking = await tx.booking.create({
        data: {
          bookingNumber: `CL-BK-${tag()}`,
          kitId: kit.id,
          editorId: editor.id,
          engineerId: engineer.id,
          bookingStart: new Date('2044-08-01T06:00:00.000Z'),
          bookingEnd: new Date('2044-08-03T06:00:00.000Z'),
          expectedReturnDate: new Date('2044-08-03T06:00:00.000Z'),
          createdById: admins.id,
        },
        select: { id: true },
      })
      await tx.bookingChecklistItem.create({ data: { bookingId: booking.id, sourceTemplateItemId: item.id, label: 'Already used', phase: ChecklistPhase.BOTH, isRequired: true, sortOrder: 0 } })

      await expect(removeChecklistItem(tx, admin, item.id)).rejects.toThrow(/already been used on 1 booking/i)

      // And the check is still there, along with the count that explains why.
      const detail = await getChecklistTemplate(tx, id)
      expect(detail?.items[0].usedByBookings).toBe(1)
    })
  })

  it('makes one template the default and clears the previous one', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const first = await template(tx, admin)
      const second = await template(tx, admin)

      await setChecklistTemplateDefault(tx, admin, first)
      await setChecklistTemplateDefault(tx, admin, second)

      expect((await getChecklistTemplate(tx, first))?.isDefault).toBe(false)
      expect((await getChecklistTemplate(tx, second))?.isDefault).toBe(true)
      expect(await tx.checklistTemplate.count({ where: { isDefault: true, deletedAt: null } })).toBe(1)
    })
  })

  it('refuses to make an inactive template the default', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const id = await template(tx, admin)
      await setChecklistTemplateActive(tx, admin, id, false)

      await expect(setChecklistTemplateDefault(tx, admin, id)).rejects.toThrow(/activate the template/i)
    })
  })

  it('refuses to deactivate the default template', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const id = await template(tx, admin)
      await setChecklistTemplateDefault(tx, admin, id)

      await expect(setChecklistTemplateActive(tx, admin, id, false)).rejects.toThrow(/make another template the default/i)
    })
  })

  it('keeps an inactive template out of the active list but findable', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const id = await template(tx, admin)
      await setChecklistTemplateActive(tx, admin, id, false)

      expect((await listChecklistTemplates(tx)).map((row) => row.id)).not.toContain(id)
      expect((await listChecklistTemplates(tx, { includeInactive: true })).map((row) => row.id)).toContain(id)
    })
  })

  it('renames a template without touching its checks', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const id = await template(tx, admin)
      await addChecklistItem(tx, admin, id, { label: 'Kept', description: undefined, phase: 'BOTH', isRequired: true, sortOrder: 0 })

      await updateChecklistTemplate(tx, admin, id, { name: `Renamed ${tag()}`, description: 'now with a description' })

      const detail = await getChecklistTemplate(tx, id)
      expect(detail?.name).toMatch(/^Renamed /)
      expect(detail?.items.map((item) => item.label)).toEqual(['Kept'])
    })
  })

  it('reports how many kits and bookings use a template', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      const id = await template(tx, admin)
      await tx.kit.create({ data: { kitCode: `TP-${tag()}`, name: 'Template kit', defaultChecklistTemplateId: id } })

      const rows = await listChecklistTemplates(tx, { includeInactive: true })
      expect(rows.find((row) => row.id === id)?.kitCount).toBe(1)
    })
  })

  it('refuses a check on a template that does not exist', async () => {
    await withRollback(async (tx) => {
      const admin = actorFor(await createTestUser(tx, { role: UserRole.ADMIN, tag: `adm-${tag()}` }))
      await expect(addChecklistItem(tx, admin, 'no-such-template', { label: 'Nowhere', description: undefined, phase: 'BOTH', isRequired: true, sortOrder: 0 })).rejects.toThrow(/not found/i)
    })
  })
})

// -----------------------------------------------------------------------------
// Settings, and the words the pages use
// -----------------------------------------------------------------------------

describe('stored settings', () => {
  it('reads the seeded settings with what each one means', async () => {
    await withRollback(async (tx) => {
      const settings = await listSettings(tx)
      expect(settings.length).toBeGreaterThan(0)
      for (const setting of settings) {
        expect(setting.key).toBeTruthy()
        expect(setting.category).toBeTruthy()
      }
      expect(settings.map((setting) => setting.key)).toContain('app.timezone')
    })
  })
})

describe('the words and the URLs', () => {
  it('mirrors the role and status enums the schema declares', () => {
    expect([...USER_ROLES].sort()).toEqual(Object.values(UserRole).sort())
    expect([...USER_STATUSES].sort()).toEqual(Object.values(UserStatus).sort())
    for (const status of USER_STATUSES) expect(USER_STATUS_LABELS[status]).toBeTruthy()
  })

  it('mirrors the checklist phases the schema declares', () => {
    expect([...CHECKLIST_PHASES].sort()).toEqual(Object.values(ChecklistPhase).sort())
    for (const phase of CHECKLIST_PHASES) expect(CHECKLIST_PHASE_LABELS[phase]).toBeTruthy()
  })

  it('drops an account filter it does not offer', () => {
    const parsed = parseUserListParams({ filter: 'invented', role: 'WIZARD', sort: 'passwordHash', dir: 'up', page: '0', pageSize: '5000' })
    expect(parsed.filter).toBe('all')
    expect(parsed.role).toBeUndefined()
    expect(parsed.sort).toBe('name')
    expect(parsed.dir).toBe('asc')
    expect(parsed.page).toBe(1)
    // A size out of range is clamped to the nearest bound rather than reset, so a
    // wide URL still shows something sensible (AD-32).
    expect(parsed.pageSize).toBe(PAGE_SIZE_MAX)
    expect(parseUserListParams({ pageSize: '1' }).pageSize).toBe(PAGE_SIZE_MIN)
    expect(parseUserListParams({}).pageSize).toBe(USER_DEFAULT_PAGE_SIZE)
  })

  it('turns the account list parameters back into a URL', () => {
    expect(usersHref(listParams())).toBe('/admin/users')
    expect(usersHref(listParams({ filter: 'locked', q: 'khalid' }))).toBe('/admin/users?q=khalid&filter=locked')
    expect(usersHref(listParams(), { page: 2 })).toBe('/admin/users?page=2')
  })
})
