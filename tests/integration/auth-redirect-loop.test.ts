import { UserRole, UserStatus } from '@prisma/client'
import type { Session } from 'next-auth'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServiceUnavailableError } from '@/server/auth/errors'
import { HOME_PATH, LOGIN_PATH } from '@/server/auth/route-policy'

import { createTestUser, deleteTestUsers, testDb, type TestUser } from '../helpers/db'
import { sessionCookie } from '../helpers/session-cookie'

/**
 * Regression cover for the /login <-> /dashboard redirect loop.
 *
 * The bug: the request gate decodes the session cookie and never reads the
 * database, so a cookie the database rejects looked signed in there. The gate
 * therefore sent it away from /login to the home page, while every page under
 * the shell resolved the same cookie against the database, found nothing and
 * redirected back to /login. The browser gave up with ERR_TOO_MANY_REDIRECTS.
 *
 * These tests walk the two layers exactly as a browser does - gate first, then
 * the page layer - and assert that every combination of cookie and database
 * state reaches a rendered page in a bounded number of hops.
 */

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`)
  }
}

class ForbiddenSignal extends Error {}

// `redirect()` and `forbidden()` throw framework-internal signals in a real
// request. Here they throw signals the walk can read.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url)
  },
  forbidden: () => {
    throw new ForbiddenSignal('forbidden')
  },
}))

/** What Auth.js hands the page layer. `null` is a token it refused. */
let currentSession: Session | null = null
/** Simulates PostgreSQL being unreachable. */
let databaseDown = false

vi.mock('@/server/auth/auth', () => ({
  auth: vi.fn(async () => currentSession),
}))

vi.mock('@/server/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: async (args: Parameters<typeof testDb.user.findUnique>[0]) => {
        if (databaseDown) {
          throw new Error("Can't reach database server at `localhost:5432`")
        }
        return testDb.user.findUnique(args)
      },
    },
  },
}))

const { default: proxy } = await import('@/proxy')
const { requireAuthForPage } = await import('@/server/auth/page-guards')
const { resolveSession } = await import('@/server/auth/session')

const ORIGIN = 'http://localhost:3000'

async function gate(path: string, cookie?: string) {
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

type Rendered = 'login' | 'protected' | 'forbidden' | 'unavailable'
type Outcome = { kind: 'render'; page: Rendered } | { kind: 'redirect'; to: string }

/**
 * The page layer for one path, using the real guard and the real login-page
 * rule, so a change to either shows up here.
 */
async function render(path: string): Promise<Outcome> {
  if (path === LOGIN_PATH) {
    const session = await resolveSession()
    // Exactly what app/(auth)/login/page.tsx does.
    return session.status === 'signed-in' ? { kind: 'redirect', to: HOME_PATH } : { kind: 'render', page: 'login' }
  }

  try {
    await requireAuthForPage()
    return { kind: 'render', page: 'protected' }
  } catch (error) {
    if (error instanceof RedirectSignal) return { kind: 'redirect', to: new URL(error.url, ORIGIN).pathname }
    if (error instanceof ServiceUnavailableError) return { kind: 'render', page: 'unavailable' }
    if (error instanceof ForbiddenSignal) return { kind: 'render', page: 'forbidden' }
    throw error
  }
}

interface Walk {
  visited: string[]
  page: Rendered | 'LOOP'
}

/** Follows redirects like a browser, capped the way a browser caps them. */
async function walk(start: string, cookie?: string, maxHops = 10): Promise<Walk> {
  const visited: string[] = []
  let path = start

  for (let hop = 0; hop < maxHops; hop++) {
    visited.push(path)

    const response = await gate(path, cookie)
    const location = response.headers.get('location')
    if (location) {
      path = new URL(location, ORIGIN).pathname
      continue
    }
    if (response.status === 403) return { visited, page: 'forbidden' }

    const outcome = await render(path)
    if (outcome.kind === 'render') return { visited, page: outcome.page }
    path = outcome.to
  }

  return { visited, page: 'LOOP' }
}

let admin: TestUser
let viewer: TestUser
let disabled: TestUser

let adminCookie: string
let viewerCookie: string

function sessionFor(user: TestUser): Session {
  return {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  }
}

beforeAll(async () => {
  admin = await createTestUser(testDb, { role: UserRole.ADMIN })
  viewer = await createTestUser(testDb, { role: UserRole.VIEWER })
  disabled = await createTestUser(testDb, { role: UserRole.ENGINEER, status: UserStatus.DISABLED, tag: 'disabled' })

  adminCookie = await sessionCookie({ sub: admin.id, role: 'ADMIN', email: admin.email })
  viewerCookie = await sessionCookie({ sub: viewer.id, role: 'VIEWER', email: viewer.email })
})

afterAll(async () => {
  await deleteTestUsers(testDb, [admin, viewer, disabled])
  await testDb.$disconnect()
})

let logged: unknown[][] = []

beforeEach(() => {
  currentSession = null
  databaseDown = false
  logged = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the former redirect loop', () => {
  it('a cookie the gate accepts but the database rejects ends on the login page, not in a loop', async () => {
    // The exact reported state: a decodable cookie whose token Auth.js refuses
    // (bumped sessionVersion, or an unreachable database at the time of the
    // token read), so the page layer sees no session at all.
    currentSession = null

    const result = await walk('/dashboard', adminCookie)

    expect(result.page).toBe('login')
    expect(result.visited).toEqual(['/dashboard', LOGIN_PATH])
  })

  it('the login page stays reachable with that same cookie', async () => {
    currentSession = null

    const result = await walk(LOGIN_PATH, adminCookie)

    expect(result.page).toBe('login')
    expect(result.visited).toEqual([LOGIN_PATH])
  })

  it('the gate no longer redirects /login anywhere on the strength of a cookie', async () => {
    // This single behaviour is what closed the loop: the gate cannot read the
    // database, so it must not decide that a cookie holder is signed in.
    const response = await gate(LOGIN_PATH, adminCookie)

    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('the root dispatcher still terminates for a cookie the database rejects', async () => {
    currentSession = null

    const result = await walk('/', adminCookie)

    expect(result.page).toBe('login')
    expect(result.visited).toEqual(['/', HOME_PATH, LOGIN_PATH])
  })
})

describe('sessions that are genuinely valid', () => {
  it('an anonymous visitor gets the login page', async () => {
    const result = await walk(LOGIN_PATH)
    expect(result.page).toBe('login')
  })

  it('an anonymous visitor on a protected route is sent to login with the path preserved', async () => {
    const response = await gate('/bookings?tab=history')
    const location = new URL(response.headers.get('location') ?? '', ORIGIN)
    expect(location.pathname).toBe(LOGIN_PATH)
    expect(location.searchParams.get('callbackUrl')).toBe('/bookings?tab=history')
    expect((await walk('/bookings')).page).toBe('login')
  })

  it('a current ADMIN session reaches the dashboard', async () => {
    currentSession = sessionFor(admin)
    const result = await walk('/dashboard', adminCookie)
    expect(result.page).toBe('protected')
    expect(result.visited).toEqual(['/dashboard'])
  })

  it('a current ADMIN session visiting /login is sent to the authenticated home', async () => {
    currentSession = sessionFor(admin)

    const result = await walk(LOGIN_PATH, adminCookie)

    // The login page, not the gate, makes this decision now.
    expect(result.page).toBe('protected')
    expect(result.visited).toEqual([LOGIN_PATH, HOME_PATH])
  })

  it('signing out leaves both the cookie-less and cookie-bearing cases on the login page', async () => {
    // After signOut the cookie is gone: plainly anonymous.
    expect((await walk('/dashboard')).page).toBe('login')
    // And if a stale copy of the cookie is replayed, the answer is the same.
    currentSession = null
    expect((await walk('/dashboard', adminCookie)).page).toBe('login')
  })
})

describe('accounts the database refuses', () => {
  it('a disabled account is anonymous, and reaches the login page without looping', async () => {
    currentSession = sessionFor(disabled)

    const resolution = await resolveSession()
    expect(resolution.status).toBe('anonymous')

    const cookie = await sessionCookie({ sub: disabled.id, role: 'ENGINEER', email: disabled.email })
    const result = await walk('/dashboard', cookie)
    expect(result.page).toBe('login')
    expect(result.visited).toEqual(['/dashboard', LOGIN_PATH])
  })

  it('a deleted account is anonymous', async () => {
    await testDb.user.update({ where: { id: viewer.id }, data: { deletedAt: new Date() } })
    currentSession = sessionFor(viewer)

    expect((await resolveSession()).status).toBe('anonymous')

    await testDb.user.update({ where: { id: viewer.id }, data: { deletedAt: null } })
  })
})

describe('while the database is unreachable', () => {
  it('resolves to "unavailable" rather than "anonymous", and says so in the log', async () => {
    currentSession = sessionFor(admin)
    databaseDown = true

    expect((await resolveSession()).status).toBe('unavailable')
    expect(logged).toHaveLength(1)
    expect(String(logged[0][0])).toContain('session could not be resolved')
  })

  it('a protected page fails bounded, keeps the session and never bounces to login', async () => {
    currentSession = sessionFor(admin)
    databaseDown = true

    const result = await walk('/dashboard', adminCookie)

    expect(result.page).toBe('unavailable')
    expect(result.visited).toEqual(['/dashboard'])
    expect(result.visited).not.toContain(LOGIN_PATH)
  })

  it('the login page stays reachable during the outage', async () => {
    currentSession = sessionFor(admin)
    databaseDown = true

    const result = await walk(LOGIN_PATH, adminCookie)

    expect(result.page).toBe('login')
    expect(result.visited).toEqual([LOGIN_PATH])
  })

  it('cannot produce a loop from any entry point', async () => {
    currentSession = sessionFor(admin)
    databaseDown = true

    for (const start of ['/', '/dashboard', '/bookings', '/kits', LOGIN_PATH]) {
      const result = await walk(start, adminCookie)
      expect(result.page, start).not.toBe('LOOP')
      expect(result.visited.length, start).toBeLessThanOrEqual(3)
    }
  })

  it('a signed-in visitor is not signed out by the outage: the session survives it', async () => {
    currentSession = sessionFor(admin)

    databaseDown = true
    expect((await resolveSession()).status).toBe('unavailable')

    // Nothing about the token or the account was changed by the failure.
    databaseDown = false
    const restored = await resolveSession()
    expect(restored.status).toBe('signed-in')
    expect(restored.status === 'signed-in' && restored.actor.id).toBe(admin.id)
  })
})

describe('authorization is unchanged by the fix', () => {
  it('the gate still answers 403 for a signed-in user without the permission', async () => {
    currentSession = sessionFor(viewer)
    const result = await walk('/admin/users', viewerCookie)
    expect(result.page).toBe('forbidden')
  })

  it('an anonymous visitor to an admin route is sent to login, not refused', async () => {
    expect((await walk('/admin/users')).page).toBe('login')
  })

  it('a current ADMIN session reaches an admin route', async () => {
    currentSession = sessionFor(admin)
    expect((await walk('/admin/users', adminCookie)).page).toBe('protected')
  })
})
