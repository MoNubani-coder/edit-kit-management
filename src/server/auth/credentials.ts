import { AuditAction, UserStatus, type UserRole } from '@prisma/client'

import { env } from '@/lib/env'
import type { Db } from '@/server/db/prisma'
import { recordAudit } from '@/server/services/audit.service'

import { verifyPassword } from './password'

/**
 * Email + password verification against the users table.
 *
 * Deliberately independent of Auth.js so it can be unit-tested against a real
 * database without a request context. The Credentials provider in auth.ts is a
 * thin adapter over `verifyCredentials`.
 *
 * Anti-enumeration policy: a *wrong* password always yields `invalid`, whether
 * the email exists, the account is disabled or the account is locked. Only a
 * *correct* password - which proves the caller controls the account - unlocks
 * the more specific `disabled` and `locked` answers. Timing is equalised by
 * `verifyPassword`, which hashes against a decoy when there is nothing to
 * compare with.
 */

export interface CredentialsInput {
  email: string
  password: string
}

export interface RequestContext {
  ipAddress?: string | null
  userAgent?: string | null
}

/** What the session is built from. Never includes the password hash. */
export interface AuthenticatedUser {
  id: string
  name: string
  email: string
  role: UserRole
  sessionVersion: number
}

export type CredentialsFailureReason = 'invalid' | 'disabled' | 'locked'

export type VerifyCredentialsResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'disabled' }
  | { ok: false; reason: 'locked'; retryAfterMinutes: number }

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  passwordHash: true,
  failedLoginAttempts: true,
  lockedUntil: true,
  sessionVersion: true,
  deletedAt: true,
} as const

export async function verifyCredentials(
  db: Db,
  input: CredentialsInput,
  context: RequestContext = {},
  now: Date = new Date(),
): Promise<VerifyCredentialsResult> {
  const email = input.email.trim().toLowerCase()

  const user = await db.user.findUnique({ where: { email }, select: userSelect })

  // Always runs, even for unknown users, so response time does not leak
  // whether an account exists.
  const passwordMatches = await verifyPassword(input.password, user?.passwordHash)

  if (!user || user.deletedAt) {
    await recordAudit(db, {
      action: AuditAction.LOGIN_FAILED,
      entityType: 'User',
      actorName: email,
      summary: 'Sign-in failed: unknown account',
      metadata: { reason: 'unknown_account' },
      ...context,
    })
    return { ok: false, reason: 'invalid' }
  }

  if (!passwordMatches) {
    const failedLoginAttempts = user.failedLoginAttempts + 1
    const lockNow = failedLoginAttempts >= env.MAX_LOGIN_ATTEMPTS
    const lockedUntil = lockNow
      ? new Date(now.getTime() + env.LOGIN_LOCKOUT_MINUTES * 60_000)
      : user.lockedUntil

    await db.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts, lockedUntil },
    })

    await recordAudit(db, {
      action: AuditAction.LOGIN_FAILED,
      entityType: 'User',
      entityId: user.id,
      actorName: user.email,
      summary: lockNow
        ? `Sign-in failed: wrong password; account locked for ${env.LOGIN_LOCKOUT_MINUTES} minutes`
        : 'Sign-in failed: wrong password',
      metadata: { reason: 'wrong_password', failedLoginAttempts, locked: lockNow },
      ...context,
    })

    return { ok: false, reason: 'invalid' }
  }

  // From here on the password is correct, so specific reasons are safe to give.

  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    const retryAfterMinutes = Math.max(
      1,
      Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000),
    )

    await recordAudit(db, {
      action: AuditAction.LOGIN_FAILED,
      entityType: 'User',
      entityId: user.id,
      actorName: user.email,
      summary: 'Sign-in refused: account temporarily locked',
      metadata: { reason: 'locked', retryAfterMinutes },
      ...context,
    })

    return { ok: false, reason: 'locked', retryAfterMinutes }
  }

  if (user.status !== UserStatus.ACTIVE) {
    await recordAudit(db, {
      action: AuditAction.LOGIN_FAILED,
      entityType: 'User',
      entityId: user.id,
      actorName: user.email,
      actorRole: user.role,
      summary: `Sign-in refused: account status is ${user.status}`,
      metadata: { reason: 'inactive', status: user.status },
      ...context,
    })

    return { ok: false, reason: 'disabled' }
  }

  await db.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now },
  })

  await recordAudit(db, {
    action: AuditAction.LOGIN_SUCCESS,
    entityType: 'User',
    entityId: user.id,
    actorUserId: user.id,
    actorName: user.name,
    actorRole: user.role,
    summary: `${user.email} signed in`,
    ...context,
  })

  return {
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      sessionVersion: user.sessionVersion,
    },
  }
}

/** Client address and agent from an incoming request, for the audit trail. */
export function requestContextFrom(headers: Headers): RequestContext {
  const forwardedFor = headers.get('x-forwarded-for')
  const ipAddress =
    forwardedFor?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || null

  return {
    ipAddress: ipAddress ? ipAddress.slice(0, 64) : null,
    userAgent: headers.get('user-agent')?.slice(0, 512) ?? null,
  }
}
