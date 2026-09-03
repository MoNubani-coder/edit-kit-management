import { UserRole, UserStatus } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { revalidateToken } from '@/server/auth/auth'

import { createTestUser, deleteTestUsers, testDb, type TestUser } from '../helpers/db'

/**
 * The sessionVersion kill switch (AD-2), exercised through the same function
 * the production jwt callback calls on every session read.
 */

let user: TestUser

beforeAll(async () => {
  user = await createTestUser(testDb, { role: UserRole.ENGINEER })
})

afterAll(async () => {
  await deleteTestUsers(testDb, [user])
  await testDb.$disconnect()
})

describe('revalidateToken', () => {
  it('keeps a token whose account is active and whose session version matches, refreshing the role', async () => {
    const token = await revalidateToken({ sub: user.id, role: 'VIEWER', sessionVersion: 0, name: 'stale' })
    expect(token).not.toBeNull()
    expect(token?.role).toBe('ENGINEER')
    expect(token?.name).toBe(user.name)
  })

  it('ends the session when the account is suspended', async () => {
    await testDb.user.update({ where: { id: user.id }, data: { status: UserStatus.SUSPENDED } })
    expect(await revalidateToken({ sub: user.id, role: 'ENGINEER', sessionVersion: 0 })).toBeNull()
    await testDb.user.update({ where: { id: user.id }, data: { status: UserStatus.ACTIVE } })
  })

  it('ends the session when sessionVersion has been bumped', async () => {
    await testDb.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } })
    expect(await revalidateToken({ sub: user.id, role: 'ENGINEER', sessionVersion: 0 })).toBeNull()
    expect(await revalidateToken({ sub: user.id, role: 'ENGINEER', sessionVersion: 1 })).not.toBeNull()
  })

  it('ends the session for unknown or deleted accounts', async () => {
    expect(await revalidateToken({ sub: 'does-not-exist', role: 'ADMIN', sessionVersion: 0 })).toBeNull()
    expect(await revalidateToken({ role: 'ADMIN', sessionVersion: 0 })).toBeNull()
  })
})
