import { AuditAction, type Prisma, UserRole, UserStatus } from '@prisma/client'

import type { Db } from '@/server/db/prisma'
import { recordAudit } from '@/server/services/audit.service'

import type { AuthenticatedUser, RequestContext } from '../credentials'
import type { Directory, DirectoryIdentity } from './directory'

/**
 * From a directory identity to an application account.
 *
 * The directory decides *who* somebody is; this module decides whether that
 * person has an account here and what it says. Every rule an administrator
 * relies on - the account must exist (or be provisioned deliberately), be
 * ACTIVE, keep its local role unless the directory's groups are mapped, and
 * have every change written to the audit log - is here, in one pass, inside
 * the caller's transaction.
 *
 * The link between the two is an `Account` row: `provider = 'ldap'`,
 * `providerAccountId = <stable directory id>`. A display name can change and
 * an email can be reassigned; the objectGUID cannot, so it is the key. The
 * first sign-in of an administrator-created account links it by email - once -
 * and from then on the id is what matters.
 *
 * Everything written after the directory has answered - the link, a
 * provisioned account, a refreshed name, a remapped role and their audit rows -
 * happens in one transaction, so a failure part-way leaves no half-linked
 * account behind. A test passes an open transaction in; the application passes
 * the client and one is opened here.
 */

export const DIRECTORY_PROVIDER = 'ldap'

/** The audit trail's name for changes the directory made, as opposed to a person. */
const DIRECTORY_ACTOR = 'Corporate directory'

export interface DirectoryAccountPolicy {
  /** Create a local account on first successful sign-in. */
  autoProvision: boolean
  /** Role for a provisioned account when no group maps. Never ADMIN. */
  defaultRole: Exclude<UserRole, 'ADMIN'>
  /** Group DN -> role. Empty means roles stay under local administration. */
  roleGroups: ReadonlyArray<{ role: UserRole; groupDn: string }>
}

export type DirectorySignInResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'disabled' }
  /** The directory vouched for the person, but they have no account here and none may be created. */
  | { ok: false; reason: 'not_provisioned' }
  | { ok: false; reason: 'unavailable' }
  | { ok: false; reason: 'misconfigured' }

/**
 * The role the directory's groups ask for, or null when none of the
 * configured groups matches. The most powerful matching role wins, so somebody
 * in both an engineer and a viewer group is an engineer. ADMIN only ever comes
 * from an explicitly configured ADMIN group.
 */
export function roleFromGroups(groups: readonly string[], roleGroups: DirectoryAccountPolicy['roleGroups']): UserRole | null {
  const membership = new Set(groups.map((group) => group.toLowerCase()))
  for (const role of [UserRole.ADMIN, UserRole.ENGINEER, UserRole.EDITOR, UserRole.VIEWER]) {
    if (roleGroups.some((mapping) => mapping.role === role && membership.has(mapping.groupDn.toLowerCase()))) return role
  }
  return null
}

/** Parses a semicolon-separated list of group DNs from configuration. */
export function roleGroupsFrom(configured: Partial<Record<UserRole, string | undefined>>): DirectoryAccountPolicy['roleGroups'] {
  const mappings: Array<{ role: UserRole; groupDn: string }> = []
  for (const role of Object.values(UserRole)) {
    const raw = configured[role]
    if (!raw) continue
    for (const groupDn of raw.split(';').map((part) => part.trim()).filter(Boolean)) mappings.push({ role, groupDn })
  }
  return mappings
}

const userSelect = {
  id: true,
  email: true,
  name: true,
  staffId: true,
  role: true,
  status: true,
  passwordHash: true,
  sessionVersion: true,
  deletedAt: true,
} as const

type UserRow = {
  id: string
  email: string
  name: string
  staffId: string | null
  role: UserRole
  status: UserStatus
  passwordHash: string | null
  sessionVersion: number
  deletedAt: Date | null
}

/**
 * Authenticates against the directory and resolves the local account.
 *
 * `input.password` is handed to `directory.authenticate` and to nothing else:
 * it is not in the result, not in any audit row, and not in any log line this
 * module writes.
 */
export async function signInWithDirectory(
  db: Db,
  directory: Directory,
  policy: DirectoryAccountPolicy,
  input: { username: string; password: string },
  context: RequestContext = {},
  now: Date = new Date(),
): Promise<DirectorySignInResult> {
  const username = input.username.trim().toLowerCase()
  const verdict = await directory.authenticate(username, input.password)

  if (!verdict.ok) {
    if (verdict.reason === 'invalid') {
      await recordAudit(db, {
        action: AuditAction.LOGIN_FAILED,
        entityType: 'User',
        actorName: username,
        summary: 'Sign-in failed: the directory did not accept the credentials',
        metadata: { reason: 'directory_rejected', method: 'ldap' },
        ...context,
      })
      return { ok: false, reason: 'invalid' }
    }
    await recordAudit(db, {
      action: AuditAction.LOGIN_FAILED,
      entityType: 'User',
      actorName: username,
      summary: verdict.reason === 'unavailable' ? 'Sign-in unavailable: the directory could not be reached' : 'Sign-in unavailable: the directory configuration is not usable',
      metadata: { reason: `directory_${verdict.reason}`, method: 'ldap' },
      ...context,
    })
    return { ok: false, reason: verdict.reason }
  }

  const identity = verdict.identity
  return inTransaction(db, async (tx) => {
    const user = await resolveAccount(tx, identity, policy, context, now)
    if (!user) {
      await recordAudit(tx, {
        action: AuditAction.LOGIN_FAILED,
        entityType: 'User',
        actorName: identity.displayName ?? identity.username,
        summary: 'Sign-in refused: directory identity has no application account',
        // Named precisely enough for an administrator to provision the right
        // person: two people can share a display name, not a directory id.
        metadata: { reason: 'not_provisioned', method: 'ldap', autoProvision: policy.autoProvision, username: identity.username, email: identity.email, directoryId: identity.id },
        ...context,
      })
      return { ok: false, reason: 'not_provisioned' } as const
    }

    if (user.deletedAt || user.status !== UserStatus.ACTIVE) {
      await recordAudit(tx, {
        action: AuditAction.LOGIN_FAILED,
        entityType: 'User',
        entityId: user.id,
        actorName: user.email,
        actorRole: user.role,
        summary: `Sign-in refused: account status is ${user.deletedAt ? 'DELETED' : user.status}`,
        metadata: { reason: 'inactive', status: user.deletedAt ? 'DELETED' : user.status, method: 'ldap' },
        ...context,
      })
      return { ok: false, reason: 'disabled' } as const
    }

    const refreshed = await refreshFromDirectory(tx, user, identity, policy, context)

    await tx.user.update({ where: { id: refreshed.id }, data: { lastLoginAt: now, failedLoginAttempts: 0, lockedUntil: null } })

    await recordAudit(tx, {
      action: AuditAction.LOGIN_SUCCESS,
      entityType: 'User',
      entityId: refreshed.id,
      actorUserId: refreshed.id,
      actorName: refreshed.name,
      actorRole: refreshed.role,
      summary: `${refreshed.email} signed in with the corporate directory`,
      metadata: { method: 'ldap' },
      ...context,
    })

    return {
      ok: true as const,
      user: { id: refreshed.id, name: refreshed.name, email: refreshed.email, role: refreshed.role, sessionVersion: refreshed.sessionVersion },
    }
  })
}

/** Runs `fn` in a transaction on a client, or straight through on a transaction already open. */
async function inTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> {
  if ('$transaction' in db && typeof db.$transaction === 'function') {
    return db.$transaction((tx) => fn(tx), options)
  }
  return fn(db)
}

/**
 * The account behind a directory identity: linked already, linkable by email
 * (an administrator created it and this is its first directory sign-in), or
 * provisioned now when policy allows. Null when none of those applies.
 */
async function resolveAccount(db: Db, identity: DirectoryIdentity, policy: DirectoryAccountPolicy, context: RequestContext, now: Date): Promise<UserRow | null> {
  const linked = await db.account.findUnique({
    where: { provider_providerAccountId: { provider: DIRECTORY_PROVIDER, providerAccountId: identity.id } },
    select: { user: { select: userSelect } },
  })
  if (linked) return linked.user

  if (identity.email) {
    // The one-time email claim, with three guards. No local password: a
    // break-glass account is never silently turned into a directory account.
    // No existing directory link: an email can be reassigned in the directory
    // and a stable id cannot, so a new identity must never inherit an account
    // that already belongs to somebody. ACTIVE only: an account that cannot
    // sign in does not acquire identity bindings from refused attempts.
    const byEmail = await db.user.findFirst({
      where: {
        email: identity.email,
        deletedAt: null,
        passwordHash: null,
        status: UserStatus.ACTIVE,
        accounts: { none: { provider: DIRECTORY_PROVIDER } },
      },
      select: userSelect,
    })
    if (byEmail) {
      await db.account.create({ data: { userId: byEmail.id, type: 'ldap', provider: DIRECTORY_PROVIDER, providerAccountId: identity.id } })
      await recordAudit(db, {
        action: AuditAction.UPDATE,
        entityType: 'User',
        entityId: byEmail.id,
        actorName: DIRECTORY_ACTOR,
        summary: `${byEmail.email} linked to its corporate directory identity`,
        metadata: { method: 'ldap', link: 'email' },
        ...context,
      })
      return byEmail
    }
  }

  if (!policy.autoProvision) return null
  if (!identity.email) {
    console.error('[auth] directory identity has no email attribute; cannot provision an account')
    return null
  }
  // Somebody else already holds this email (a local account, say): never merge identities on a guess.
  const emailTaken = await db.user.findUnique({ where: { email: identity.email }, select: { id: true } })
  if (emailTaken) return null

  const role = roleFromGroups(identity.groups, policy.roleGroups) ?? policy.defaultRole
  const staffIdFree = identity.staffId ? (await db.user.findUnique({ where: { staffId: identity.staffId }, select: { id: true } })) === null : false

  const created = await db.user.create({
    data: {
      email: identity.email,
      name: identity.displayName ?? identity.username,
      staffId: staffIdFree ? identity.staffId : null,
      role,
      status: UserStatus.ACTIVE,
      passwordHash: null,
      accounts: { create: { type: 'ldap', provider: DIRECTORY_PROVIDER, providerAccountId: identity.id } },
    },
    select: userSelect,
  })
  await recordAudit(db, {
    action: AuditAction.CREATE,
    entityType: 'User',
    entityId: created.id,
    actorName: DIRECTORY_ACTOR,
    actorRole: null,
    summary: `${created.email} provisioned from the corporate directory as ${role.toLowerCase()}`,
    newValue: { email: created.email, name: created.name, role, status: UserStatus.ACTIVE },
    metadata: { method: 'ldap', provisionedAt: now.toISOString(), roleSource: roleFromGroups(identity.groups, policy.roleGroups) ? 'group' : 'default' },
    ...context,
  })
  return created
}

/**
 * Keeps the safe profile fields in step with the directory, and applies group
 * mapping when configured. A role change here revokes the account's other
 * sessions exactly as an administrator's would (AD-2); the session being
 * created now is issued after the bump, so it stays valid.
 */
async function refreshFromDirectory(db: Db, user: UserRow, identity: DirectoryIdentity, policy: DirectoryAccountPolicy, context: RequestContext): Promise<UserRow> {
  let current = user
  const data: { name?: string; email?: string } = {}

  if (identity.displayName && identity.displayName !== current.name) data.name = identity.displayName
  if (identity.email && identity.email !== current.email) {
    const taken = await db.user.findUnique({ where: { email: identity.email }, select: { id: true } })
    if (!taken) data.email = identity.email
  }
  if (Object.keys(data).length > 0) {
    current = await db.user.update({ where: { id: current.id }, data, select: userSelect })
    await recordAudit(db, {
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: current.id,
      actorName: DIRECTORY_ACTOR,
      summary: `${current.email} profile refreshed from the corporate directory (${Object.keys(data).join(', ')})`,
      previousValue: { name: user.name, email: user.email },
      newValue: { name: current.name, email: current.email },
      metadata: { method: 'ldap' },
      ...context,
    })
  }

  // Group mapping is opt-in. With no groups configured the local role is the
  // whole truth; with groups configured, an unmapped member keeps the role an
  // administrator gave them and is never promoted by omission.
  if (policy.roleGroups.length > 0) {
    const mapped = roleFromGroups(identity.groups, policy.roleGroups)
    if (mapped && mapped !== current.role && current.role === UserRole.ADMIN) {
      // The same rule an administrator is held to (admin.service.ts): the last
      // active administrator cannot be demoted out of existence, not even by a
      // directory group. The role stays, and the audit log says why.
      const remaining = await db.user.count({ where: { deletedAt: null, role: UserRole.ADMIN, status: UserStatus.ACTIVE, id: { not: current.id } } })
      if (remaining === 0) {
        await recordAudit(db, {
          action: AuditAction.UPDATE,
          entityType: 'User',
          entityId: current.id,
          actorName: DIRECTORY_ACTOR,
          actorRole: null,
          summary: `${current.name} kept the administrator role: directory groups map to ${mapped.toLowerCase()}, but this is the last active administrator`,
          metadata: { method: 'ldap', source: 'group', mappedRole: mapped, kept: 'ADMIN' },
          ...context,
        })
        return current
      }
    }
    if (mapped && mapped !== current.role) {
      const previousRole = current.role
      current = await db.user.update({ where: { id: current.id }, data: { role: mapped, sessionVersion: { increment: 1 } }, select: userSelect })
      await recordAudit(db, {
        action: AuditAction.ROLE_CHANGED,
        entityType: 'User',
        entityId: current.id,
        actorName: DIRECTORY_ACTOR,
        summary: `${current.name} changed from ${previousRole.toLowerCase()} to ${mapped.toLowerCase()} by directory group membership`,
        previousValue: { role: previousRole },
        newValue: { role: mapped },
        metadata: { method: 'ldap', source: 'group' },
        ...context,
      })
    }
  }

  return current
}
