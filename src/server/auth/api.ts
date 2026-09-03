import 'server-only'

import type { NextRequest } from 'next/server'

import { isAuthorizationError } from './errors'
import type { Permission } from './permissions'
import { type Actor, requireAuth, requirePermission } from './session'

/**
 * Authorization for Route Handlers.
 *
 * `withApiAuth(permission, handler)` resolves the actor, enforces the
 * permission and turns authorization failures into JSON 401 / 403 responses.
 * Anything else propagates and becomes a 500, which is the honest answer for
 * an unexpected failure.
 */

export type ApiPermission = Permission | readonly Permission[] | 'authenticated'

export interface ApiContext {
  actor: Actor
  request: NextRequest
}

export function unauthorizedResponse(): Response {
  return Response.json(
    { error: 'unauthorized', message: 'Authentication required.' },
    { status: 401, headers: { 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Cookie' } },
  )
}

export function forbiddenResponse(): Response {
  return Response.json(
    { error: 'forbidden', message: 'You do not have permission to access this resource.' },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function resolveApiActor(permission: ApiPermission): Promise<Actor> {
  return permission === 'authenticated' ? requireAuth() : requirePermission(permission)
}

export function withApiAuth(
  permission: ApiPermission,
  handler: (context: ApiContext) => Promise<Response> | Response,
): (request: NextRequest) => Promise<Response> {
  return async (request) => {
    let actor: Actor
    try {
      actor = await resolveApiActor(permission)
    } catch (error) {
      if (isAuthorizationError(error)) {
        return error.status === 401 ? unauthorizedResponse() : forbiddenResponse()
      }
      throw error
    }

    return handler({ actor, request })
  }
}
