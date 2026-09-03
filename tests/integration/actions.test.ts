import { UserRole, UserStatus } from '@prisma/client'
import type { Session } from 'next-auth'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestUser, deleteTestUsers, testDb, type TestUser } from '../helpers/db'

/**
 * A real Server Action (`setUserStatus`) invoked directly, the way a hostile
 * client could POST it. Authorization must come from the server-side session
 * and database, and insufficient permission must fail closed.
 */

let currentSession: Session | null = null
const auditWrites: unknown[] = []

vi.mock('@/server/auth/auth', () => ({
  auth: vi.fn(async () => currentSession),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'user-agent': 'vitest', 'x-forwarded-for': '10.0.0.1' })),
}))

vi.mock('@/server/services/audit.service', () => ({
  recordAudit: vi.fn(async (_db: unknown, entry: unknown) => {
    auditWrites.push(entry)
  }),
}))

const { setUserStatus } = await import('@/server/actions/admin-users.actions')

function sessionFor(user: TestUser): Session {
  return {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  }
}

let admin: TestUser
let engineer: TestUser
let target: TestUser

beforeAll(async () => {
  admin = await createTestUser(testDb, { role: UserRole.ADMIN })
  engineer = await createTestUser(testDb, { role: UserRole.ENGINEER })
  target = await createTestUser(testDb, { role: UserRole.VIEWER, tag: 'target' })
})

afterAll(async () => {
  await deleteTestUsers(testDb, [admin, engineer, target])
  await testDb.$disconnect()
})

beforeEach(() => {
  currentSession = null
  auditWrites.length = 0
})

describe('setUserStatus server action', () => {
  it('rejects anonymous callers as unauthorized and changes nothing', async () => {
    const result = await setUserStatus({ userId: target.id, status: 'SUSPENDED' })
    expect(result).toMatchObject({ ok: false, error: 'unauthorized' })

    const row = await testDb.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(row.status).toBe(UserStatus.ACTIVE)
  })

  it('rejects an ENGINEER as forbidden even though the request is well-formed', async () => {
    currentSession = sessionFor(engineer)

    const result = await setUserStatus({ userId: target.id, status: 'SUSPENDED' })
    expect(result).toMatchObject({ ok: false, error: 'forbidden' })

    const row = await testDb.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(row.status).toBe(UserStatus.ACTIVE)
    expect(auditWrites).toHaveLength(0)
  })

  it('ignores a role claimed by the client: the database says ENGINEER, so it is forbidden', async () => {
    currentSession = { ...sessionFor(engineer), user: { ...sessionFor(engineer).user, role: 'ADMIN' } }
    const result = await setUserStatus({ userId: target.id, status: 'SUSPENDED' })
    expect(result).toMatchObject({ ok: false, error: 'forbidden' })
  })

  it('validates input before touching the database', async () => {
    currentSession = sessionFor(admin)
    const result = await setUserStatus({ userId: target.id, status: 'DELETED' })
    expect(result).toMatchObject({ ok: false, error: 'validation' })
    if (!result.ok) expect(result.fieldErrors).toHaveProperty('status')
  })

  it('lets an ADMIN suspend an account, revokes its sessions and writes an audit entry', async () => {
    currentSession = sessionFor(admin)
    const before = await testDb.user.findUniqueOrThrow({ where: { id: target.id } })

    const result = await setUserStatus({ userId: target.id, status: 'SUSPENDED', reason: 'test' })
    expect(result).toMatchObject({ ok: true, data: { id: target.id, status: 'SUSPENDED' } })

    const after = await testDb.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(after.status).toBe(UserStatus.SUSPENDED)
    expect(after.sessionVersion).toBe(before.sessionVersion + 1)
    expect(auditWrites).toHaveLength(1)
    expect(auditWrites[0]).toMatchObject({ action: 'UPDATE', entityId: target.id, actorUserId: admin.id })

    // Re-activation clears lockout state.
    await testDb.user.update({ where: { id: target.id }, data: { failedLoginAttempts: 4, lockedUntil: new Date() } })
    const reactivated = await setUserStatus({ userId: target.id, status: 'ACTIVE' })
    expect(reactivated.ok).toBe(true)
    const restored = await testDb.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(restored.status).toBe(UserStatus.ACTIVE)
    expect(restored.failedLoginAttempts).toBe(0)
    expect(restored.lockedUntil).toBeNull()
  })

  it('refuses to let an admin change their own status', async () => {
    currentSession = sessionFor(admin)
    const result = await setUserStatus({ userId: admin.id, status: 'DISABLED' })
    expect(result).toMatchObject({ ok: false, error: 'rejected' })
    const row = await testDb.user.findUniqueOrThrow({ where: { id: admin.id } })
    expect(row.status).toBe(UserStatus.ACTIVE)
  })

  it('reports an unknown user as a rejection, not a crash', async () => {
    currentSession = sessionFor(admin)
    const result = await setUserStatus({ userId: 'nope', status: 'DISABLED' })
    expect(result).toMatchObject({ ok: false, error: 'rejected', message: 'User not found.' })
  })
})
