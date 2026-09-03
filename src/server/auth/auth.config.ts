import type { NextAuthConfig } from 'next-auth'

import { env } from '@/lib/env'

import { LOGIN_PATH } from './route-policy'

/**
 * Auth.js configuration shared by the proxy and the full server instance.
 *
 * This file must stay free of database access: `src/proxy.ts` builds an
 * Auth.js instance from it to decode the session cookie on every request, and
 * a database round-trip there would run for every navigation and prefetch. The
 * database-backed checks (account still active, session not revoked) live in
 * `auth.ts`, which layers the Credentials provider and a stricter `jwt`
 * callback on top of this config.
 *
 * Session strategy: stateless JWT in an httpOnly, SameSite=Lax cookie. Auth.js
 * forces JWT when a Credentials provider is used; database sessions are not an
 * option. Revocation is therefore handled by `User.sessionVersion` (AD-2).
 *
 * Adding Microsoft Entra ID later means appending a provider in `auth.ts` and
 * mapping its claims onto the same `role` / `sessionVersion` token fields.
 * Nothing outside `src/server/auth/` will change.
 */

export const SESSION_MAX_AGE_SECONDS = env.SESSION_MAX_AGE_SECONDS
export const SESSION_UPDATE_AGE_SECONDS = env.SESSION_UPDATE_AGE_SECONDS

/**
 * Auth.js extends the cookie on activity, which alone would let a session live
 * forever. `authenticatedAt` is stamped once at sign-in and never refreshed, so
 * the token dies `SESSION_MAX_AGE_SECONDS` after login regardless of activity.
 */
export function hasSessionExpired(authenticatedAt: unknown, now: number = Date.now()): boolean {
  if (typeof authenticatedAt !== 'number' || !Number.isFinite(authenticatedAt)) return true
  return now - authenticatedAt > SESSION_MAX_AGE_SECONDS * 1000
}

export const authConfig = {
  secret: env.AUTH_SECRET,
  trustHost: env.AUTH_TRUST_HOST,

  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },

  pages: {
    signIn: LOGIN_PATH,
    error: LOGIN_PATH,
  },

  // Providers are attached in auth.ts. The proxy never needs them.
  providers: [],

  callbacks: {
    /**
     * Shapes the token. Runs at sign-in (with `user`) and on every session read
     * (without). Returning `null` invalidates the session and clears the cookie.
     */
    jwt({ token, user, trigger }) {
      if (trigger === 'signIn' && user) {
        token.sub = user.id
        token.name = user.name
        token.email = user.email
        token.role = user.role
        token.sessionVersion = user.sessionVersion
        token.authenticatedAt = Date.now()
        // Never carry an avatar URL or anything else the app does not use.
        delete token.picture
      }

      if (hasSessionExpired(token.authenticatedAt)) return null
      if (!token.sub || !token.role || typeof token.sessionVersion !== 'number') return null

      return token
    },

    /** The session object exposed to the application: the minimum, nothing more. */
    session({ session, token }) {
      return {
        expires: session.expires,
        user: {
          id: token.sub ?? '',
          name: token.name ?? '',
          email: token.email ?? '',
          role: token.role ?? 'VIEWER',
        },
      }
    },
  },
} satisfies NextAuthConfig
