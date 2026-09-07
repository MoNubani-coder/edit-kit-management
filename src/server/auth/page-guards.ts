import 'server-only'

import { forbidden, redirect } from 'next/navigation'

import { ServiceUnavailableError } from './errors'
import { canAny, type Permission } from './permissions'
import { LOGIN_PATH } from './route-policy'
import { type Actor, resolveSession } from './session'

/**
 * Page-layer guards for Server Components.
 *
 * The plain `require*` helpers throw; inside a rendering page that would mean
 * an error boundary and a 500. These variants produce the right HTTP answer:
 * no session -> redirect to /login; session without permission -> 403 via
 * Next.js `forbidden()` and the nearest forbidden.tsx.
 *
 * A session that could not be resolved because the database is unreachable is
 * neither of those: it raises `ServiceUnavailableError` for the nearest
 * error.tsx, which keeps the visitor's session intact and the failure bounded.
 * Redirecting to /login here instead is what made the old loop possible.
 *
 * Route handlers and server actions must not use these - see api.ts and
 * action.ts.
 */

export async function requireAuthForPage(): Promise<Actor> {
  const resolution = await resolveSession()
  if (resolution.status === 'unavailable') throw new ServiceUnavailableError()
  if (resolution.status === 'anonymous') redirect(LOGIN_PATH)
  return resolution.actor
}

export async function requirePermissionForPage(
  permission: Permission | readonly Permission[],
): Promise<Actor> {
  const actor = await requireAuthForPage()
  const anyOf = Array.isArray(permission) ? permission : [permission as Permission]

  if (!canAny(actor, anyOf)) forbidden()

  return actor
}

export async function requireAdminForPage(): Promise<Actor> {
  const actor = await requireAuthForPage()
  if (actor.role !== 'ADMIN') forbidden()
  return actor
}
