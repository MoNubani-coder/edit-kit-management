import { describe, expect, it } from 'vitest'

import { InMemoryLoginRateLimiter, loginRateLimitKeys } from '@/server/auth/rate-limit'

describe('in-memory login rate limiter', () => {
  it('allows attempts until the failure budget is spent, then blocks with a retry hint', async () => {
    let now = 1_000_000
    const limiter = new InMemoryLoginRateLimiter({ maxAttempts: 3, windowMs: 60_000, now: () => now })
    const keys = loginRateLimitKeys('10.0.0.1', 'Someone@Example.ae')

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await limiter.check(keys)).allowed).toBe(true)
      await limiter.recordFailure(keys)
    }

    const blocked = await limiter.check(keys)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60)

    now += 61_000
    expect((await limiter.check(keys)).allowed).toBe(true)
  })

  it('limits per key, so one address cannot exhaust another account and vice versa', async () => {
    const limiter = new InMemoryLoginRateLimiter({ maxAttempts: 2, windowMs: 60_000, now: () => 5_000_000 })

    await limiter.recordFailure(loginRateLimitKeys('10.0.0.1', 'a@example.ae'))
    await limiter.recordFailure(loginRateLimitKeys('10.0.0.1', 'a@example.ae'))

    // Same address, different account: blocked by the address key.
    expect((await limiter.check(loginRateLimitKeys('10.0.0.1', 'b@example.ae'))).allowed).toBe(false)
    // Different address, same account: blocked by the account key.
    expect((await limiter.check(loginRateLimitKeys('10.0.0.2', 'a@example.ae'))).allowed).toBe(false)
    // Different address and account: unaffected.
    expect((await limiter.check(loginRateLimitKeys('10.0.0.2', 'b@example.ae'))).allowed).toBe(true)
  })

  it('resets after a successful sign-in', async () => {
    const limiter = new InMemoryLoginRateLimiter({ maxAttempts: 1, windowMs: 60_000, now: () => 9_000_000 })
    const keys = loginRateLimitKeys(null, 'a@example.ae')
    await limiter.recordFailure(keys)
    expect((await limiter.check(keys)).allowed).toBe(false)
    await limiter.reset(keys)
    expect((await limiter.check(keys)).allowed).toBe(true)
  })

  it('normalises the email key and omits the address key when the address is unknown', () => {
    expect(loginRateLimitKeys('1.2.3.4', ' User@Example.AE ')).toEqual(['ip:1.2.3.4', 'email:user@example.ae'])
    expect(loginRateLimitKeys(undefined, 'x@y.z')).toEqual(['email:x@y.z'])
    expect(loginRateLimitKeys(null, 'x@y.z')).toEqual(['email:x@y.z'])
  })
})
