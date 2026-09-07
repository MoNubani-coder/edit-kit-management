import 'server-only'

import { UserStatus } from '@prisma/client'
import NextAuth, { CredentialsSignin } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import Credentials from 'next-auth/providers/credentials'

import { loginSchema } from '@/lib/validation/auth'
import { prisma } from '@/server/db/prisma'

import { authConfig } from './auth.config'
import { requestContextFrom, verifyCredentials } from './credentials'
import { loginRateLimiter, loginRateLimitKeys } from './rate-limit'

/**
 * The Auth.js instance used by the application (route handler, server
 * components, server actions). Builds on the proxy-safe `authConfig` and adds:
 *
 *  1. The Credentials provider, delegating to `verifyCredentials`, wrapped in
 *     the login rate limiter. The limiter lives here rather than in the form
 *     action because Auth.js also exposes the credentials callback directly at
 *     /api/auth/callback/credentials; every path into password checking must
 *     pass the same gate.
 *  2. A `jwt` callback that re-checks the database on every session read: the
 *     account must still exist, be ACTIVE and carry the same `sessionVersion`
 *     as the token. Suspending a user or bumping their version signs them out
 *     on their very next request - the kill switch from AD-2.
 *
 * Only `handlers`, `auth`, `signIn` and `signOut` leave this folder. The rest
 * of the application never imports `next-auth` directly, so swapping or adding
 * a provider (Entra ID) is contained here (AD-3).
 */

/** Error codes surfaced to the sign-in action. Never more specific than this. */
export const CREDENTIALS_ERROR_CODES = {
  invalid: 'invalid_credentials',
  disabled: 'account_disabled',
  locked: 'account_locked',
  rateLimited: 'rate_limited',
} as const

export class InvalidCredentialsError extends CredentialsSignin {
  code = CREDENTIALS_ERROR_CODES.invalid
}

export class AccountDisabledError extends CredentialsSignin {
  code = CREDENTIALS_ERROR_CODES.disabled
}

export class AccountLockedError extends CredentialsSignin {
  code = CREDENTIALS_ERROR_CODES.locked
  retryAfterMinutes = 0
}

export class RateLimitedError extends CredentialsSignin {
  code = CREDENTIALS_ERROR_CODES.rateLimited
  retryAfterSeconds = 0
}

const credentialsSchema = loginSchema.pick({ email: true, password: true })

/**
 * Confirms the account behind a token is still allowed in. Returns the token
 * with fresh identity fields, or `null` to end the session.
 *
 * Returning `null` makes Auth.js clear the session cookie, so it is reserved
 * for a definitive answer from the database: unknown, deleted, not ACTIVE, or a
 * revoked session version. When the database cannot be reached the token is
 * returned untouched - the session is not proven invalid, and signing everyone
 * out over an outage would be both wrong and, before the login route was
 * fixed, a redirect loop. Nothing is authorised on the strength of this token
 * alone: `resolveSession()` still reads the account for every page, action and
 * route handler, and answers "unavailable" while the outage lasts.
 */
export async function revalidateToken(token: JWT): Promise<JWT | null> {
  if (!token.sub) return null

  let user: Awaited<ReturnType<typeof readSessionUser>>
  try {
    user = await readSessionUser(token.sub)
  } catch (error) {
    console.error('[auth] session revalidation unavailable, keeping the token', error)
    return token
  }

  if (!user || user.deletedAt || user.status !== UserStatus.ACTIVE) return null
  if (user.sessionVersion !== token.sessionVersion) return null

  // Role and display fields are refreshed from the database, so a role change
  // takes effect on the next request rather than at the next login.
  token.name = user.name
  token.email = user.email
  token.role = user.role

  return token
}

function readSessionUser(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { name: true, email: true, role: true, status: true, sessionVersion: true, deletedAt: true },
  })
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  logger: {
    // A wrong password is an audited business event, not a server error.
    // Everything else Auth.js considers an error still reaches the log.
    error(error) {
      if (error instanceof CredentialsSignin) return
      console.error('[auth]', error)
    },
    warn(code) {
      console.warn('[auth]', code)
    },
    debug() {},
  },

  providers: [
    Credentials({
      id: 'credentials',
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },

      async authorize(credentials, request) {
        const parsed = credentialsSchema.safeParse(credentials)
        if (!parsed.success) throw new InvalidCredentialsError()

        const context = requestContextFrom(request.headers)
        const limitKeys = loginRateLimitKeys(context.ipAddress, parsed.data.email)

        const limit = await loginRateLimiter.check(limitKeys)
        if (!limit.allowed) {
          const error = new RateLimitedError()
          error.retryAfterSeconds = limit.retryAfterSeconds
          throw error
        }

        const result = await verifyCredentials(prisma, parsed.data, context)

        if (result.ok) {
          await loginRateLimiter.reset(limitKeys)
          return result.user
        }

        // Only failures that reveal nothing count towards the limit; a correct
        // password against a disabled or locked account is not an attack.
        if (result.reason === 'invalid') await loginRateLimiter.recordFailure(limitKeys)

        switch (result.reason) {
          case 'disabled':
            throw new AccountDisabledError()
          case 'locked': {
            const error = new AccountLockedError()
            error.retryAfterMinutes = result.retryAfterMinutes
            throw error
          }
          default:
            throw new InvalidCredentialsError()
        }
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    async jwt(params) {
      const token = await authConfig.callbacks.jwt(params)
      if (!token) return null

      // At sign-in the user row was read milliseconds ago by verifyCredentials.
      if (params.trigger === 'signIn') return token

      return revalidateToken(token)
    },
  },
})
