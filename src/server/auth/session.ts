import 'server-only'

import { UserStatus, type UserRole } from '@prisma/client'
import { cache } from 'react'

import { prisma } from '@/server/db/prisma'

import { auth } from './auth'
import { ForbiddenError, UnauthorizedError } from './errors'
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
 * The current actor, or `null` when there is no valid session.
 *
 * Memoised per request with React `cache`, so a layout, a page and a handful
 * of components asking the same question cost one session decode and one
 * primary-key lookup.
 */
export const getCurrentUser = cache(async (): Promise<Actor | null> => {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null

  const user = await prisma.user.findUnique({ where: { id: userId }, select: actorSelect })
  if (!user || user.deletedAt || user.status !== UserStatus.ACTIVE) return null

  const editorProfile =
    user.editorProfile && !user.editorProfile.deletedAt && user.editorProfile.isActive
      ? user.editorProfile
      : null
  const engineerProfile =
    user.engineerProfile && !user.engineerProfile.deletedAt && user.engineerProfile.isActive
      ? user.engineerProfile
      : null

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    editorProfileId: editorProfile?.id ?? null,
    engineerProfileId: engineerProfile?.id ?? null,
  }
})

/** Throws `UnauthorizedError` when nobody is signed in. */
export async function requireAuth(): Promise<Actor> {
  const actor = await getCurrentUser()
  if (!actor) throw new UnauthorizedError()
  return actor
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
