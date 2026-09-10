/**
 * The codes a refused sign-in is reported with, and the sentence each one
 * shows. Pure and framework-free, so the form action, the Auth.js error
 * classes and the tests all read the same table. Nothing here says whether a
 * name exists: a wrong password, an unknown name and a bad directory reply
 * all end in the same generic sentence.
 */

export const CREDENTIALS_ERROR_CODES = {
  invalid: 'invalid_credentials',
  disabled: 'account_disabled',
  locked: 'account_locked',
  rateLimited: 'rate_limited',
  /** The directory accepted the person, but no application account exists for them. */
  notProvisioned: 'account_not_provisioned',
  /** The directory could not be reached: a bounded, temporary failure. */
  directoryUnavailable: 'directory_unavailable',
  /** The directory answered in a way that means our settings are wrong. */
  misconfigured: 'auth_misconfigured',
} as const

export type CredentialsErrorCode = (typeof CREDENTIALS_ERROR_CODES)[keyof typeof CREDENTIALS_ERROR_CODES]

export const GENERIC_SIGN_IN_FAILURE = 'Incorrect username or password.'

/** What each refusal says to the person at the form. */
export function messageForSignInCode(code: string | undefined): string {
  switch (code) {
    case CREDENTIALS_ERROR_CODES.disabled:
      return 'This account is not active. Contact an administrator to restore access.'
    case CREDENTIALS_ERROR_CODES.locked:
      return 'This account is temporarily locked after repeated failed attempts. Try again later.'
    case CREDENTIALS_ERROR_CODES.rateLimited:
      return 'Too many sign-in attempts from this location. Wait a few minutes and try again.'
    case CREDENTIALS_ERROR_CODES.notProvisioned:
      return 'Your account is not set up for this application yet. Contact an administrator to be given access.'
    case CREDENTIALS_ERROR_CODES.directoryUnavailable:
      return 'The sign-in service is temporarily unavailable. Please try again in a moment.'
    case CREDENTIALS_ERROR_CODES.misconfigured:
      return 'Sign-in is unavailable right now. Please try again later or contact an administrator.'
    default:
      return GENERIC_SIGN_IN_FAILURE
  }
}
