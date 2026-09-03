import { UserRole, UserStatus } from '@prisma/client'
import type { Session } from 'next-auth'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ForbiddenError, UnauthorizedError } from '@/server/auth/errors'

import { createTestUser, deleteTestUsers, testDb, type TestUser } from '../helpers/db'

/**
 * `getCurrentUser()` and the `require*` helpers, with Auth.js replaced by a
 * controllable stub. The database is real: the helpers must refuse a session
 * whose account has since been disabled, whatever the cookie says.
 */

let currentSession: Session | null = null

vi.mock('@/server/auth/auth', () => ({
  auth: vi.fn(async () => currentSession),
}))

const { getCurrentUser, requireAdmin, requireAuth, requirePermission, requireRole } = await import(
  '@/server/auth/session'
)

function sessionFor(user: TestUser): Session {
  return {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  }
}

let engineer: TestUser
let admin: TestUser
let disabled: TestUser
let editor: TestUser

beforeAll(async () => {
  engineer = await createTestUser(testDb, { role: UserRole.ENGINEER })
  admin = await createTestUser(testDb, { role: UserRole.ADMIN })
  disabled = await createTestUser(testDb, { role: UserRole.ENGINEER, status: UserStatus.DISABLED, tag: 'disabled' })
  editor = await createTestUser(testDb, { role: UserRole.EDITOR, withEditorProfile: true })
})

afterAll(async () => {
  await deleteTestUsers(testDb, [engineer, admin, disabled, editor])
  await testDb.$disconnect()
})

beforeEach(() => {
  currentSession = null
})

describe('getCurrentUser', () => {
  it('resolves the identity of the signed-in user from the database', async () => {
    currentSession = sessionFor(engineer)

    const actor = await getCurrentUser()

    expect(actor).toEqual({
      id: engineer.id,
      name: engineer.name,
      email: engineer.email,
      role: 'ENGINEER',
      editorProfileId: null,
      engineerProfileId: null,
    })
  })

  it('links the editor profile so own-booking scoping has something to scope on', async () => {
    currentSession = sessionFor(editor)
    const actor = await getCurrentUser()
    expect(actor?.editorProfileId).toBe(editor.editorProfileId)
  })

  it('returns null without a session', async () => {
    expect(await getCurrentUser()).toBeNull()
  })

  it('returns null when the account behind a session is no longer active', async () => {
    currentSession = sessionFor(disabled)
    expect(await getCurrentUser()).toBeNull()
  })

  it('takes the role from the database, not from the session', async () => {
    currentSession = { ...sessionFor(engineer), user: { ...sessionFor(engineer).user, role: 'ADMIN' } }
    const actor = await getCurrentUser()
    expect(actor?.role).toBe('ENGINEER')
  })
})

describe('require helpers', () => {
  it('requireAuth rejects anonymous callers with UnauthorizedError', async () => {
    await expect(requireAuth()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('requirePermission returns forbidden, not unauthorized, for a signed-in user lacking the permission', async () => {
    currentSession = sessionFor(engineer)
    await expect(requirePermission('admin.users.manage')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(requirePermission(['admin.users.manage', 'admin.settings.manage'])).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('requirePermission accepts any-of lists and single permissions the actor holds', async () => {
    currentSession = sessionFor(engineer)
    await expect(requirePermission('booking.create')).resolves.toMatchObject({ id: engineer.id })
    await expect(requirePermission(['admin.users.manage', 'booking.read'])).resolves.toMatchObject({ id: engineer.id })
  })

  it('requireAdmin and requireRole distinguish roles', async () => {
    currentSession = sessionFor(engineer)
    await expect(requireAdmin()).rejects.toBeInstanceOf(ForbiddenError)
    await expect(requireRole('ENGINEER', 'ADMIN')).resolves.toMatchObject({ role: 'ENGINEER' })

    currentSession = sessionFor(admin)
    await expect(requireAdmin()).resolves.toMatchObject({ role: 'ADMIN' })
  })

  it('a disabled account is unauthorized even with a permission it used to hold', async () => {
    currentSession = sessionFor(disabled)
    await expect(requirePermission('booking.read')).rejects.toBeInstanceOf(UnauthorizedError)
  })
})
