import { UserRole, UserStatus } from '@prisma/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestUser, deleteTestUsers, testDb, type TestUser } from '../helpers/db'

/**
 * How a database outage differs from a revoked session, at the one place where
 * the difference decides whether somebody's cookie is thrown away.
 *
 * Auth.js clears the session cookie when the `jwt` callback returns `null`.
 * `revalidateToken` is that callback's database half, so `null` must mean
 * "proven invalid" and nothing else. An unreachable database proves nothing:
 * the token is returned untouched, the cookie survives, and authorization is
 * still refused for the duration by `resolveSession()`, which reads the
 * account itself.
 */

let databaseDown = false
let reads = 0

vi.mock('@/server/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: async (args: Parameters<typeof testDb.user.findUnique>[0]) => {
        reads += 1
        if (databaseDown) throw new Error("Can't reach database server at `localhost:5432`")
        return testDb.user.findUnique(args)
      },
    },
  },
}))

const { revalidateToken } = await import('@/server/auth/auth')

let user: TestUser

beforeAll(async () => {
  user = await createTestUser(testDb, { role: UserRole.ENGINEER })
})

afterAll(async () => {
  await deleteTestUsers(testDb, [user])
  await testDb.$disconnect()
})

let logged: unknown[][] = []

beforeEach(() => {
  databaseDown = false
  reads = 0
  logged = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('revalidateToken while the database is unreachable', () => {
  it('keeps the token instead of ending the session', async () => {
    databaseDown = true

    const token = await revalidateToken({ sub: user.id, role: 'ENGINEER', sessionVersion: 0, name: user.name })

    // Not null: null is what makes Auth.js clear the cookie.
    expect(token).not.toBeNull()
    expect(token?.sub).toBe(user.id)
    expect(reads).toBe(1)
    expect(String(logged[0]?.[0])).toContain('revalidation unavailable')
  })

  it('does not invent identity data it could not read', async () => {
    databaseDown = true

    const token = await revalidateToken({ sub: user.id, role: 'VIEWER', sessionVersion: 3, name: 'as issued' })

    expect(token).toMatchObject({ role: 'VIEWER', sessionVersion: 3, name: 'as issued' })
  })

  it('revalidates normally again once the database is back, refreshing the role', async () => {
    databaseDown = true
    expect(await revalidateToken({ sub: user.id, role: 'VIEWER', sessionVersion: 0 })).not.toBeNull()

    databaseDown = false
    const token = await revalidateToken({ sub: user.id, role: 'VIEWER', sessionVersion: 0, name: 'stale' })

    expect(token?.role).toBe('ENGINEER')
    expect(token?.name).toBe(user.name)
  })
})

describe('revalidateToken on a definitive answer', () => {
  it('ends the session for a revoked session version', async () => {
    await testDb.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } })

    expect(await revalidateToken({ sub: user.id, role: 'ENGINEER', sessionVersion: 0 })).toBeNull()
    expect(await revalidateToken({ sub: user.id, role: 'ENGINEER', sessionVersion: 1 })).not.toBeNull()

    await testDb.user.update({ where: { id: user.id }, data: { sessionVersion: 0 } })
  })

  it('ends the session for a suspended account', async () => {
    await testDb.user.update({ where: { id: user.id }, data: { status: UserStatus.SUSPENDED } })
    expect(await revalidateToken({ sub: user.id, role: 'ENGINEER', sessionVersion: 0 })).toBeNull()
    await testDb.user.update({ where: { id: user.id }, data: { status: UserStatus.ACTIVE } })
  })

  it('ends the session for a deleted account', async () => {
    await testDb.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } })
    expect(await revalidateToken({ sub: user.id, role: 'ENGINEER', sessionVersion: 0 })).toBeNull()
    await testDb.user.update({ where: { id: user.id }, data: { deletedAt: null } })
  })

  it('ends the session for an unknown account or a token without a subject', async () => {
    expect(await revalidateToken({ sub: 'does-not-exist', role: 'ADMIN', sessionVersion: 0 })).toBeNull()
    expect(await revalidateToken({ role: 'ADMIN', sessionVersion: 0 })).toBeNull()
    // No subject means no read was attempted.
    expect(reads).toBe(1)
  })
})
