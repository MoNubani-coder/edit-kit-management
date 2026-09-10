import { z } from 'zod'

/**
 * Zod schemas shared by the login form (client-side hints) and the sign-in
 * server action (the check that counts).
 *
 * The sign-in name is a corporate username, a user principal name or a local
 * account's email, so it is only trimmed, capped and lower-cased here - which
 * of those it is gets decided on the server, never by the form. Password is
 * only checked for presence and a sanity cap: strength rules apply when a
 * password is *set*, never when it is *entered*, or existing users would be
 * locked out by a policy change.
 */

export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, 'Enter your username or email address.')
    .max(254, 'Username is too long.')
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1, 'Enter your password.').max(1024, 'Password is too long.'),
  callbackUrl: z.string().max(2048).optional(),
})

export type LoginInput = z.infer<typeof loginSchema>

export type LoginFieldErrors = Partial<Record<'username' | 'password', string>>

/** Result shape returned by the sign-in server action to `useActionState`. */
export type LoginFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: LoginFieldErrors }

export const INITIAL_LOGIN_STATE: LoginFormState = { status: 'idle' }

/** Applied when a password is created, reset or changed - never on login. */
export const newPasswordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(1024, 'Password is too long.')
  .refine((value) => value.trim().length === value.length, 'Password cannot start or end with spaces.')

/** Collapses Zod issues to one message per field for the form. */
export function loginFieldErrors(error: z.ZodError<unknown>): LoginFieldErrors {
  const fieldErrors: LoginFieldErrors = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if ((field === 'username' || field === 'password') && !fieldErrors[field]) {
      fieldErrors[field] = issue.message
    }
  }
  return fieldErrors
}
