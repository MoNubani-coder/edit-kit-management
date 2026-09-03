import type { UserRole } from '@prisma/client'

/**
 * The permission matrix - the single source of truth for what each role may do.
 *
 * Rules:
 *  - Code never asks "is this user an ADMIN?". It asks `can(actor, 'kit.manage')`.
 *    Roles are an implementation detail of this file; permissions are the API.
 *  - Adding a capability means adding a permission here and granting it to the
 *    roles that need it. Nothing else in the codebase changes.
 *  - The matrix is data, so it can be rendered on an admin page and unit-tested
 *    exhaustively.
 *
 * This module deliberately has no runtime imports (the Prisma import is
 * type-only), so it is safe to reference from anywhere on the server.
 * Authorization decisions still happen only on the server - see session.ts.
 */

export const PERMISSIONS = [
  'dashboard.view',

  'booking.create',
  'booking.read',
  /** Read only bookings where the actor is the editor (EDITOR role). */
  'booking.readOwn',
  'booking.update',
  'booking.cancel',
  /** Sign as the editor on one's own booking. */
  'booking.signOwn',

  'handover.perform',
  'handover.complete',

  'return.perform',
  'return.complete',

  'kit.read',
  'kit.manage',

  'asset.read',
  'asset.manage',

  'editor.read',
  'editor.manage',

  'issue.read',
  'issue.create',
  'issue.manage',

  'report.read',

  'maintenance.read',
  'maintenance.manage',

  'admin.users.manage',
  'admin.categories.manage',
  'admin.software.manage',
  'admin.checklists.manage',
  'admin.audit.read',
  'admin.settings.manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS)

/** Everything under `admin.*` - what the /admin section requires. */
export const ADMIN_PERMISSIONS = PERMISSIONS.filter((permission) =>
  permission.startsWith('admin.'),
) as readonly Permission[]

/**
 * Operational staff. Runs the store: books kits out, inspects them in and out,
 * raises and works issues, reads everything needed to do that. Does not touch
 * user accounts, reference data or system settings.
 */
const ENGINEER_PERMISSIONS: readonly Permission[] = [
  'dashboard.view',
  'booking.create',
  'booking.read',
  'booking.update',
  'booking.cancel',
  'handover.perform',
  'handover.complete',
  'return.perform',
  'return.complete',
  'kit.read',
  'asset.read',
  'editor.read',
  'issue.read',
  'issue.create',
  'issue.manage',
  'maintenance.read',
  'report.read',
]

/**
 * An internal editor with a login. Sees only their own bookings and signs for
 * their own handovers. Data scoping (own vs. all) is enforced in the DAL, not
 * here - this only says the actor may see *some* bookings.
 */
const EDITOR_PERMISSIONS: readonly Permission[] = [
  'dashboard.view',
  'booking.readOwn',
  'booking.signOwn',
]

/** Read-only visibility for management. No mutations of any kind. */
const VIEWER_PERMISSIONS: readonly Permission[] = [
  'dashboard.view',
  'booking.read',
  'kit.read',
  'asset.read',
  'report.read',
]

const ROLE_PERMISSIONS: Readonly<Record<UserRole, ReadonlySet<Permission>>> = {
  ADMIN: new Set<Permission>(PERMISSIONS),
  ENGINEER: new Set<Permission>(ENGINEER_PERMISSIONS),
  EDITOR: new Set<Permission>(EDITOR_PERMISSIONS),
  VIEWER: new Set<Permission>(VIEWER_PERMISSIONS),
}

export const ROLES = ['ADMIN', 'ENGINEER', 'EDITOR', 'VIEWER'] as const satisfies readonly UserRole[]

/** Anything that carries a role: an Actor, a session user, or a bare role. */
export type PermissionSubject = UserRole | { role: UserRole }

function roleOf(subject: PermissionSubject): UserRole {
  return typeof subject === 'string' ? subject : subject.role
}

const NOTHING: ReadonlySet<Permission> = new Set()

/** Fail closed: a role the matrix does not know grants nothing. */
function grantedTo(subject: PermissionSubject): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[roleOf(subject)] ?? NOTHING
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && PERMISSION_SET.has(value)
}

/** All permissions granted to a role, in matrix order. */
export function permissionsFor(role: UserRole): readonly Permission[] {
  const granted = grantedTo(role)
  return PERMISSIONS.filter((permission) => granted.has(permission))
}

/** The one question the rest of the codebase asks. */
export function can(subject: PermissionSubject, permission: Permission): boolean {
  return grantedTo(subject).has(permission)
}

export function canAny(subject: PermissionSubject, permissions: readonly Permission[]): boolean {
  const granted = grantedTo(subject)
  return permissions.some((permission) => granted.has(permission))
}

export function canAll(subject: PermissionSubject, permissions: readonly Permission[]): boolean {
  const granted = grantedTo(subject)
  return permissions.every((permission) => granted.has(permission))
}
