import type { Permission } from './permissions'

/**
 * Authorization failures as typed errors.
 *
 * The auth helpers throw these; the *edges* of the application translate them:
 *  - pages         -> redirect('/login') or forbidden()   (page-guards.ts)
 *  - route handlers -> 401 / 403 JSON                     (api.ts)
 *  - server actions -> { ok: false, error: 'unauthorized' | 'forbidden' } (action.ts)
 *
 * Keeping the errors framework-free means services and the DAL can be unit
 * tested without a Next.js request context.
 */

export class UnauthorizedError extends Error {
  readonly status = 401 as const

  constructor(message = 'Authentication required.') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const
  readonly permission: Permission | undefined

  constructor(message = 'You do not have permission to do that.', permission?: Permission) {
    super(message)
    this.name = 'ForbiddenError'
    this.permission = permission
  }
}

export type AuthorizationError = UnauthorizedError | ForbiddenError

export function isAuthorizationError(error: unknown): error is AuthorizationError {
  return error instanceof UnauthorizedError || error instanceof ForbiddenError
}
