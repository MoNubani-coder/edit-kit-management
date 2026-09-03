import { describe, expect, it } from 'vitest'

import {
  classifyRoute,
  decideRoute,
  isPublicPath,
  isSafeRedirectPath,
  safeRedirectPath,
} from '@/server/auth/route-policy'

describe('route classification', () => {
  it('treats /login, /api/health and /api/auth/* as public', () => {
    expect(isPublicPath('/login')).toBe(true)
    expect(isPublicPath('/api/health')).toBe(true)
    expect(isPublicPath('/api/auth/session')).toBe(true)
    expect(classifyRoute('/login')).toEqual({ kind: 'public' })
    expect(classifyRoute('/api/health')).toEqual({ kind: 'public' })
  })

  it('does not let a public prefix leak onto look-alike paths', () => {
    expect(isPublicPath('/login-admin')).toBe(false)
    expect(isPublicPath('/api/healthcheck')).toBe(false)
    expect(isPublicPath('/api/me')).toBe(false)
  })

  it('requires a session for the application routes', () => {
    for (const path of ['/dashboard', '/bookings', '/bookings/abc', '/kits', '/assets', '/editors', '/issues', '/reports', '/api/me']) {
      expect(classifyRoute(path)).toEqual({ kind: 'authenticated' })
    }
  })

  it('maps each admin section to its permission and the admin root to any admin permission', () => {
    expect(classifyRoute('/admin/users')).toEqual({ kind: 'permission', anyOf: ['admin.users.manage'] })
    expect(classifyRoute('/admin/users/123')).toEqual({ kind: 'permission', anyOf: ['admin.users.manage'] })
    expect(classifyRoute('/admin/audit-logs')).toEqual({ kind: 'permission', anyOf: ['admin.audit.read'] })

    const root = classifyRoute('/admin')
    expect(root.kind).toBe('permission')
    if (root.kind === 'permission') {
      expect(root.anyOf.length).toBeGreaterThan(1)
      expect(root.anyOf.every((permission) => permission.startsWith('admin.'))).toBe(true)
    }
  })
})

describe('route decisions', () => {
  it('sends anonymous visitors on protected routes to login', () => {
    expect(decideRoute('/dashboard', null)).toEqual({ action: 'login' })
    expect(decideRoute('/admin/users', null)).toEqual({ action: 'login' })
  })

  it('lets anonymous visitors reach public routes', () => {
    expect(decideRoute('/login', null)).toEqual({ action: 'allow' })
    expect(decideRoute('/api/health', null)).toEqual({ action: 'allow' })
  })

  it('sends a signed-in visitor away from /login but leaves other public routes alone', () => {
    expect(decideRoute('/login', { role: 'VIEWER' })).toEqual({ action: 'home' })
    expect(decideRoute('/api/health', { role: 'VIEWER' })).toEqual({ action: 'allow' })
  })

  it('answers forbidden, not login, for an authenticated user without the admin permission', () => {
    expect(decideRoute('/admin/users', { role: 'ENGINEER' })).toEqual({ action: 'forbidden' })
    expect(decideRoute('/admin', { role: 'VIEWER' })).toEqual({ action: 'forbidden' })
    expect(decideRoute('/admin/settings', { role: 'EDITOR' })).toEqual({ action: 'forbidden' })
  })

  it('allows admins into /admin/* and everyone signed in into the app', () => {
    expect(decideRoute('/admin/users', { role: 'ADMIN' })).toEqual({ action: 'allow' })
    expect(decideRoute('/admin', { role: 'ADMIN' })).toEqual({ action: 'allow' })
    expect(decideRoute('/dashboard', { role: 'EDITOR' })).toEqual({ action: 'allow' })
  })
})

describe('post-login redirect safety', () => {
  it('accepts same-origin absolute paths', () => {
    expect(isSafeRedirectPath('/dashboard')).toBe(true)
    expect(isSafeRedirectPath('/bookings/abc?tab=history#top')).toBe(true)
  })

  it('rejects anything that could leave the site or loop back to login', () => {
    for (const value of ['//evil.example', 'https://evil.example', '/\\evil.example', 'dashboard', '', '/login', '/login?x=1', '/api/auth/signout', undefined, 42]) {
      expect(isSafeRedirectPath(value), String(value)).toBe(false)
    }
  })

  it('falls back to the home path', () => {
    expect(safeRedirectPath('//evil.example')).toBe('/dashboard')
    expect(safeRedirectPath('/kits')).toBe('/kits')
  })
})
