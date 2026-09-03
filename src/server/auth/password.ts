import { compare, hash } from 'bcryptjs'

/**
 * Password hashing.
 *
 * bcrypt, cost 12, via the pure-JavaScript `bcryptjs` implementation. Argon2id
 * would be the textbook choice, but every Argon2 package for Node needs a native
 * build, which complicates the Alpine-based Docker image and every developer
 * machine. bcrypt at cost 12 (~250 ms per hash on current hardware) remains an
 * accepted choice for interactive logins, and the cost is stored inside the
 * hash, so it can be raised later without invalidating existing passwords.
 *
 * Nothing outside this module calls bcrypt directly - the seed, the reset
 * script and the credentials provider all go through here, so the algorithm
 * and cost live in exactly one place.
 */

export const BCRYPT_COST = 12

/** Minimum accepted password length for seeded, reset or changed passwords. */
export const MIN_PASSWORD_LENGTH = 12

/** bcrypt hashes look like `$2a$12$<22-char salt><31-char hash>`. */
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

export function isPasswordHash(value: string | null | undefined): value is string {
  return typeof value === 'string' && BCRYPT_HASH_PATTERN.test(value)
}

export async function hashPassword(plainText: string): Promise<string> {
  if (plainText.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }
  return hash(plainText, BCRYPT_COST)
}

/**
 * Constant-cost comparison. When the stored hash is missing (SSO account with no
 * local password, or no such user) a throw-away hash is compared instead, so
 * "user does not exist" takes as long as "wrong password". Without this, the
 * response time alone would reveal which emails have accounts.
 */
export async function verifyPassword(
  plainText: string,
  passwordHash: string | null | undefined,
): Promise<boolean> {
  if (!isPasswordHash(passwordHash)) {
    await compare(plainText, await getDecoyHash())
    return false
  }
  return compare(plainText, passwordHash)
}

let decoyHash: Promise<string> | undefined

function getDecoyHash(): Promise<string> {
  // Computed once per process; the value never matches anything because the
  // plaintext it was derived from is random and discarded.
  decoyHash ??= hash(crypto.randomUUID(), BCRYPT_COST)
  return decoyHash
}
