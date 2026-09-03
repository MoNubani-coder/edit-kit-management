import { describe, expect, it } from 'vitest'

import {
  ADMIN_PERMISSIONS,
  can,
  canAll,
  canAny,
  isPermission,
  PERMISSIONS,
  permissionsFor,
  ROLES,
  type Permission,
} from '@/server/auth/permissions'

/** Permissions that change state. Everything else is a read. */
const MUTATING_SUFFIXES = ['.create', '.update', '.cancel', '.manage', '.perform', '.complete', '.signOwn']

function isMutating(permission: Permission): boolean {
  return MUTATING_SUFFIXES.some((suffix) => permission.endsWith(suffix))
}

describe('permission matrix', () => {
  it('ADMIN holds every permission, including admin.users.manage', () => {
    expect(can('ADMIN', 'admin.users.manage')).toBe(true)
    for (const permission of PERMISSIONS) {
      expect(can('ADMIN', permission)).toBe(true)
    }
    expect(permissionsFor('ADMIN')).toHaveLength(PERMISSIONS.length)
  })

  it('ENGINEER holds the operational permissions', () => {
    const operational: Permission[] = [
      'dashboard.view',
      'booking.create',
      'booking.read',
      'booking.update',
      'handover.perform',
      'handover.complete',
      'return.perform',
      'return.complete',
      'kit.read',
      'asset.read',
      'editor.read',
      'issue.create',
      'issue.manage',
      'maintenance.read',
      'report.read',
    ]
    expect(canAll('ENGINEER', operational)).toBe(true)
  })

  it('ENGINEER cannot manage users, settings or any other administration', () => {
    expect(can('ENGINEER', 'admin.users.manage')).toBe(false)
    expect(can('ENGINEER', 'admin.settings.manage')).toBe(false)
    expect(canAny('ENGINEER', ADMIN_PERMISSIONS)).toBe(false)
    // Reference-data and account-shaped mutations stay with ADMIN too.
    expect(can('ENGINEER', 'kit.manage')).toBe(false)
    expect(can('ENGINEER', 'asset.manage')).toBe(false)
    expect(can('ENGINEER', 'editor.manage')).toBe(false)
    expect(can('ENGINEER', 'maintenance.manage')).toBe(false)
  })

  it('VIEWER can read the operational data but holds no mutating permission', () => {
    expect(canAll('VIEWER', ['dashboard.view', 'booking.read', 'kit.read', 'asset.read', 'report.read'])).toBe(true)

    const granted = permissionsFor('VIEWER')
    expect(granted.length).toBeGreaterThan(0)
    for (const permission of granted) {
      expect(isMutating(permission), `VIEWER unexpectedly holds ${permission}`).toBe(false)
    }
    expect(canAny('VIEWER', ADMIN_PERMISSIONS)).toBe(false)
  })

  it('EDITOR sees only own bookings and cannot read the full booking list', () => {
    expect(can('EDITOR', 'booking.readOwn')).toBe(true)
    expect(can('EDITOR', 'booking.signOwn')).toBe(true)
    expect(can('EDITOR', 'booking.read')).toBe(false)
    expect(can('EDITOR', 'booking.create')).toBe(false)
    expect(can('EDITOR', 'kit.read')).toBe(false)
    expect(canAny('EDITOR', ADMIN_PERMISSIONS)).toBe(false)
  })

  it('accepts a subject object as well as a bare role', () => {
    expect(can({ role: 'ENGINEER' }, 'booking.create')).toBe(true)
    expect(can({ role: 'VIEWER' }, 'booking.create')).toBe(false)
  })

  it('every role resolves to a defined permission set and the matrix has no unknown names', () => {
    for (const role of ROLES) {
      expect(Array.isArray(permissionsFor(role))).toBe(true)
    }
    expect(isPermission('booking.read')).toBe(true)
    expect(isPermission('booking.delete')).toBe(false)
    expect(isPermission(42)).toBe(false)
  })

  it('a role unknown to the matrix holds nothing (fail closed)', () => {
    expect(can('NOBODY' as never, 'dashboard.view')).toBe(false)
    expect(permissionsFor('NOBODY' as never)).toEqual([])
  })

  it('ADMIN_PERMISSIONS is exactly the admin.* subset', () => {
    expect(ADMIN_PERMISSIONS.every((permission) => permission.startsWith('admin.'))).toBe(true)
    expect(ADMIN_PERMISSIONS).toHaveLength(PERMISSIONS.filter((p) => p.startsWith('admin.')).length)
  })
})
