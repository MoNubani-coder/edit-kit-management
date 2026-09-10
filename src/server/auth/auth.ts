import 'server-only'

import { UserStatus } from '@prisma/client'
import NextAuth, { CredentialsSignin } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import Credentials from 'next-auth/providers/credentials'

import { loginSchema } from '@/lib/validation/auth'
import { prisma } from '@/server/db/prisma'

import { authConfig } from './auth.config'
import { type SignInResult, signInWithPassword } from './authenticate'
import { requestContextFrom } from './credentials'
import { loginRateLimiter, loginRateLimitKeys } from './rate-limit'
import { CREDENTIALS_ERROR_CODES } from './sign-in-codes'

/**
 * The Auth.js instance used by the application (route handler, server
 * components, server actions). Builds on the proxy-safe `authConfig` and adds:
 *
 *  1. The Credentials provider, delegating to `signInWithPassword` - the local
 *     bcrypt path or the corporate directory, decided server-side - wrapped in
 *     the login rate limiter. The limiter lives here rather than in the form
 *     action because Auth.js also exposes the credentials callback directly at
 *     /api/auth/callback/credentials; every path into password checking must
 *     pass the same gate.
 *  2. A `jwt` callback that re-checks the database on every session read: the
 *     account must still exist, be ACTIVE and carry the same `sessionVersion`
 *     as the token. Suspending a user or bumping their version signs them out
 *     on their very next request - the kill switch from AD-2.
 *
 * Whichever way somebody signed in, the session is the same: a local `User`
 * row's id, name, email, role and sessionVersion. The directory is consulted
 * once, at sign-in, and never again for the life of the session.
 *
 * Only `handlers`, `auth`, `signIn` and `signOut` leave this folder. The rest
 * of the application never imports `next-auth` directly (AD-3).
 */

export { CREDENTIALS_ERROR_CODES }

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

export class AccountNotProvisionedError extends CredentialsSignin {
  code = CREDENTIALS_ERROR_CODES.notProvisioned
}

export class DirectoryUnavailableError extends CredentialsSignin {
  code = CREDENTIALS_ERROR_CODES.directoryUnavailable
}

export class AuthMisconfiguredError extends CredentialsSignin {
  code = CREDENTIALS_ERROR_CODES.misconfigured
}

/**
 * The typed error for a refused sign-in. Kept as a pure function so the
 * mapping - which reasons say what - can be tested without Auth.js.
 */
export function errorForSignInResult(result: Exclude<SignInResult, { ok: true }>): CredentialsSignin {
  switch (result.reason) {
    case 'disabled':
      return new AccountDisabledError()
    case 'locked': {
      const error = new AccountLockedError()
      error.retryAfterMinutes = result.retryAfterMinutes
      return error
    }
    case 'not_provisioned':
      return new AccountNotProvisionedError()
    case 'unavailable':
      return new DirectoryUnavailableError()
    case 'misconfigured':
      return new AuthMisconfiguredError()
    default:
      return new InvalidCredentialsError()
  }
}

const credentialsSchema = loginSchema.pick({ username: true, password: true })

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
      name: 'Username and password',
      credentials: {
        username: { label: 'Username or email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },

      async authorize(credentials, request) {
        const parsed = credentialsSchema.safeParse(credentials)
        if (!parsed.success) throw new InvalidCredentialsError()

        const context = requestContextFrom(request.headers)
        const limitKeys = loginRateLimitKeys(context.ipAddress, parsed.data.username)

        const limit = await loginRateLimiter.check(limitKeys)
        if (!limit.allowed) {
          const error = new RateLimitedError()
          error.retryAfterSeconds = limit.retryAfterSeconds
          throw error
        }

        const result = await signInWithPassword(prisma, parsed.data, context)

        if (result.ok) {
          await loginRateLimiter.reset(limitKeys)
          return result.user
        }

        // Only failures that reveal nothing count towards the limit; a correct
        // password against a disabled or locked account is not an attack, and
        // neither is an outage.
        if (result.reason === 'invalid') await loginRateLimiter.recordFailure(limitKeys)

        throw errorForSignInResult(result)
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    async jwt(params) {
      const token = await authConfig.callbacks.jwt(params)
      if (!token) return null

      // At sign-in the user row was read milliseconds ago by signInWithPassword.
      if (params.trigger === 'signIn') return token

      return revalidateToken(token)
    },
  },
})
