import 'server-only'

import { forbidden, redirect } from 'next/navigation'

import { canAny, type Permission } from './permissions'
import { LOGIN_PATH } from './route-policy'
import { type Actor, getCurrentUser } from './session'

/**
 * Page-layer guards for Server Components.
 *
 * The plain `require*` helpers throw; inside a rendering page that would mean
 * an error boundary and a 500. These variants produce the right HTTP answer:
 * no session -> redirect to /login; session without permission -> 403 via
 * Next.js `forbidden()` and the nearest forbidden.tsx.
 *
 * Route handlers and server actions must not use these - see api.ts and
 * action.ts.
 */

export async function requireAuthForPage(): Promise<Actor> {
  const actor = await getCurrentUser()
  if (!actor) redirect(LOGIN_PATH)
  return actor
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
