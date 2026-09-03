/**
 * Login rate limiting - the seam, plus an in-process default.
 *
 * Two independent controls protect the login form:
 *
 *  - Account lockout (credentials.ts): N wrong passwords lock *that account*
 *    for a fixed period. Persisted on the user row, so it survives restarts and
 *    applies across instances.
 *  - Request rate limiting (this file): caps attempts *per client address* and
 *    *per target email* in a sliding window, so a bot cannot burn through the
 *    lockout budget of every account or hammer one account from many sessions.
 *
 * The in-memory implementation is right for a single container. A multi-instance
 * deployment swaps in a shared store (Redis, or a Postgres table) by providing
 * another `LoginRateLimiter` - the sign-in action only knows the interface.
 */

export interface RateLimitDecision {
  allowed: boolean
  /** Whole seconds until the next attempt may be made; 0 when allowed. */
  retryAfterSeconds: number
}

export interface LoginRateLimiter {
  /** Checks whether an attempt may proceed. Does not record anything. */
  check(keys: readonly string[]): Promise<RateLimitDecision>
  /** Records a failed attempt against every key. */
  recordFailure(keys: readonly string[]): Promise<void>
  /** Clears the counters after a successful sign-in. */
  reset(keys: readonly string[]): Promise<void>
}

export interface SlidingWindowOptions {
  /** Failed attempts allowed per key within the window. */
  maxAttempts: number
  /** Window length in milliseconds. */
  windowMs: number
  now?: () => number
}

/**
 * Sliding-window counter per key. Only *failures* count, so a legitimate user
 * who types the right password is never throttled by their own success.
 */
export class InMemoryLoginRateLimiter implements LoginRateLimiter {
  private readonly attempts = new Map<string, number[]>()
  private readonly maxAttempts: number
  private readonly windowMs: number
  private readonly now: () => number
  private lastSweep = 0

  constructor(options: SlidingWindowOptions) {
    this.maxAttempts = options.maxAttempts
    this.windowMs = options.windowMs
    this.now = options.now ?? Date.now
  }

  async check(keys: readonly string[]): Promise<RateLimitDecision> {
    const now = this.now()
    this.sweep(now)

    let retryAfterSeconds = 0
    for (const key of keys) {
      const recent = this.recentFor(key, now)
      if (recent.length >= this.maxAttempts) {
        const oldest = recent[0]
        const waitMs = oldest + this.windowMs - now
        retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil(waitMs / 1000))
      }
    }

    return { allowed: retryAfterSeconds === 0, retryAfterSeconds }
  }

  async recordFailure(keys: readonly string[]): Promise<void> {
    const now = this.now()
    for (const key of keys) {
      const recent = this.recentFor(key, now)
      recent.push(now)
      this.attempts.set(key, recent)
    }
  }

  async reset(keys: readonly string[]): Promise<void> {
    for (const key of keys) this.attempts.delete(key)
  }

  private recentFor(key: string, now: number): number[] {
    const cutoff = now - this.windowMs
    return (this.attempts.get(key) ?? []).filter((timestamp) => timestamp > cutoff)
  }

  /** Drops expired keys occasionally so the map cannot grow without bound. */
  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return
    this.lastSweep = now
    for (const [key, timestamps] of this.attempts) {
      if (timestamps.every((timestamp) => timestamp <= now - this.windowMs)) {
        this.attempts.delete(key)
      }
    }
  }
}

/**
 * Keys for one attempt: the account being targeted and, when known, the client
 * address. An unknown address is deliberately NOT keyed: a shared "unknown"
 * bucket would let one attacker exhaust the budget for every client whose
 * address the proxy failed to forward.
 */
export function loginRateLimitKeys(ipAddress: string | null | undefined, email: string): string[] {
  const keys = [`email:${email.trim().toLowerCase()}`]
  if (ipAddress) keys.unshift(`ip:${ipAddress}`)
  return keys
}

/** Process-wide default: 20 failures per 15 minutes per key. */
export const loginRateLimiter: LoginRateLimiter = new InMemoryLoginRateLimiter({
  maxAttempts: 20,
  windowMs: 15 * 60_000,
})
