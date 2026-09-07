import 'server-only'

import { UserStatus, type UserRole } from '@prisma/client'
import { cache } from 'react'

import { prisma } from '@/server/db/prisma'

import { auth } from './auth'
import { ForbiddenError, ServiceUnavailableError, UnauthorizedError } from './errors'
import { canAny, type Permission } from './permissions'

/**
 * Server-side identity and authorization helpers.
 *
 * `getCurrentUser()` is the only way application code learns who is calling.
 * It reads the Auth.js session, then loads the account from the database and
 * rejects it unless it is ACTIVE and not deleted. Nothing about the actor -
 * least of all the role - is ever taken from the browser.
 *
 * The `require*` helpers throw typed errors (errors.ts). Pages translate them
 * with page-guards.ts; route handlers with api.ts; server actions with
 * action.ts. Services and the DAL receive the resulting `Actor` and never
 * touch the session themselves.
 */

/** The authenticated caller, as every service and DAL function sees it. */
export interface Actor {
  id: string
  name: string
  email: string
  role: UserRole
  /** Set when the user is also an editor; scopes `booking.readOwn`. */
  editorProfileId: string | null
  /** Set when the user is an engineer. */
  engineerProfileId: string | null
}

const actorSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  deletedAt: true,
  editorProfile: { select: { id: true, deletedAt: true, isActive: true } },
  engineerProfile: { select: { id: true, deletedAt: true, isActive: true } },
} as const

/**
 * What a session read can conclude.
 *
 * `anonymous` is a *definitive* answer from the database: no such account, it
 * was deleted, it is not ACTIVE, or the session was revoked. `unavailable`
 * means the database could not be reached, so the session is neither valid nor
 * proven invalid. Keeping the two apart is what stops an outage from behaving
 * like a sign-out, and it is why an outage never clears a cookie.
 */
export type SessionResolution =
  | { status: 'signed-in'; actor: Actor }
  | { status: 'anonymous' }
  | { status: 'unavailable' }

/**
 * Resolves the caller once per request.
 *
 * Memoised with React `cache`, so a layout, a page and a handful of components
 * asking the same question cost one session decode and one primary-key lookup.
 */
export const resolveSession = cache(async (): Promise<SessionResolution> => {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { status: 'anonymous' }

  let user: Awaited<ReturnType<typeof readActorRow>>
  try {
    user = await readActorRow(userId)
  } catch (error) {
    // The account is probably fine; we cannot tell right now. Nothing is
    // authorised without a successful read, so failing "unknown" grants no
    // access - it only avoids pretending the visitor signed out.
    console.error('[auth] session could not be resolved', error)
    return { status: 'unavailable' }
  }

  if (!user || user.deletedAt || user.status !== UserStatus.ACTIVE) return { status: 'anonymous' }

  const editorProfile =
    user.editorProfile && !user.editorProfile.deletedAt && user.editorProfile.isActive
      ? user.editorProfile
      : null
  const engineerProfile =
    user.engineerProfile && !user.engineerProfile.deletedAt && user.engineerProfile.isActive
      ? user.engineerProfile
      : null

  return {
    status: 'signed-in',
    actor: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      editorProfileId: editorProfile?.id ?? null,
      engineerProfileId: engineerProfile?.id ?? null,
    },
  }
})

function readActorRow(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: actorSelect })
}

/**
 * The current actor, or `null` when there is no valid session.
 *
 * Callers that must tell an outage from a sign-out use `resolveSession()`;
 * this shorthand deliberately collapses both to `null` and is only for the
 * places where that is the right answer (the root dispatcher, signing out).
 */
export const getCurrentUser = cache(async (): Promise<Actor | null> => {
  const resolution = await resolveSession()
  return resolution.status === 'signed-in' ? resolution.actor : null
})

/**
 * Throws `UnauthorizedError` when nobody is signed in, or
 * `ServiceUnavailableError` when the session could not be resolved at all.
 */
export async function requireAuth(): Promise<Actor> {
  const resolution = await resolveSession()
  if (resolution.status === 'unavailable') throw new ServiceUnavailableError()
  if (resolution.status === 'anonymous') throw new UnauthorizedError()
  return resolution.actor
}

/** Alias for readers who prefer the longer name. */
export const requireAuthenticatedUser = requireAuth

/**
 * Throws `UnauthorizedError` without a session, `ForbiddenError` when the
 * actor holds none of the given permissions. A single permission or a list
 * (any-of) is accepted.
 */
export async function requirePermission(
  permission: Permission | readonly Permission[],
): Promise<Actor> {
  const actor = await requireAuth()
  const anyOf = Array.isArray(permission) ? permission : [permission as Permission]

  if (!canAny(actor, anyOf)) {
    throw new ForbiddenError(undefined, anyOf[0])
  }

  return actor
}

/** Prefer `requirePermission`. Role checks exist for the rare role-shaped rule. */
export async function requireRole(...roles: readonly UserRole[]): Promise<Actor> {
  const actor = await requireAuth()
  if (!roles.includes(actor.role)) throw new ForbiddenError()
  return actor
}

export async function requireAdmin(): Promise<Actor> {
  return requireRole('ADMIN')
}
