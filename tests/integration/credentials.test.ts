import { UserRole, UserStatus } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

import { env } from '@/lib/env'
import { verifyCredentials } from '@/server/auth/credentials'
import { isPasswordHash, verifyPassword } from '@/server/auth/password'

import { createTestUser, TEST_PASSWORD, testDb, uniqueEmail, withRollback } from '../helpers/db'

/**
 * Credentials verification against a real PostgreSQL database. Each test runs
 * inside a transaction that is rolled back, so nothing - not even the audit
 * rows the code writes - survives the test.
 */

afterAll(async () => {
  await testDb.$disconnect()
})

describe('verifyCredentials', () => {
  it('accepts valid credentials and returns the identity the session is built from', async () => {
    await withRollback(async (tx) => {
      const user = await createTestUser(tx, { role: UserRole.ENGINEER })

      const result = await verifyCredentials(tx, { email: user.email.toUpperCase(), password: TEST_PASSWORD }, {
        ipAddress: '10.0.0.9',
        userAgent: 'vitest',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.user).toEqual({
          id: user.id,
          name: user.name,
          email: user.email,
          role: 'ENGINEER',
          sessionVersion: 0,
        })
        expect(result.user).not.toHaveProperty('passwordHash')
      }

      const row = await tx.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(row.lastLoginAt).not.toBeNull()
      expect(row.failedLoginAttempts).toBe(0)

      const audit = await tx.auditLog.findFirst({ where: { entityId: user.id, action: 'LOGIN_SUCCESS' } })
      expect(audit?.ipAddress).toBe('10.0.0.9')
    })
  })

  it('rejects a wrong password, counts the failure and says nothing more specific than "invalid"', async () => {
    await withRollback(async (tx) => {
      const user = await createTestUser(tx, { role: UserRole.ADMIN })

      const result = await verifyCredentials(tx, { email: user.email, password: 'definitely-not-the-password' })

      expect(result).toEqual({ ok: false, reason: 'invalid' })

      const row = await tx.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(row.failedLoginAttempts).toBe(1)
      expect(row.lastLoginAt).toBeNull()

      const audit = await tx.auditLog.findFirst({ where: { entityId: user.id, action: 'LOGIN_FAILED' } })
      expect(audit).not.toBeNull()
    })
  })

  it('fails safely for an unknown email with the same answer as a wrong password', async () => {
    await withRollback(async (tx) => {
      const result = await verifyCredentials(tx, { email: uniqueEmail('ghost'), password: TEST_PASSWORD })
      expect(result).toEqual({ ok: false, reason: 'invalid' })
    })
  })

  it('refuses inactive accounts even with the correct password', async () => {
    await withRollback(async (tx) => {
      for (const status of [UserStatus.DISABLED, UserStatus.SUSPENDED, UserStatus.INVITED]) {
        const user = await createTestUser(tx, { role: UserRole.EDITOR, status, tag: status.toLowerCase() })
        const result = await verifyCredentials(tx, { email: user.email, password: TEST_PASSWORD })
        expect(result, status).toEqual({ ok: false, reason: 'disabled' })
      }
    })
  })

  it('does not reveal that a disabled account exists when the password is wrong', async () => {
    await withRollback(async (tx) => {
      const user = await createTestUser(tx, { role: UserRole.EDITOR, status: UserStatus.DISABLED })
      const result = await verifyCredentials(tx, { email: user.email, password: 'wrong-password-here' })
      expect(result).toEqual({ ok: false, reason: 'invalid' })
    })
  })

  it('locks the account after the configured number of failures and reports the lock only to the real password', async () => {
    await withRollback(async (tx) => {
      const user = await createTestUser(tx, { role: UserRole.ENGINEER })

      for (let attempt = 0; attempt < env.MAX_LOGIN_ATTEMPTS; attempt += 1) {
        const failed = await verifyCredentials(tx, { email: user.email, password: `wrong-${attempt}` })
        expect(failed).toEqual({ ok: false, reason: 'invalid' })
      }

      const locked = await tx.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(locked.lockedUntil).not.toBeNull()

      // Still a wrong password: still just "invalid".
      expect(await verifyCredentials(tx, { email: user.email, password: 'wrong-again' })).toEqual({
        ok: false,
        reason: 'invalid',
      })

      // Correct password while locked: the honest, specific answer.
      const result = await verifyCredentials(tx, { email: user.email, password: TEST_PASSWORD })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('locked')
        if (result.reason === 'locked') {
          expect(result.retryAfterMinutes).toBeGreaterThan(0)
          expect(result.retryAfterMinutes).toBeLessThanOrEqual(env.LOGIN_LOCKOUT_MINUTES)
        }
      }

      // Once the lock has lapsed, the correct password works and the counter resets.
      const later = new Date(locked.lockedUntil!.getTime() + 1_000)
      const recovered = await verifyCredentials(tx, { email: user.email, password: TEST_PASSWORD }, {}, later)
      expect(recovered.ok).toBe(true)
      const reset = await tx.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(reset.failedLoginAttempts).toBe(0)
      expect(reset.lockedUntil).toBeNull()
    })
  })

  it('refuses accounts that have no local password (SSO-only) without leaking that fact', async () => {
    await withRollback(async (tx) => {
      const user = await createTestUser(tx, { role: UserRole.VIEWER, password: null })
      const result = await verifyCredentials(tx, { email: user.email, password: TEST_PASSWORD })
      expect(result).toEqual({ ok: false, reason: 'invalid' })
    })
  })
})

describe('password storage', () => {
  it('stores bcrypt hashes, never the plaintext, for test and seeded accounts alike', async () => {
    await withRollback(async (tx) => {
      const user = await createTestUser(tx, { role: UserRole.VIEWER })
      const row = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } })

      expect(row.passwordHash).not.toBe(TEST_PASSWORD)
      expect(row.passwordHash).not.toContain(TEST_PASSWORD)
      expect(isPasswordHash(row.passwordHash)).toBe(true)
      expect(row.passwordHash!.startsWith('$2')).toBe(true)
      expect(row.passwordHash).toMatch(/^\$2[aby]\$12\$/)
      expect(await verifyPassword(TEST_PASSWORD, row.passwordHash)).toBe(true)
      expect(await verifyPassword('not it', row.passwordHash)).toBe(false)
    })

    // Every account already in the database (the seeded ones) must comply too.
    const users = await testDb.user.findMany({ select: { email: true, passwordHash: true } })
    expect(users.length).toBeGreaterThan(0)
    for (const user of users) {
      if (user.passwordHash === null) continue
      expect(isPasswordHash(user.passwordHash), user.email).toBe(true)
    }
  })

  it('takes a comparable amount of time for a missing hash as for a present one', async () => {
    // Not a precise timing test - it only proves the decoy comparison runs.
    const started = performance.now()
    expect(await verifyPassword('anything', null)).toBe(false)
    const elapsed = performance.now() - started
    expect(elapsed).toBeGreaterThan(20)
  })
})
