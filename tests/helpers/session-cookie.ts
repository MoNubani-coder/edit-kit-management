import type { UserRole } from '@prisma/client'
import { encode } from 'next-auth/jwt'

/**
 * Builds a genuine Auth.js session cookie for proxy tests.
 *
 * Uses the same encoder and secret as the application, so the proxy decrypts
 * it exactly as it would a browser's cookie. The salt is the cookie name, which
 * is `authjs.session-token` over plain HTTP (no `__Secure-` prefix).
 */

export const SESSION_COOKIE_NAME = 'authjs.session-token'

export interface SessionTokenInput {
  sub: string
  name?: string
  email?: string
  role: UserRole
  sessionVersion?: number
  /** Defaults to "now"; pass an old timestamp to simulate an expired session. */
  authenticatedAt?: number
}

export async function sessionCookie(input: SessionTokenInput): Promise<string> {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set.')

  const token = await encode({
    token: {
      sub: input.sub,
      name: input.name ?? 'Test User',
      email: input.email ?? 'test@example.test',
      role: input.role,
      sessionVersion: input.sessionVersion ?? 0,
      authenticatedAt: input.authenticatedAt ?? Date.now(),
    },
    secret,
    salt: SESSION_COOKIE_NAME,
    maxAge: 8 * 60 * 60,
  })

  return `${SESSION_COOKIE_NAME}=${token}`
}
