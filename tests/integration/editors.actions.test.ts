import { randomUUID } from 'node:crypto'

import { UserRole } from '@prisma/client'
import type { Session } from 'next-auth'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ForbiddenError, UnauthorizedError } from '@/server/auth/errors'
import type { Db } from '@/server/db/prisma'

import { createTestUser, testDb, type TestUser } from '../helpers/db'

/**
 * The editor Server Actions invoked directly, as a hostile client could POST
 * them - with the session stubbed and the database real. The whole suite runs
 * inside ONE PostgreSQL transaction that is rolled back in `afterAll`
 * (`@/server/db/prisma` is a proxy onto the transaction client), so no editor,
 * user or audit row survives. No test here provokes a database constraint:
 * that would abort the shared transaction.
 */

class Rollback extends Error {}

let tx: Db
let releaseTransaction: (() => void) | undefined
let transactionReady: () => void = () => {}
const ready = new Promise<void>((resolve) => {
  transactionReady = resolve
})

const transaction = testDb
  .$transaction(
    async (client) => {
      tx = client
      transactionReady()
      await new Promise<void>((_, reject) => {
        releaseTransaction = () => reject(new Rollback())
      })
    },
    { maxWait: 10_000, timeout: 180_000 },
  )
  .catch((error: unknown) => {
    if (!(error instanceof Rollback)) throw error
  })

let currentSession: Session | null = null
vi.mock('@/server/auth/auth', () => ({ auth: vi.fn(async () => currentSession) }))
vi.mock('@/server/db/prisma', () => ({
  prisma: new Proxy({} as Record<string | symbol, unknown>, {
    get: (_target, property) => (tx as unknown as Record<string | symbol, unknown>)[property],
  }),
}))

const { createEditorFormAction, updateEditorFormAction, setEditorActiveFormAction, linkEditorUserFormAction, unlinkEditorUserFormAction } =
  await import('@/server/actions/editors.actions')
const { loadEditorList } = await import('@/server/services/editors.service')
const { requirePermission } = await import('@/server/auth/session')

const LIST = { view: 'all', sort: 'fullName', direction: 'asc', page: 1, pageSize: 25 } as const

function sessionFor(user: TestUser): Session {
  return { expires: new Date(Date.now() + 60_000).toISOString(), user: { id: user.id, name: user.name, email: user.email, role: user.role } }
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

let admin: TestUser
let engineer: TestUser
let viewer: TestUser
let editor: TestUser
let unlinkedAccount: TestUser
const tag = randomUUID().slice(0, 8).toUpperCase()
const staffId = `ACT-${tag}`
let createdEditorId: string | null = null

beforeAll(async () => {
  await ready
  admin = await createTestUser(tx, { role: UserRole.ADMIN })
  engineer = await createTestUser(tx, { role: UserRole.ENGINEER })
  viewer = await createTestUser(tx, { role: UserRole.VIEWER })
  editor = await createTestUser(tx, { role: UserRole.EDITOR, withEditorProfile: true })
  unlinkedAccount = await createTestUser(tx, { role: UserRole.EDITOR })
})

afterAll(async () => {
  releaseTransaction?.()
  await transaction
  expect(await testDb.editorProfile.count({ where: { staffId } })).toBe(0)
  expect(await testDb.user.count({ where: { id: { in: [admin.id, engineer.id, viewer.id, editor.id, unlinkedAccount.id] } } })).toBe(0)
  await testDb.$disconnect()
})

beforeEach(() => {
  currentSession = null
})

const validFields = () => ({ fullName: `Action Test Editor ${tag}`, staffId, type: 'INTERNAL', contactNumber: '+971 50 000 9999', department: 'Test Department' })

describe('editor directory access', () => {
  it('rejects anonymous access', async () => {
    await expect(loadEditorList(LIST)).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('lets an ENGINEER (editor.read) list editors, including the seeded external ones', async () => {
    currentSession = sessionFor(engineer)
    const page = await loadEditorList(LIST)
    expect(page.result.total).toBeGreaterThanOrEqual(3)
    expect(page.result.rows.map((row) => row.staffId)).toEqual(expect.arrayContaining(['EDT-2210', 'EXT-5001', 'EXT-5002']))
    expect(page.counts.all).toBe(page.result.total)
  })

  it('refuses a VIEWER, whose matrix has no editor.read', async () => {
    currentSession = sessionFor(viewer)
    await expect(loadEditorList(LIST)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('refuses a signed-in EDITOR the directory and any editor workspace; their own bookings come through booking.readOwn', async () => {
    currentSession = sessionFor(editor)
    await expect(loadEditorList(LIST)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(requirePermission('editor.read')).rejects.toBeInstanceOf(ForbiddenError)
    const actor = await requirePermission('booking.readOwn')
    expect(actor.editorProfileId).toBe(editor.editorProfileId)
  })
})

describe('editor mutations', () => {
  it('forbids VIEWER and ENGINEER from creating editors', async () => {
    currentSession = sessionFor(viewer)
    expect(await createEditorFormAction(null, form(validFields()))).toMatchObject({ ok: false, error: 'forbidden' })
    currentSession = sessionFor(engineer)
    expect(await createEditorFormAction(null, form(validFields()))).toMatchObject({ ok: false, error: 'forbidden' })
    expect(await tx.editorProfile.count({ where: { staffId } })).toBe(0)
  })

  it('returns field-level validation errors before touching the database', async () => {
    currentSession = sessionFor(admin)
    const result = await createEditorFormAction(null, form({ ...validFields(), staffId: 'not valid!', email: 'nope' }))
    expect(result).toMatchObject({ ok: false, error: 'validation' })
    if (result && !result.ok) {
      expect(result.fieldErrors).toHaveProperty('staffId')
      expect(result.fieldErrors).toHaveProperty('email')
    }
  })

  it('lets an ADMIN create an internal editor without an account, audited, and redirects', async () => {
    currentSession = sessionFor(admin)
    await expect(createEditorFormAction(null, form(validFields()))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })

    const row = await tx.editorProfile.findUnique({ where: { staffId } })
    expect(row).toMatchObject({ isExternal: false, isActive: true, userId: null, department: 'Test Department' })
    createdEditorId = row!.id
    const audit = await tx.auditLog.findMany({ where: { entityType: 'EditorProfile', entityId: row!.id } })
    expect(audit.map((entry) => entry.action)).toEqual(['CREATE'])
    expect(audit[0].actorUserId).toBe(admin.id)
  })

  it('forbids an ENGINEER from editing or deactivating an editor', async () => {
    expect(createdEditorId).not.toBeNull()
    currentSession = sessionFor(engineer)
    expect(await updateEditorFormAction(null, form({ ...validFields(), id: createdEditorId!, fullName: 'Hijacked' }))).toMatchObject({ ok: false, error: 'forbidden' })
    expect(await setEditorActiveFormAction(null, form({ id: createdEditorId!, isActive: 'false' }))).toMatchObject({ ok: false, error: 'forbidden' })
    expect((await tx.editorProfile.findUniqueOrThrow({ where: { id: createdEditorId! } })).fullName).toBe(validFields().fullName)
  })

  it('applies account-link authorization and rules through the action layer', async () => {
    expect(createdEditorId).not.toBeNull()

    currentSession = sessionFor(viewer)
    expect(await linkEditorUserFormAction(null, form({ id: createdEditorId!, userId: unlinkedAccount.id }))).toMatchObject({ ok: false, error: 'forbidden' })

    currentSession = sessionFor(admin)
    // The test EDITOR's account already belongs to another profile: refused with a sentence.
    const taken = await linkEditorUserFormAction(null, form({ id: createdEditorId!, userId: editor.id }))
    expect(taken).toMatchObject({ ok: false, error: 'rejected', message: expect.stringContaining('already linked') })

    await expect(linkEditorUserFormAction(null, form({ id: createdEditorId!, userId: unlinkedAccount.id }))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    expect((await tx.editorProfile.findUniqueOrThrow({ where: { id: createdEditorId! } })).userId).toBe(unlinkedAccount.id)

    currentSession = sessionFor(engineer)
    expect(await unlinkEditorUserFormAction(null, form({ id: createdEditorId! }))).toMatchObject({ ok: false, error: 'forbidden' })

    currentSession = sessionFor(admin)
    await expect(unlinkEditorUserFormAction(null, form({ id: createdEditorId! }))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    expect((await tx.editorProfile.findUniqueOrThrow({ where: { id: createdEditorId! } })).userId).toBeNull()

    const actions = (await tx.auditLog.findMany({ where: { entityType: 'EditorProfile', entityId: createdEditorId! }, orderBy: { createdAt: 'asc' } })).map((entry) => entry.action)
    expect(actions).toEqual(['CREATE', 'EDITOR_USER_LINKED', 'EDITOR_USER_UNLINKED'])
  })

  it('lets an ADMIN deactivate and reactivate, audited', async () => {
    expect(createdEditorId).not.toBeNull()
    currentSession = sessionFor(admin)
    await expect(setEditorActiveFormAction(null, form({ id: createdEditorId!, isActive: 'false', reason: 'Contract ended' }))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    expect((await tx.editorProfile.findUniqueOrThrow({ where: { id: createdEditorId! } })).isActive).toBe(false)
    await expect(setEditorActiveFormAction(null, form({ id: createdEditorId!, isActive: 'true' }))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    expect(await tx.auditLog.count({ where: { entityType: 'EditorProfile', entityId: createdEditorId!, action: 'EDITOR_STATUS_CHANGED' } })).toBe(2)
  })
})
