import type { JWT } from 'next-auth/jwt'
import { describe, expect, it } from 'vitest'

import { authConfig, hasSessionExpired, SESSION_MAX_AGE_SECONDS } from '@/server/auth/auth.config'

type JwtParams = Parameters<typeof authConfig.callbacks.jwt>[0]
type SessionParams = Parameters<typeof authConfig.callbacks.session>[0]

const user = {
  id: 'user_1',
  name: 'Khalid Al Mansoori',
  email: 'engineer@example.ae',
  role: 'ENGINEER',
  sessionVersion: 3,
} as const

describe('jwt callback', () => {
  it('copies identity, role and session version at sign-in and stamps the sign-in time', () => {
    const before = Date.now()
    const token = authConfig.callbacks.jwt({
      token: { picture: 'https://example.test/avatar.png' },
      user,
      trigger: 'signIn',
    } as unknown as JwtParams) as JWT

    expect(token.sub).toBe('user_1')
    expect(token.role).toBe('ENGINEER')
    expect(token.sessionVersion).toBe(3)
    expect(token.email).toBe('engineer@example.ae')
    expect(token.authenticatedAt).toBeGreaterThanOrEqual(before)
    expect(token.picture).toBeUndefined()
  })

  it('invalidates a token once the absolute session lifetime has passed, however active the user was', () => {
    const stale = Date.now() - (SESSION_MAX_AGE_SECONDS + 60) * 1000
    const result = authConfig.callbacks.jwt({
      token: { sub: 'user_1', role: 'ADMIN', sessionVersion: 0, authenticatedAt: stale },
    } as unknown as JwtParams)

    expect(result).toBeNull()
    expect(hasSessionExpired(stale)).toBe(true)
    expect(hasSessionExpired(Date.now())).toBe(false)
    expect(hasSessionExpired(undefined)).toBe(true)
  })

  it('rejects tokens missing the fields the application relies on', () => {
    const now = Date.now()
    expect(authConfig.callbacks.jwt({ token: { sub: 'x', authenticatedAt: now } } as unknown as JwtParams)).toBeNull()
    expect(
      authConfig.callbacks.jwt({ token: { role: 'ADMIN', sessionVersion: 0, authenticatedAt: now } } as unknown as JwtParams),
    ).toBeNull()
  })
})

describe('session callback', () => {
  it('exposes exactly id, name, email and role', () => {
    const session = authConfig.callbacks.session({
      session: { expires: '2026-09-03T20:00:00.000Z', user: { name: 'ignored', email: 'ignored' } },
      token: {
        sub: 'user_1',
        name: 'Khalid Al Mansoori',
        email: 'engineer@example.ae',
        role: 'ENGINEER',
        sessionVersion: 3,
        authenticatedAt: Date.now(),
      },
    } as unknown as SessionParams)

    expect(session).toEqual({
      expires: '2026-09-03T20:00:00.000Z',
      user: { id: 'user_1', name: 'Khalid Al Mansoori', email: 'engineer@example.ae', role: 'ENGINEER' },
    })
    expect(Object.keys(session.user).sort()).toEqual(['email', 'id', 'name', 'role'])
  })
})
