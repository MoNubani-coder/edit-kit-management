import { randomUUID } from 'node:crypto'

import { type BookingStatus, UserRole, UserStatus } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

import type { Actor } from '@/server/auth/session'
import {
  countEditorsByView,
  findEditorIdByStaffId,
  getEditorActivity,
  getEditorDetail,
  getEditorLifecycleContext,
  listEditorBookings,
  listEditors,
  listLinkableUsers,
  searchActiveEditors,
} from '@/server/dal/editors.dal'
import type { Db } from '@/server/db/prisma'
import {
  createEditor,
  editorRemovalBlocker,
  linkEditorUser,
  removeEditor,
  setEditorActive,
  unlinkEditorUser,
  updateEditor,
} from '@/server/services/editors.service'
import { uniqueViolationField } from '@/server/services/errors'

import { actorFor, createTestUser, testDb, type TestUser, withRollback } from '../helpers/db'

/**
 * Editor rules against the real database, inside rolled-back transactions.
 * The seeded editors (Layla Hassan EDT-2210 with an account, two external
 * EXT-500x profiles) are a fixed backdrop; every test adds its own rows and
 * nothing survives - editors, users, kits, bookings, audit rows.
 *
 * PostgreSQL aborts a transaction after a failed statement, so tests that
 * provoke a database constraint do it as their final step.
 */

const LIST = { view: 'all', sort: 'fullName', direction: 'asc', page: 1, pageSize: 25 } as const
const DAY = 24 * 60 * 60 * 1000

const tag = () => randomUUID().slice(0, 8).toUpperCase()

interface Fixtures {
  admin: TestUser
  actor: Actor
}

async function fixtures(tx: Db): Promise<Fixtures> {
  const admin = await createTestUser(tx, { role: UserRole.ADMIN })
  return { admin, actor: actorFor(admin) }
}

function editorInput(overrides: Partial<Parameters<typeof createEditor>[2]> = {}) {
  const t = tag()
  return {
    fullName: `Test Editor ${t}`,
    staffId: `TST-${t}`,
    email: `test-editor-${t.toLowerCase()}@example.test`,
    contactNumber: `+971 50 ${t.slice(0, 3)} ${t.slice(3, 7)}`.replace(/[A-Z]/g, '7'),
    department: undefined,
    company: 'Test Productions',
    type: 'EXTERNAL' as const,
    notes: undefined,
    userId: undefined,
    isActive: true,
    ...overrides,
  }
}

/** A booking on a fresh kit (so the no-overlap constraint never interferes). */
async function book(tx: Db, fx: Fixtures, editorId: string, status: BookingStatus, startOffsetDays: number) {
  const t = tag()
  const kit = await tx.kit.create({ data: { kitCode: `TSK-${t}`, name: `Test kit ${t}` }, select: { id: true, kitCode: true } })
  const engineer = await tx.engineerProfile.findFirstOrThrow({ select: { id: true } })
  const start = Date.now() + startOffsetDays * DAY
  const out = status === 'CHECKED_OUT' || status === 'OVERDUE' || status === 'RETURN_INSPECTION' || status === 'COMPLETED'
  return tx.booking.create({
    data: {
      bookingNumber: `BK-TEST-${t}`,
      kitId: kit.id,
      editorId,
      engineerId: engineer.id,
      status,
      bookingStart: new Date(start),
      bookingEnd: new Date(start + 2 * DAY),
      expectedReturnDate: new Date(start + 2 * DAY),
      collectionDate: out ? new Date(start) : null,
      actualReturnDate: status === 'COMPLETED' ? new Date(start + DAY) : null,
      createdById: fx.admin.id,
    },
    select: { id: true, bookingNumber: true, kitId: true },
  })
}

afterAll(async () => {
  await testDb.$disconnect()
})

describe('creating editors', () => {
  it('creates an external editor with no account, audited, and reads it back', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const input = editorInput({ notes: 'Prefers morning collections' })
      const created = await createEditor(tx, fx.actor, input)

      const detail = await getEditorDetail(tx, created.id)
      expect(detail).toMatchObject({
        fullName: input.fullName,
        staffId: input.staffId,
        email: input.email,
        contactNumber: input.contactNumber,
        company: 'Test Productions',
        isExternal: true,
        isActive: true,
        linkedUser: null,
        activeBookingCount: 0,
        totalBookingCount: 0,
        signatureCount: 0,
        lastBooking: null,
        notes: 'Prefers morning collections',
      })

      const audit = await tx.auditLog.findMany({ where: { entityType: 'EditorProfile', entityId: created.id } })
      expect(audit.map((row) => row.action)).toEqual(['CREATE'])
      expect(audit[0]).toMatchObject({ actorUserId: fx.admin.id, summary: expect.stringContaining('External editor') })
    })
  })

  it('creates an internal editor without an account, and links one later', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const created = await createEditor(tx, fx.actor, editorInput({ type: 'INTERNAL', company: undefined, department: 'Post Production' }))
      expect(await getEditorDetail(tx, created.id)).toMatchObject({ isExternal: false, department: 'Post Production', linkedUser: null })

      const account = await createTestUser(tx, { role: UserRole.EDITOR })
      expect((await listLinkableUsers(tx)).map((user) => user.id)).toContain(account.id)

      await linkEditorUser(tx, fx.actor, created.id, account.id)
      const linked = await getEditorDetail(tx, created.id)
      expect(linked?.linkedUser).toMatchObject({ id: account.id, name: account.name, role: 'EDITOR', status: 'ACTIVE', deleted: false })
      expect((await listLinkableUsers(tx)).map((user) => user.id)).not.toContain(account.id)
      // Linking the same account again is a no-op.
      await linkEditorUser(tx, fx.actor, created.id, account.id)

      await unlinkEditorUser(tx, fx.actor, created.id)
      expect((await getEditorDetail(tx, created.id))?.linkedUser).toBeNull()

      const actions = (await tx.auditLog.findMany({ where: { entityType: 'EditorProfile', entityId: created.id }, orderBy: { createdAt: 'asc' } })).map((row) => row.action)
      expect(actions).toEqual(['CREATE', 'EDITOR_USER_LINKED', 'EDITOR_USER_UNLINKED'])
    })
  })

  it('creates an internal editor with an optional account link in one step', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const account = await createTestUser(tx, { role: UserRole.EDITOR })
      const created = await createEditor(tx, fx.actor, editorInput({ type: 'INTERNAL', userId: account.id }))
      expect((await getEditorDetail(tx, created.id))?.linkedUser?.id).toBe(account.id)
      const actions = (await tx.auditLog.findMany({ where: { entityType: 'EditorProfile', entityId: created.id } })).map((row) => row.action)
      expect(actions).toEqual(expect.arrayContaining(['CREATE', 'EDITOR_USER_LINKED']))

      // An external editor cannot be created with an account.
      await expect(createEditor(tx, fx.actor, editorInput({ type: 'EXTERNAL', userId: (await createTestUser(tx, { role: UserRole.EDITOR })).id }))).rejects.toMatchObject({
        code: 'validation',
        fieldErrors: { userId: expect.stringContaining('External editors') },
      })
    })
  })

  it('rejects a duplicate staff ID with a field error (database-enforced)', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      await expect(createEditor(tx, fx.actor, editorInput({ staffId: 'EXT-5001' }))).rejects.toMatchObject({
        name: 'DomainError',
        code: 'conflict',
        fieldErrors: { staffId: expect.stringContaining('staff ID') },
      })
    })
  })

  it('validates and normalises input through the schema', async () => {
    const { createEditorSchema } = await import('@/lib/validation/editors')
    const parsed = createEditorSchema.parse({ fullName: ' Sara Khan ', staffId: ' ext-9001 ', email: 'Sara@Example.COM', type: 'EXTERNAL', contactNumber: '+971 50 111 2222' })
    expect(parsed).toMatchObject({ fullName: 'Sara Khan', staffId: 'EXT-9001', email: 'sara@example.com', isActive: true })
    expect(createEditorSchema.safeParse({ fullName: 'X', type: 'EXTERNAL' }).success).toBe(false)
    expect(createEditorSchema.safeParse({ fullName: 'Sara Khan', type: 'EXTERNAL', staffId: 'bad id!' }).success).toBe(false)
    expect(createEditorSchema.safeParse({ fullName: 'Sara Khan', type: 'EXTERNAL', email: 'not-an-email' }).success).toBe(false)
    expect(createEditorSchema.safeParse({ fullName: 'Sara Khan', type: 'EXTERNAL', contactNumber: 'call me' }).success).toBe(false)
    expect(createEditorSchema.safeParse({ fullName: 'Sara Khan', type: 'CONTRACTOR' }).success).toBe(false)
  })
})

describe('listing editors', () => {
  it('finds editors by name, staff ID, contact number and email; an exact staff ID resolves directly', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const input = editorInput({ fullName: 'Zubair Quorvax', contactNumber: '+971 55 987 6543', email: 'zubair.quorvax@example.test' })
      const created = await createEditor(tx, fx.actor, input)

      for (const term of ['quorvax', input.staffId!.toLowerCase(), '987 6543', 'zubair.quorvax@']) {
        const result = await listEditors(tx, { ...LIST, search: term })
        expect(result.rows.map((row) => row.id), term).toEqual([created.id])
      }
      expect(await findEditorIdByStaffId(tx, input.staffId!.toLowerCase())).toBe(created.id)
      expect(await findEditorIdByStaffId(tx, 'EXT-5001')).not.toBeNull()
      expect(await findEditorIdByStaffId(tx, 'NOPE-0000')).toBeNull()
    })
  })

  it('filters by type and status and counts every tab in one query', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const before = await countEditorsByView(tx)
      const marker = `F${tag().slice(0, 5)}`
      const internal = await createEditor(tx, fx.actor, editorInput({ fullName: `${marker} Internal`, type: 'INTERNAL' }))
      const external = await createEditor(tx, fx.actor, editorInput({ fullName: `${marker} External` }))
      const inactive = await createEditor(tx, fx.actor, editorInput({ fullName: `${marker} Inactive`, isActive: false }))

      const ids = (view: (typeof LIST)['view'] | 'internal' | 'external' | 'active' | 'inactive') =>
        listEditors(tx, { ...LIST, view, search: marker }).then((result) => result.rows.map((row) => row.id).sort())

      expect(await ids('internal')).toEqual([internal.id])
      expect(await ids('external')).toEqual([external.id, inactive.id].sort())
      expect(await ids('active')).toEqual([internal.id, external.id].sort())
      expect(await ids('inactive')).toEqual([inactive.id])
      expect(await ids('all')).toHaveLength(3)

      const after = await countEditorsByView(tx)
      expect(after.all - before.all).toBe(3)
      expect(after.internal - before.internal).toBe(1)
      expect(after.external - before.external).toBe(2)
      expect(after.active - before.active).toBe(2)
      expect(after.inactive - before.inactive).toBe(1)
    })
  })

  it('paginates and sorts deterministically, with booking figures per row and no N+1', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const marker = `P${tag().slice(0, 5)}`
      const c = await createEditor(tx, fx.actor, editorInput({ fullName: `${marker} Carol` }))
      const a = await createEditor(tx, fx.actor, editorInput({ fullName: `${marker} Alice` }))
      const b = await createEditor(tx, fx.actor, editorInput({ fullName: `${marker} Bob` }))
      await book(tx, fx, a.id, 'CHECKED_OUT', -1)
      await book(tx, fx, a.id, 'COMPLETED', -30)

      const page1 = await listEditors(tx, { ...LIST, search: marker, pageSize: 2, page: 1 })
      const page2 = await listEditors(tx, { ...LIST, search: marker, pageSize: 2, page: 2 })
      expect(page1).toMatchObject({ total: 3, pageCount: 2, page: 1 })
      expect(page1.rows.map((row) => row.id)).toEqual([a.id, b.id])
      expect(page2.rows.map((row) => row.id)).toEqual([c.id])
      expect(page1.rows[0]).toMatchObject({ activeBookingCount: 1, totalBookingCount: 2 })
      expect(page1.rows[0].lastBooking?.status).toBe('CHECKED_OUT')
      expect(page1.rows[1]).toMatchObject({ activeBookingCount: 0, totalBookingCount: 0, lastBooking: null })

      const desc = await listEditors(tx, { ...LIST, search: marker, direction: 'desc', pageSize: 10 })
      expect(desc.rows.map((row) => row.id)).toEqual([c.id, b.id, a.id])
      expect((await listEditors(tx, { ...LIST, search: marker, pageSize: 2, page: 9 })).page).toBe(2)
    })
  })

  it('exposes no credentials or lockout state through any editor read', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const account = await createTestUser(tx, { role: UserRole.EDITOR })
      const created = await createEditor(tx, fx.actor, editorInput({ type: 'INTERNAL', userId: account.id }))
      await book(tx, fx, created.id, 'CHECKED_OUT', -1)

      const texts = [
        JSON.stringify(await listEditors(tx, { ...LIST, search: created.id.slice(0, 0) + (await getEditorDetail(tx, created.id))!.fullName })),
        JSON.stringify(await getEditorDetail(tx, created.id)),
        JSON.stringify(await listEditorBookings(tx, created.id, { scope: 'history' })),
        JSON.stringify(await getEditorActivity(tx, created.id)),
        JSON.stringify(await searchActiveEditors(tx, created.id.slice(0, 0) + 'Test Editor')),
        JSON.stringify(await listLinkableUsers(tx)),
      ]
      for (const text of texts) {
        expect(text).not.toMatch(/passwordHash|sessionVersion|failedLoginCount|lockedUntil|createdById|engineerId/)
      }
    })
  })
})

describe('bookings of an editor', () => {
  it('scopes active bookings to live statuses and orders the history newest first, paginated', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const editor = await createEditor(tx, fx.actor, editorInput())
      const other = await createEditor(tx, fx.actor, editorInput())
      const completed = await book(tx, fx, editor.id, 'COMPLETED', -30)
      const cancelled = await book(tx, fx, editor.id, 'CANCELLED', -20)
      const out = await book(tx, fx, editor.id, 'CHECKED_OUT', -1)
      const reserved = await book(tx, fx, editor.id, 'RESERVED', 5)
      const ready = await book(tx, fx, editor.id, 'READY_FOR_HANDOVER', 2)
      await book(tx, fx, other.id, 'CHECKED_OUT', -1)

      const active = await listEditorBookings(tx, editor.id, { scope: 'active' })
      expect(active.total).toBe(3)
      expect(active.rows.map((row) => row.bookingNumber)).toEqual([out.bookingNumber, ready.bookingNumber, reserved.bookingNumber])
      expect(active.rows[0]).toMatchObject({ status: 'CHECKED_OUT', engineerName: expect.any(String), kit: expect.objectContaining({ kitCode: expect.stringMatching(/^TSK-/) }) })
      expect(active.rows[0].collectionDate).not.toBeNull()

      const history = await listEditorBookings(tx, editor.id, { scope: 'history', pageSize: 3 })
      expect(history).toMatchObject({ total: 5, pageCount: 2, page: 1 })
      expect(history.rows.map((row) => row.bookingNumber)).toEqual([reserved.bookingNumber, ready.bookingNumber, out.bookingNumber])
      const page2 = await listEditorBookings(tx, editor.id, { scope: 'history', pageSize: 3, page: 2 })
      expect(page2.rows.map((row) => row.bookingNumber)).toEqual([cancelled.bookingNumber, completed.bookingNumber])
      expect(page2.rows[1].actualReturnDate).not.toBeNull()

      const detail = await getEditorDetail(tx, editor.id)
      expect(detail).toMatchObject({ activeBookingCount: 3, totalBookingCount: 5 })
      expect(detail?.lastBooking?.bookingNumber).toBe(reserved.bookingNumber)
      expect(detail?.firstBookingAt?.getTime()).toBeLessThan(Date.now() - 29 * DAY)

      const activity = await getEditorActivity(tx, editor.id)
      const times = activity.map((event) => event.at.getTime())
      expect(times).toEqual([...times].sort((x, y) => y - x))
      expect(activity.map((event) => event.kind)).toEqual(expect.arrayContaining(['created', 'booking', 'handover', 'return']))
    })
  })
})

describe('status, picker and removal', () => {
  it('keeps inactive editors out of the booking picker while their history stays readable', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const input = editorInput({ fullName: 'Picker Target Editor' })
      const editor = await createEditor(tx, fx.actor, input)
      const booking = await book(tx, fx, editor.id, 'CHECKED_OUT', -1)

      // Exact staff id first, and the contact number works too.
      const picked = await searchActiveEditors(tx, input.staffId!)
      expect(picked[0]?.id).toBe(editor.id)
      expect((await searchActiveEditors(tx, 'picker target')).map((row) => row.id)).toEqual([editor.id])
      expect((await searchActiveEditors(tx, input.contactNumber!)).map((row) => row.id)).toEqual([editor.id])

      // A live booking blocks deactivation.
      await expect(setEditorActive(tx, fx.actor, editor.id, { isActive: false, reason: 'Left the company' })).rejects.toMatchObject({
        code: 'lifecycle',
        message: expect.stringContaining('live booking'),
      })
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'COMPLETED', actualReturnDate: new Date() } })

      const result = await setEditorActive(tx, fx.actor, editor.id, { isActive: false, reason: 'Left the company' })
      expect(result.changed).toBe(true)
      expect((await searchActiveEditors(tx, input.staffId!)).map((row) => row.id)).not.toContain(editor.id)
      expect((await listEditors(tx, { ...LIST, view: 'inactive', search: input.staffId })).rows.map((row) => row.id)).toEqual([editor.id])

      // History remains readable and the booking still names the editor.
      const history = await listEditorBookings(tx, editor.id, { scope: 'history' })
      expect(history.rows.map((row) => row.bookingNumber)).toEqual([booking.bookingNumber])
      expect((await getEditorDetail(tx, editor.id))?.isActive).toBe(false)
      expect((await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { editorId: true } })).editorId).toBe(editor.id)

      const audit = await tx.auditLog.findFirst({ where: { entityType: 'EditorProfile', entityId: editor.id, action: 'EDITOR_STATUS_CHANGED' } })
      expect(audit?.summary).toContain('deactivated')
      expect(audit?.summary).toContain('Left the company')

      // Reactivation brings it back into the picker.
      await setEditorActive(tx, fx.actor, editor.id, { isActive: true, reason: undefined })
      expect((await searchActiveEditors(tx, input.staffId!)).map((row) => row.id)).toContain(editor.id)
      // Same state again is a no-op without an audit entry.
      expect((await setEditorActive(tx, fx.actor, editor.id, { isActive: true, reason: undefined })).changed).toBe(false)
      expect(await tx.auditLog.count({ where: { entityType: 'EditorProfile', entityId: editor.id, action: 'EDITOR_STATUS_CHANGED' } })).toBe(2)
    })
  })

  it('never destroys an editor with history; a profile without history is soft-removed', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const withHistory = await createEditor(tx, fx.actor, editorInput())
      await book(tx, fx, withHistory.id, 'COMPLETED', -30)
      const context = await getEditorLifecycleContext(tx, withHistory.id)
      expect(editorRemovalBlocker(context!)).toContain('history')
      await expect(removeEditor(tx, fx.actor, withHistory.id)).rejects.toMatchObject({ code: 'lifecycle' })
      expect(await tx.editorProfile.count({ where: { id: withHistory.id, deletedAt: null } })).toBe(1)

      const account = await createTestUser(tx, { role: UserRole.EDITOR })
      const fresh = await createEditor(tx, fx.actor, editorInput({ type: 'INTERNAL', userId: account.id }))
      await removeEditor(tx, fx.actor, fresh.id)
      const row = await tx.editorProfile.findUniqueOrThrow({ where: { id: fresh.id } })
      expect(row.deletedAt).not.toBeNull()
      expect(row).toMatchObject({ isActive: false, userId: null })
      expect((await listEditors(tx, { ...LIST, search: row.fullName })).total).toBe(0)
      expect((await getEditorDetail(tx, fresh.id))?.deletedAt).not.toBeNull()
      expect((await tx.auditLog.findMany({ where: { entityType: 'EditorProfile', entityId: fresh.id } })).map((entry) => entry.action)).toEqual(
        expect.arrayContaining(['CREATE', 'EDITOR_USER_LINKED', 'DELETE']),
      )
    })
  })

  it('edits details, refuses turning a linked editor external, and audits the diff', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const account = await createTestUser(tx, { role: UserRole.EDITOR })
      const editor = await createEditor(tx, fx.actor, editorInput({ type: 'INTERNAL', userId: account.id, department: 'Post' }))
      const current = (await getEditorDetail(tx, editor.id))!
      const base = {
        fullName: current.fullName,
        staffId: current.staffId ?? undefined,
        email: current.email ?? undefined,
        contactNumber: current.contactNumber ?? undefined,
        department: 'Post',
        company: undefined,
        type: 'INTERNAL' as const,
        notes: undefined,
      }

      await expect(updateEditor(tx, fx.actor, editor.id, { ...base, type: 'EXTERNAL' })).rejects.toMatchObject({ code: 'lifecycle', fieldErrors: { type: expect.stringContaining('Unlink') } })

      await updateEditor(tx, fx.actor, editor.id, { ...base, fullName: 'Renamed Editor', department: 'Graphics' })
      expect(await getEditorDetail(tx, editor.id)).toMatchObject({ fullName: 'Renamed Editor', department: 'Graphics' })
      const audit = await tx.auditLog.findFirst({ where: { entityType: 'EditorProfile', entityId: editor.id, action: 'UPDATE' } })
      expect(audit?.summary).toContain('fullName')
      expect(audit?.newValue).toMatchObject({ fullName: 'Renamed Editor', department: 'Graphics' })

      // No change, no audit entry.
      await updateEditor(tx, fx.actor, editor.id, { ...base, fullName: 'Renamed Editor', department: 'Graphics' })
      expect(await tx.auditLog.count({ where: { entityType: 'EditorProfile', entityId: editor.id, action: 'UPDATE' } })).toBe(1)

      // Once unlinked, the editor may become external.
      await unlinkEditorUser(tx, fx.actor, editor.id)
      await updateEditor(tx, fx.actor, editor.id, { ...base, fullName: 'Renamed Editor', department: undefined, company: 'Freelance', type: 'EXTERNAL' })
      expect(await getEditorDetail(tx, editor.id)).toMatchObject({ isExternal: true, company: 'Freelance' })
    })
  })
})

describe('account linking rules', () => {
  it('refuses disabled or deleted accounts, external editors, and a second editor for one account', async () => {
    await withRollback(async (tx) => {
      const fx = await fixtures(tx)
      const internal = await createEditor(tx, fx.actor, editorInput({ type: 'INTERNAL' }))
      const external = await createEditor(tx, fx.actor, editorInput())

      const disabled = await createTestUser(tx, { role: UserRole.EDITOR, status: UserStatus.DISABLED })
      await expect(linkEditorUser(tx, fx.actor, internal.id, disabled.id)).rejects.toMatchObject({ code: 'lifecycle', fieldErrors: { userId: expect.stringContaining('disabled') } })
      expect((await listLinkableUsers(tx)).map((user) => user.id)).not.toContain(disabled.id)

      const deleted = await createTestUser(tx, { role: UserRole.EDITOR })
      await tx.user.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } })
      await expect(linkEditorUser(tx, fx.actor, internal.id, deleted.id)).rejects.toMatchObject({ code: 'lifecycle', fieldErrors: { userId: expect.stringContaining('deleted') } })

      const account = await createTestUser(tx, { role: UserRole.EDITOR })
      await expect(linkEditorUser(tx, fx.actor, external.id, account.id)).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('External editors') })
      await expect(linkEditorUser(tx, fx.actor, internal.id, 'no-such-user')).rejects.toMatchObject({ code: 'not_found' })

      await linkEditorUser(tx, fx.actor, internal.id, account.id)
      const second = await createEditor(tx, fx.actor, editorInput({ type: 'INTERNAL' }))
      await expect(linkEditorUser(tx, fx.actor, second.id, account.id)).rejects.toMatchObject({
        code: 'conflict',
        message: expect.stringContaining((await getEditorDetail(tx, internal.id))!.fullName),
      })
      // An editor already holding an account must unlink before taking another.
      const another = await createTestUser(tx, { role: UserRole.EDITOR })
      await expect(linkEditorUser(tx, fx.actor, internal.id, another.id)).rejects.toMatchObject({ code: 'lifecycle', message: expect.stringContaining('Unlink') })
      // The seeded internal editor's account is not offered either.
      const seededUser = await tx.user.findUniqueOrThrow({ where: { email: 'editor@example.ae' }, select: { id: true } })
      expect((await listLinkableUsers(tx)).map((user) => user.id)).not.toContain(seededUser.id)

      // Finally the database itself refuses a second profile for one account.
      let failure: unknown = null
      try {
        await tx.editorProfile.update({ where: { id: second.id }, data: { userId: account.id } })
      } catch (error) {
        failure = error
      }
      expect(uniqueViolationField(failure)).toBe('userId')
    })
  })
})
