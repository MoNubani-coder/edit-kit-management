import { describe, expect, it } from 'vitest'

import { ADMIN_PERMISSIONS, can, canAll, canAny, isPermission, PERMISSIONS, type Permission, permissionsFor, ROLES } from '@/server/auth/permissions'

/**
 * The permission matrix, asserted exhaustively.
 *
 * `permissions.test.ts` checks the shape of each role in prose. This file
 * pins the whole grid: every permission against every role, written out by
 * hand. Widening a role by accident now fails a test that names the
 * permission and the role, instead of passing because no test happened to
 * cover that cell.
 *
 * When a grant genuinely changes, update EXPECTED and say why in the commit.
 * That is the point: the matrix is data, so a change to it should be a visible,
 * deliberate edit rather than a side effect.
 */

type Grid = Record<Permission, readonly string[]>

/** Who holds each permission. Anything not listed holds nothing. */
const EXPECTED: Grid = {
  'dashboard.view': ['ADMIN', 'ENGINEER', 'EDITOR', 'VIEWER'],

  'booking.create': ['ADMIN', 'ENGINEER'],
  'booking.read': ['ADMIN', 'ENGINEER', 'VIEWER'],
  'booking.readOwn': ['ADMIN', 'EDITOR'],
  'booking.update': ['ADMIN', 'ENGINEER'],
  'booking.cancel': ['ADMIN', 'ENGINEER'],
  'booking.signOwn': ['ADMIN', 'EDITOR'],

  'handover.perform': ['ADMIN', 'ENGINEER'],
  'handover.complete': ['ADMIN', 'ENGINEER'],

  'return.perform': ['ADMIN', 'ENGINEER'],
  'return.complete': ['ADMIN', 'ENGINEER'],

  'kit.read': ['ADMIN', 'ENGINEER', 'VIEWER'],
  'kit.manage': ['ADMIN'],

  'asset.read': ['ADMIN', 'ENGINEER', 'VIEWER'],
  'asset.manage': ['ADMIN'],

  'editor.read': ['ADMIN', 'ENGINEER'],
  'editor.manage': ['ADMIN'],

  'issue.read': ['ADMIN', 'ENGINEER'],
  'issue.create': ['ADMIN', 'ENGINEER'],
  'issue.manage': ['ADMIN', 'ENGINEER'],

  'report.read': ['ADMIN', 'ENGINEER', 'VIEWER'],

  'maintenance.read': ['ADMIN', 'ENGINEER'],
  'maintenance.manage': ['ADMIN'],

  'admin.users.manage': ['ADMIN'],
  'admin.categories.manage': ['ADMIN'],
  'admin.software.manage': ['ADMIN'],
  'admin.checklists.manage': ['ADMIN'],
  'admin.audit.read': ['ADMIN'],
  'admin.settings.manage': ['ADMIN'],
}

describe('the permission matrix, cell by cell', () => {
  it('covers every permission the module declares, with no extra keys', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...PERMISSIONS].sort())
  })

  for (const permission of PERMISSIONS) {
    for (const role of ROLES) {
      const granted = EXPECTED[permission].includes(role)
      it(`${role} ${granted ? 'holds' : 'does not hold'} ${permission}`, () => {
        expect(can(role, permission)).toBe(granted)
      })
    }
  }
})

describe('what the grid implies', () => {
  it('gives ADMIN every permission and nobody else all of them', () => {
    expect(permissionsFor('ADMIN')).toEqual(PERMISSIONS)
    for (const role of ROLES.filter((entry) => entry !== 'ADMIN')) {
      expect(permissionsFor(role).length).toBeLessThan(PERMISSIONS.length)
    }
  })

  it('keeps every administration permission to ADMIN alone', () => {
    for (const permission of ADMIN_PERMISSIONS) {
      expect(EXPECTED[permission]).toEqual(['ADMIN'])
      expect(canAny('ENGINEER', [permission])).toBe(false)
      expect(canAny('VIEWER', [permission])).toBe(false)
      expect(canAny('EDITOR', [permission])).toBe(false)
    }
  })

  it('gives VIEWER no permission that mutates anything', () => {
    const mutating = PERMISSIONS.filter((permission) => /\.(create|update|manage|cancel|perform|complete|sign)/.test(permission))
    expect(mutating.length).toBeGreaterThan(10)
    expect(mutating.filter((permission) => can('VIEWER', permission))).toEqual([])
  })

  it('gives EDITOR nothing beyond their own dashboard, their own bookings and their own signature', () => {
    expect(permissionsFor('EDITOR')).toEqual(['dashboard.view', 'booking.readOwn', 'booking.signOwn'])
  })

  it('never grants a role both booking.read and only-own reading as its sole booking sight', () => {
    // A role that can read every booking must not need the own-booking rule to
    // see anything, and a role scoped to its own must not hold the wide read.
    expect(can('ENGINEER', 'booking.readOwn')).toBe(false)
    expect(can('VIEWER', 'booking.readOwn')).toBe(false)
    expect(can('EDITOR', 'booking.read')).toBe(false)
  })

  it('lets nobody but ADMIN and ENGINEER perform or complete a handover or return', () => {
    for (const permission of ['handover.perform', 'handover.complete', 'return.perform', 'return.complete'] as const) {
      expect(EXPECTED[permission]).toEqual(['ADMIN', 'ENGINEER'])
    }
  })

  it('pairs every perform permission with the complete permission for the same workflow', () => {
    for (const role of ROLES) {
      expect(can(role, 'handover.perform')).toBe(can(role, 'handover.complete'))
      expect(can(role, 'return.perform')).toBe(can(role, 'return.complete'))
    }
  })

  it('grants manage only where the matching read is also granted', () => {
    const pairs = [
      ['kit.read', 'kit.manage'],
      ['asset.read', 'asset.manage'],
      ['editor.read', 'editor.manage'],
      ['issue.read', 'issue.manage'],
      ['maintenance.read', 'maintenance.manage'],
    ] as const
    for (const [read, manage] of pairs) {
      for (const role of ROLES) {
        if (can(role, manage)) expect(can(role, read)).toBe(true)
      }
    }
  })

  it('answers canAll only when every permission is held', () => {
    expect(canAll('ENGINEER', ['booking.read', 'issue.read'])).toBe(true)
    expect(canAll('ENGINEER', ['booking.read', 'kit.manage'])).toBe(false)
    expect(canAll('ADMIN', [...PERMISSIONS])).toBe(true)
    expect(canAll('EDITOR', [])).toBe(true)
  })

  it('answers canAny only when at least one permission is held', () => {
    expect(canAny('VIEWER', ['kit.manage', 'asset.read'])).toBe(true)
    expect(canAny('VIEWER', ['kit.manage', 'asset.manage'])).toBe(false)
    expect(canAny('EDITOR', [])).toBe(false)
  })

  it('rejects a name the matrix does not declare', () => {
    expect(isPermission('booking.read')).toBe(true)
    expect(isPermission('booking.delete')).toBe(false)
    expect(isPermission('')).toBe(false)
    expect(isPermission(undefined)).toBe(false)
    expect(can('ADMIN', 'booking.delete' as Permission)).toBe(false)
  })
})
