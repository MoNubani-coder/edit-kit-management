import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import proxy, { config } from '@/proxy'

import { sessionCookie } from '../helpers/session-cookie'

/**
 * The proxy exercised end-to-end with genuine encrypted session cookies:
 * public routes pass, protected routes redirect anonymous visitors to /login
 * with a callbackUrl, admin routes answer 403 to non-admins, and tampered or
 * expired cookies count as anonymous.
 */

const ORIGIN = 'http://localhost:3000'

async function run(path: string, cookie?: string) {
  // The Next.js server always supplies host and x-forwarded-proto; Auth.js uses
  // them to pick the cookie name (no __Secure- prefix over plain HTTP).
  const request = new NextRequest(`${ORIGIN}${path}`, {
    headers: {
      host: 'localhost:3000',
      'x-forwarded-proto': 'http',
      ...(cookie ? { cookie } : {}),
    },
  })
  const response = await proxy(request, undefined as never)
  if (!response) throw new Error('proxy returned no response')
  return response
}

function isPassThrough(response: Response): boolean {
  return response.headers.get('x-middleware-next') === '1'
}

function redirectLocation(response: Response): URL | null {
  const location = response.headers.get('location')
  return location ? new URL(location) : null
}

describe('proxy: public routes', () => {
  it('/login is reachable without a session', async () => {
    const response = await run('/login')
    expect(response.status).toBe(200)
    expect(isPassThrough(response)).toBe(true)
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self' 'nonce-")
  })

  it('/api/health stays public', async () => {
    const response = await run('/api/health')
    expect(isPassThrough(response)).toBe(true)
  })

  it('/api/auth/* stays public so sign-in can happen', async () => {
    const response = await run('/api/auth/session')
    expect(isPassThrough(response)).toBe(true)
  })
})

describe('proxy: authentication', () => {
  it('/dashboard without a session redirects to /login with the original path preserved', async () => {
    const response = await run('/dashboard')
    expect([302, 307]).toContain(response.status)
    const location = redirectLocation(response)
    expect(location?.pathname).toBe('/login')
    expect(location?.searchParams.get('callbackUrl')).toBe('/dashboard')
  })

  it('/bookings?tab=x without a session preserves the query in callbackUrl', async () => {
    const location = redirectLocation(await run('/bookings?tab=history'))
    expect(location?.searchParams.get('callbackUrl')).toBe('/bookings?tab=history')
  })

  it('/dashboard with a valid session passes through with a nonce header for the page', async () => {
    const cookie = await sessionCookie({ sub: 'user_viewer', role: 'VIEWER' })
    const response = await run('/dashboard', cookie)
    expect(isPassThrough(response)).toBe(true)
    // The nonce reaches the rendering layer through the rewritten request headers.
    expect(response.headers.get('x-middleware-request-x-nonce')).toBeTruthy()
  })

  it('a signed-in user visiting /login is sent to the dashboard', async () => {
    const cookie = await sessionCookie({ sub: 'user_admin', role: 'ADMIN' })
    const location = redirectLocation(await run('/login', cookie))
    expect(location?.pathname).toBe('/dashboard')
  })

  it('/ dispatches by session state', async () => {
    expect(redirectLocation(await run('/'))?.pathname).toBe('/login')
    const cookie = await sessionCookie({ sub: 'user_admin', role: 'ADMIN' })
    expect(redirectLocation(await run('/', cookie))?.pathname).toBe('/dashboard')
  })

  it('an expired session (past the absolute lifetime) is treated as anonymous', async () => {
    const cookie = await sessionCookie({
      sub: 'user_admin',
      role: 'ADMIN',
      authenticatedAt: Date.now() - 9 * 60 * 60 * 1000,
    })
    const location = redirectLocation(await run('/dashboard', cookie))
    expect(location?.pathname).toBe('/login')
  })

  it('protected API routes answer JSON 401 to anonymous callers instead of redirecting', async () => {
    const response = await run('/api/me')
    expect(response.status).toBe(401)
    expect(response.headers.get('location')).toBeNull()
    expect(await response.json()).toMatchObject({ error: 'unauthorized' })
  })

  it('protected API routes pass through for a signed-in user', async () => {
    const cookie = await sessionCookie({ sub: 'user_viewer', role: 'VIEWER' })
    expect(isPassThrough(await run('/api/me', cookie))).toBe(true)
  })

  it('a tampered cookie is treated as anonymous', async () => {
    const location = redirectLocation(await run('/dashboard', 'authjs.session-token=not-a-real-token'))
    expect(location?.pathname).toBe('/login')
  })
})

describe('proxy: admin routes', () => {
  it('/admin/users answers 403 for a signed-in ENGINEER, without redirecting to login', async () => {
    const cookie = await sessionCookie({ sub: 'user_engineer', role: 'ENGINEER' })
    const response = await run('/admin/users', cookie)
    expect(response.status).toBe(403)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-rewrite')).toContain('/forbidden')
  })

  it('/admin answers 403 for VIEWER and EDITOR', async () => {
    for (const role of ['VIEWER', 'EDITOR'] as const) {
      const response = await run('/admin', await sessionCookie({ sub: `user_${role}`, role }))
      expect(response.status, role).toBe(403)
    }
  })

  it('/admin/users passes through for ADMIN', async () => {
    const cookie = await sessionCookie({ sub: 'user_admin', role: 'ADMIN' })
    expect(isPassThrough(await run('/admin/users', cookie))).toBe(true)
  })

  it('/admin/users without a session redirects to login (unauthenticated beats forbidden)', async () => {
    expect(redirectLocation(await run('/admin/users'))?.pathname).toBe('/login')
  })
})

describe('proxy: matcher', () => {
  it('skips Next internals and static assets but covers pages and API routes', () => {
    expect(config.matcher).toHaveLength(1)
    const [entry] = config.matcher
    // The negative look-ahead excludes framework assets and files with static
    // extensions; anything else - including /api/* - goes through the proxy.
    expect(entry.source).toContain('_next/static')
    expect(entry.source).toContain('_next/image')
    expect(entry.source).toContain('favicon.ico')
    expect(entry.source.includes('(?!api')).toBe(false)
    // Prefetch requests are excluded so link hovering does not trigger redirects.
    expect(entry.missing.map((condition) => condition.key)).toEqual(['next-router-prefetch', 'purpose'])
  })
})
