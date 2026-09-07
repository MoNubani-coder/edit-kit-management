import 'server-only'

import type { z } from 'zod'

import { DomainError } from '@/server/services/errors'

import { isAuthorizationError, isServiceUnavailableError } from './errors'
import type { Permission } from './permissions'
import { type Actor, requireAuth, requirePermission } from './session'

/**
 * The Server Action wrapper (AD-7).
 *
 * Every mutation is defined through `action()`, which makes three things
 * impossible to forget:
 *
 *  1. Authorization - `permission` is a required argument. A developer who
 *     wants "any signed-in user" has to write `'authenticated'` on purpose.
 *  2. Validation - the raw input is parsed with the given Zod schema before
 *     the handler sees it.
 *  3. Safe failure - authorization and validation problems come back as a
 *     typed result the form can render, never as a stack trace.
 *
 * Handlers may throw `ActionError` (or a service's `DomainError`) for expected
 * business failures ("user not found", "serial number already used"). Any
 * other exception is logged and reported generically, so internals never reach
 * the browser.
 */

export type ActionPermission = Permission | readonly Permission[] | 'authenticated'

export type ActionErrorCode = 'unauthorized' | 'forbidden' | 'validation' | 'rejected' | 'error'

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      error: ActionErrorCode
      message: string
      fieldErrors?: Record<string, string>
    }

/** An expected, user-facing failure raised inside a handler. */
export class ActionError extends Error {
  readonly fieldErrors: Record<string, string> | undefined

  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message)
    this.name = 'ActionError'
    this.fieldErrors = fieldErrors
  }
}

export interface ActionDefinition<Schema extends z.ZodType, Output> {
  permission: ActionPermission
  schema: Schema
  handler: (context: { actor: Actor; input: z.output<Schema> }) => Promise<Output>
}

function fieldErrorsFrom(error: z.ZodError<unknown>): Record<string, string> {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '_root'
    if (!fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return fieldErrors
}

export function action<Schema extends z.ZodType, Output>(
  definition: ActionDefinition<Schema, Output>,
): (rawInput: unknown) => Promise<ActionResult<Output>> {
  return async (rawInput) => {
    let actor: Actor
    try {
      actor =
        definition.permission === 'authenticated'
          ? await requireAuth()
          : await requirePermission(definition.permission)
    } catch (error) {
      if (isAuthorizationError(error)) {
        return {
          ok: false,
          error: error.status === 401 ? 'unauthorized' : 'forbidden',
          message: error.message,
        }
      }
      // The session could not be resolved. Report it as a plain, retryable
      // failure; the actor keeps their session and no internals are exposed.
      if (isServiceUnavailableError(error)) {
        return { ok: false, error: 'error', message: error.message }
      }
      throw error
    }

    const parsed = definition.schema.safeParse(rawInput)
    if (!parsed.success) {
      return {
        ok: false,
        error: 'validation',
        message: 'Check the highlighted fields.',
        fieldErrors: fieldErrorsFrom(parsed.error),
      }
    }

    try {
      const data = await definition.handler({ actor, input: parsed.data })
      return { ok: true, data }
    } catch (error) {
      if (error instanceof ActionError || error instanceof DomainError) {
        return { ok: false, error: 'rejected', message: error.message, fieldErrors: error.fieldErrors }
      }
      // Next.js control-flow errors (redirect, notFound, forbidden) must pass through untouched.
      if (error instanceof Error && 'digest' in error && typeof error.digest === 'string') {
        throw error
      }
      console.error('[action] unexpected failure', error)
      return { ok: false, error: 'error', message: 'Something went wrong. Please try again.' }
    }
  }
}
