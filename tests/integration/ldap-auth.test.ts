import { UserRole, UserStatus } from '@prisma/client'
import type { JWT } from 'next-auth/jwt'
import { afterAll, describe, expect, it } from 'vitest'

import { authConfig } from '@/server/auth/auth.config'
import { hasLocalPassword, type SignInMethods, signInWithPassword } from '@/server/auth/authenticate'
import { hashPassword } from '@/server/auth/password'
import type { DirectoryAccountPolicy } from '@/server/auth/ldap/authenticate'
import { DIRECTORY_PROVIDER, roleGroupsFrom, signInWithDirectory } from '@/server/auth/ldap/authenticate'
import { can } from '@/server/auth/permissions'
import type { Db } from '@/server/db/prisma'

import { createTestUser, TEST_PASSWORD, testDb, uniqueEmail, withRollback } from '../helpers/db'
import { FakeDirectory, person } from '../helpers/fake-directory'

/**
 * Directory sign-in against the real database, with the directory itself
 * replaced by a fake that answers exactly as LDAP would. Everything runs inside
 * a rolled-back transaction: no user, account link or audit row survives.
 *
 * The one thing every test here checks in passing: the password the person
 * typed reaches the directory and nothing else - not a row, not an audit
 * entry, not a token.
 */

afterAll(async () => {
  await testDb.$disconnect()
})

const PASSWORD = 'Corporate-Passw0rd!'
const CONTEXT = { ipAddress: '10.0.0.7', userAgent: 'vitest' }

const policy = (overrides: Partial<DirectoryAccountPolicy> = {}): DirectoryAccountPolicy => ({
  autoProvision: false,
  defaultRole: 'VIEWER',
  roleGroups: [],
  ...overrides,
})

const methods = (directory: FakeDirectory | null, overrides: Partial<DirectoryAccountPolicy> = {}, localLoginEnabled = true): SignInMethods => ({
  localLoginEnabled,
  directory: directory ? { client: directory, policy: policy(overrides) } : null,
})

/** Every string this transaction wrote, so a test can prove the password is not among them. */
async function everythingWritten(tx: Db, since: Date): Promise<string> {
  const [users, accounts, audit] = await Promise.all([
    tx.user.findMany({ where: { OR: [{ createdAt: { gte: since } }, { updatedAt: { gte: since } }] } }),
    tx.account.findMany({}),
    tx.auditLog.findMany({ where: { createdAt: { gte: since } } }),
  ])
  return JSON.stringify({ users, accounts, audit })
}

/** An account an administrator created for a directory user: no local password. */
async function directoryAccount(tx: Db, options: { email: string; role?: UserRole; status?: UserStatus; name?: string; staffId?: string }) {
  return tx.user.create({
    data: {
      email: options.email,
      name: options.name ?? 'Placeholder Name',
      role: options.role ?? UserRole.ENGINEER,
      status: options.status ?? UserStatus.ACTIVE,
      passwordHash: null,
      staffId: options.staffId,
    },
    select: { id: true, email: true, name: true, role: true, sessionVersion: true },
  })
}

describe('with the directory switched off', () => {
  it('local email and password sign-in works exactly as before', async () => {
    await withRollback(async (tx) => {
      const user = await createTestUser(tx, { role: UserRole.ENGINEER })
      const result = await signInWithPassword(tx, { username: user.email.toUpperCase(), password: TEST_PASSWORD }, CONTEXT, methods(null))
      expect(result).toMatchObject({ ok: true, method: 'local', user: { id: user.id, role: 'ENGINEER', sessionVersion: 0 } })
      expect(await signInWithPassword(tx, { username: user.email, password: 'wrong' }, CONTEXT, methods(null))).toEqual({ ok: false, reason: 'invalid' })
      // A plain username has nowhere to go without a directory, and says nothing more than "invalid".
      expect(await signInWithPassword(tx, { username: 'k.mansoori', password: PASSWORD }, CONTEXT, methods(null))).toEqual({ ok: false, reason: 'invalid' })
    })
  })
})

describe('choosing the path', () => {
  it('checks a local account with a password locally and never sends that password to the directory', async () => {
    await withRollback(async (tx) => {
      const admin = await createTestUser(tx, { role: UserRole.ADMIN })
      const directory = new FakeDirectory()
      const result = await signInWithPassword(tx, { username: admin.email, password: TEST_PASSWORD }, CONTEXT, methods(directory))
      expect(result).toMatchObject({ ok: true, method: 'local', user: { id: admin.id } })
      expect(directory.calls).toEqual([])
      expect(await hasLocalPassword(tx, admin.email)).toBe(true)
      expect(await hasLocalPassword(tx, 'k.mansoori')).toBe(false)
    })
  })

  it('sends everything else to the directory, whether typed as a username or an email', async () => {
    await withRollback(async (tx) => {
      const account = await directoryAccount(tx, { email: 'k.mansoori@example.test' })
      const directory = new FakeDirectory().add('k.mansoori', person()).add('k.mansoori@example.test', person())
      expect(await signInWithPassword(tx, { username: 'K.Mansoori', password: PASSWORD }, CONTEXT, methods(directory))).toMatchObject({ ok: true, method: 'ldap', user: { id: account.id } })
      expect(await signInWithPassword(tx, { username: 'k.mansoori@example.test', password: PASSWORD }, CONTEXT, methods(directory))).toMatchObject({ ok: true, method: 'ldap' })
      expect(directory.calls.map((call) => call.username)).toEqual(['k.mansoori', 'k.mansoori@example.test'])
      // The email path exists in the database with no password, so it was never a local candidate.
      expect(await hasLocalPassword(tx, 'k.mansoori@example.test')).toBe(false)
    })
  })

  it('keeps the emergency administrator working while the directory is down', async () => {
    await withRollback(async (tx) => {
      const admin = await createTestUser(tx, { role: UserRole.ADMIN })
      const directory = new FakeDirectory()
      directory.outage = 'unavailable'
      expect(await signInWithPassword(tx, { username: admin.email, password: TEST_PASSWORD }, CONTEXT, methods(directory))).toMatchObject({ ok: true, method: 'local' })
      expect(directory.calls).toEqual([])
    })
  })

  it('with local sign-in switched off, even a password-bearing account goes to the directory', async () => {
    await withRollback(async (tx) => {
      const admin = await createTestUser(tx, { role: UserRole.ADMIN })
      const directory = new FakeDirectory()
      const result = await signInWithPassword(tx, { username: admin.email, password: TEST_PASSWORD }, CONTEXT, methods(directory, {}, false))
      expect(result).toEqual({ ok: false, reason: 'invalid' })
      expect(directory.calls).toHaveLength(1)
    })
  })
})

describe('signing in through the directory', () => {
  it('accepts the right password, links the account by its stable id, and builds the same session as a local sign-in', async () => {
    await withRollback(async (tx) => {
      const since = new Date()
      const account = await directoryAccount(tx, { email: 'k.mansoori@example.test', role: UserRole.ENGINEER })
      const directory = new FakeDirectory().add('k.mansoori', person({ id: 'guid-1234' }))

      const result = await signInWithPassword(tx, { username: 'k.mansoori', password: PASSWORD }, CONTEXT, methods(directory))
      expect(result).toEqual({
        ok: true,
        method: 'ldap',
        user: { id: account.id, name: 'Khalid Al Mansoori', email: 'k.mansoori@example.test', role: 'ENGINEER', sessionVersion: 0 },
      })
      if (!result.ok) return

      // Linked by the directory's stable id, not by the display name.
      const link = await tx.account.findUniqueOrThrow({ where: { provider_providerAccountId: { provider: DIRECTORY_PROVIDER, providerAccountId: 'guid-1234' } } })
      expect(link.userId).toBe(account.id)

      // The trusted display name replaced the placeholder, and lastLoginAt moved.
      const row = await tx.user.findUniqueOrThrow({ where: { id: account.id } })
      expect(row.name).toBe('Khalid Al Mansoori')
      expect(row.passwordHash).toBeNull()
      expect(row.lastLoginAt).not.toBeNull()

      const success = await tx.auditLog.findFirst({ where: { entityId: account.id, action: 'LOGIN_SUCCESS' } })
      expect(success).toMatchObject({ actorUserId: account.id, actorName: 'Khalid Al Mansoori', ipAddress: '10.0.0.7', metadata: { method: 'ldap' } })

      // The password is nowhere: not in a row, not in an audit entry, not in the result, not in the token.
      expect(await everythingWritten(tx, since)).not.toContain(PASSWORD)
      expect(JSON.stringify(result)).not.toContain(PASSWORD)
      const token = authConfig.callbacks.jwt({ token: {}, user: result.user, trigger: 'signIn' } as unknown as Parameters<typeof authConfig.callbacks.jwt>[0]) as JWT
      expect(JSON.stringify(token)).not.toContain(PASSWORD)
      expect(Object.keys(token).sort()).toEqual(['authenticatedAt', 'email', 'name', 'role', 'sessionVersion', 'sub'])
    })
  })

  it('signs in by the stable id on later visits even when the email has changed, and refreshes the profile', async () => {
    await withRollback(async (tx) => {
      const account = await directoryAccount(tx, { email: 'k.mansoori@example.test', name: 'Old Name' })
      await tx.account.create({ data: { userId: account.id, type: 'ldap', provider: DIRECTORY_PROVIDER, providerAccountId: 'guid-stable' } })
      const directory = new FakeDirectory().add('k.mansoori', person({ id: 'guid-stable', displayName: 'Khalid Al Mansoori', email: 'khalid.mansoori@example.test' }))

      const result = await signInWithPassword(tx, { username: 'k.mansoori', password: PASSWORD }, CONTEXT, methods(directory))
      expect(result).toMatchObject({ ok: true, user: { id: account.id, name: 'Khalid Al Mansoori', email: 'khalid.mansoori@example.test' } })

      const refreshed = await tx.auditLog.findFirst({ where: { entityId: account.id, action: 'UPDATE' } })
      expect(refreshed?.summary).toContain('profile refreshed from the corporate directory')
      expect(refreshed?.actorUserId).toBeNull()
    })
  })

  it('rejects a wrong password with the generic answer and an audit row that names the attempt, not the secret', async () => {
    await withRollback(async (tx) => {
      const since = new Date()
      await directoryAccount(tx, { email: 'k.mansoori@example.test' })
      const directory = new FakeDirectory().add('k.mansoori', person())

      const result = await signInWithPassword(tx, { username: 'k.mansoori', password: 'not-the-password' }, CONTEXT, methods(directory))
      expect(result).toEqual({ ok: false, reason: 'invalid' })

      const failed = await tx.auditLog.findFirst({ where: { action: 'LOGIN_FAILED', createdAt: { gte: since } }, orderBy: { createdAt: 'desc' } })
      expect(failed).toMatchObject({ actorName: 'k.mansoori', metadata: { reason: 'directory_rejected', method: 'ldap' } })
      expect(await everythingWritten(tx, since)).not.toContain('not-the-password')
    })
  })

  it('rejects an unknown directory user with exactly the same answer as a wrong password', async () => {
    await withRollback(async (tx) => {
      const directory = new FakeDirectory().add('k.mansoori', person())
      expect(await signInWithPassword(tx, { username: 'nobody.here', password: PASSWORD }, CONTEXT, methods(directory))).toEqual({ ok: false, reason: 'invalid' })
      expect(await signInWithPassword(tx, { username: 'k.mansoori', password: 'wrong' }, CONTEXT, methods(directory))).toEqual({ ok: false, reason: 'invalid' })
    })
  })

  it('reports an outage as a bounded temporary failure and touches no account', async () => {
    await withRollback(async (tx) => {
      const since = new Date()
      const account = await directoryAccount(tx, { email: 'k.mansoori@example.test' })
      const directory = new FakeDirectory().add('k.mansoori', person())
      directory.outage = 'unavailable'

      expect(await signInWithPassword(tx, { username: 'k.mansoori', password: PASSWORD }, CONTEXT, methods(directory))).toEqual({ ok: false, reason: 'unavailable' })

      const row = await tx.user.findUniqueOrThrow({ where: { id: account.id } })
      expect(row.lastLoginAt).toBeNull()
      expect(row.failedLoginAttempts).toBe(0)
      expect(row.lockedUntil).toBeNull()
      const audit = await tx.auditLog.findFirst({ where: { action: 'LOGIN_FAILED', createdAt: { gte: since } } })
      expect(audit?.metadata).toMatchObject({ reason: 'directory_unavailable' })
      expect(await everythingWritten(tx, since)).not.toContain(PASSWORD)

      directory.outage = 'misconfigured'
      expect(await signInWithPassword(tx, { username: 'k.mansoori', password: PASSWORD }, CONTEXT, methods(directory))).toEqual({ ok: false, reason: 'misconfigured' })
    })
  })

  it('refuses a suspended or disabled account even though the directory accepted the password', async () => {
    await withRollback(async (tx) => {
      for (const status of [UserStatus.SUSPENDED, UserStatus.DISABLED, UserStatus.INVITED]) {
        const email = uniqueEmail(status.toLowerCase())
        const username = `user.${status.toLowerCase()}`
        // Linked from an earlier sign-in, then suspended: the account is known,
        // and the refusal is about its status.
        const account = await directoryAccount(tx, { email, status })
        await tx.account.create({ data: { userId: account.id, type: 'ldap', provider: DIRECTORY_PROVIDER, providerAccountId: `guid-${status}` } })
        const directory = new FakeDirectory().add(username, person({ username, email, id: `guid-${status}` }))

        const result = await signInWithPassword(tx, { username, password: PASSWORD }, CONTEXT, methods(directory))
        expect(result, status).toEqual({ ok: false, reason: 'disabled' })
        const audit = await tx.auditLog.findFirst({ where: { entityId: account.id, action: 'LOGIN_FAILED' } })
        expect(audit?.metadata).toMatchObject({ reason: 'inactive', status })
        // Nothing about the account moved: no sign-in stamp, no counters touched.
        const row = await tx.user.findUniqueOrThrow({ where: { id: account.id } })
        expect(row.lastLoginAt).toBeNull()
        expect(row.status).toBe(status)
      }
    })
  })

  it('never claims an account that already belongs to another directory identity, even after an email is reassigned', async () => {
    await withRollback(async (tx) => {
      // The account belongs to GUID-A. The person leaves, and their mail alias
      // is handed to a new starter whose directory identity is GUID-B.
      const account = await directoryAccount(tx, { email: 'shared.alias@example.test', role: UserRole.ADMIN })
      await tx.account.create({ data: { userId: account.id, type: 'ldap', provider: DIRECTORY_PROVIDER, providerAccountId: 'guid-a' } })
      const directory = new FakeDirectory().add('new.starter', person({ username: 'new.starter', email: 'shared.alias@example.test', id: 'guid-b' }))

      const result = await signInWithPassword(tx, { username: 'new.starter', password: PASSWORD }, CONTEXT, methods(directory, { autoProvision: true }))
      expect(result).toEqual({ ok: false, reason: 'not_provisioned' })
      expect(await tx.account.count({ where: { userId: account.id } })).toBe(1)
      expect(await tx.user.count({ where: { email: 'shared.alias@example.test' } })).toBe(1)
    })
  })

  it('does not bind a directory identity to an account that cannot sign in anyway', async () => {
    await withRollback(async (tx) => {
      const placeholder = await directoryAccount(tx, { email: 'placeholder@example.test', status: UserStatus.SUSPENDED })
      const directory = new FakeDirectory().add('colleague', person({ username: 'colleague', email: 'placeholder@example.test', id: 'guid-colleague' }))

      expect(await signInWithPassword(tx, { username: 'colleague', password: PASSWORD }, CONTEXT, methods(directory))).toEqual({ ok: false, reason: 'not_provisioned' })
      expect(await tx.account.count({ where: { userId: placeholder.id } })).toBe(0)
    })
  })

  it('never claims a local password-bearing account by email', async () => {
    await withRollback(async (tx) => {
      const local = await createTestUser(tx, { role: UserRole.ADMIN })
      const directory = new FakeDirectory().add('imposter', person({ username: 'imposter', email: local.email, id: 'guid-imposter' }))
      // Local sign-in off, so the name is sent to the directory - which accepts it.
      const result = await signInWithDirectory(tx, directory, policy({ autoProvision: true }), { username: 'imposter', password: PASSWORD }, CONTEXT)
      expect(result).toEqual({ ok: false, reason: 'not_provisioned' })
      expect(await tx.account.count({ where: { userId: local.id } })).toBe(0)
    })
  })
})

describe('accounts that do not exist yet', () => {
  it('is refused, with a distinct reason and an audit row, while auto-provisioning is off', async () => {
    await withRollback(async (tx) => {
      const since = new Date()
      const directory = new FakeDirectory().add('new.person', person({ username: 'new.person', id: 'guid-new' }))
      const usersBefore = await tx.user.count()

      const result = await signInWithPassword(tx, { username: 'new.person', password: PASSWORD }, CONTEXT, methods(directory))
      expect(result).toEqual({ ok: false, reason: 'not_provisioned' })
      expect(await tx.user.count()).toBe(usersBefore)

      const audit = await tx.auditLog.findFirst({ where: { action: 'LOGIN_FAILED', createdAt: { gte: since } } })
      // Two people can share a display name; the row has to say which identity to provision.
      expect(audit).toMatchObject({
        actorName: 'Khalid Al Mansoori',
        metadata: { reason: 'not_provisioned', autoProvision: false, username: 'new.person', email: 'new.person@example.test', directoryId: 'guid-new' },
      })
    })
  })

  it('is created with the safe default role when auto-provisioning is on, and audited as such', async () => {
    await withRollback(async (tx) => {
      const since = new Date()
      const directory = new FakeDirectory().add('new.person', person({ username: 'new.person', id: 'guid-new', staffId: 'ADM-9001', groups: ['cn=all-staff,ou=groups,dc=example,dc=test'] }))

      const result = await signInWithPassword(tx, { username: 'new.person', password: PASSWORD }, CONTEXT, methods(directory, { autoProvision: true, defaultRole: 'ENGINEER' }))
      expect(result).toMatchObject({ ok: true, method: 'ldap', user: { name: 'Khalid Al Mansoori', email: 'new.person@example.test', role: 'ENGINEER', sessionVersion: 0 } })
      if (!result.ok) return

      const row = await tx.user.findUniqueOrThrow({ where: { id: result.user.id } })
      expect(row).toMatchObject({ status: 'ACTIVE', passwordHash: null, staffId: 'ADM-9001', role: 'ENGINEER' })
      const link = await tx.account.findUniqueOrThrow({ where: { provider_providerAccountId: { provider: DIRECTORY_PROVIDER, providerAccountId: 'guid-new' } } })
      expect(link.userId).toBe(row.id)

      const created = await tx.auditLog.findFirst({ where: { entityId: row.id, action: 'CREATE' } })
      expect(created).toMatchObject({ actorName: 'Corporate directory', metadata: { method: 'ldap', roleSource: 'default' } })
      expect(await everythingWritten(tx, since)).not.toContain(PASSWORD)

      // What the local RBAC says about them is what they get: a fresh engineer manages bookings, not accounts.
      const actor = { id: row.id, name: row.name, email: row.email, role: row.role, editorProfileId: null, engineerProfileId: null }
      expect(can(actor, 'booking.create')).toBe(true)
      expect(can(actor, 'admin.users.manage')).toBe(false)
    })
  })

  it('cannot be provisioned into an existing email, and never becomes ADMIN from an unmapped group', async () => {
    await withRollback(async (tx) => {
      const local = await createTestUser(tx, { role: UserRole.VIEWER })
      const directory = new FakeDirectory()
        .add('clash', person({ username: 'clash', email: local.email, id: 'guid-clash' }))
        .add('nogroup', person({ username: 'nogroup', id: 'guid-nogroup', groups: ['cn=domain-admins,cn=users,dc=example,dc=test'] }))
      const roleGroups = roleGroupsFrom({ ADMIN: 'CN=EKMS-Admins,OU=Groups,DC=example,DC=test' })

      expect(await signInWithPassword(tx, { username: 'clash', password: PASSWORD }, CONTEXT, methods(directory, { autoProvision: true }))).toEqual({ ok: false, reason: 'not_provisioned' })

      const result = await signInWithPassword(tx, { username: 'nogroup', password: PASSWORD }, CONTEXT, methods(directory, { autoProvision: true, roleGroups }))
      expect(result).toMatchObject({ ok: true, user: { role: 'VIEWER' } })
    })
  })

  it('provisions with the mapped role when the directory group is configured, including ADMIN only by explicit mapping', async () => {
    await withRollback(async (tx) => {
      const roleGroups = roleGroupsFrom({ ADMIN: 'CN=EKMS-Admins,OU=Groups,DC=example,DC=test', ENGINEER: 'CN=Edit-Engineers,OU=Groups,DC=example,DC=test' })
      const directory = new FakeDirectory()
        .add('eng', person({ username: 'eng', id: 'guid-eng', groups: ['cn=edit-engineers,ou=groups,dc=example,dc=test'] }))
        .add('boss', person({ username: 'boss', id: 'guid-boss', groups: ['cn=ekms-admins,ou=groups,dc=example,dc=test'] }))

      expect(await signInWithPassword(tx, { username: 'eng', password: PASSWORD }, CONTEXT, methods(directory, { autoProvision: true, roleGroups }))).toMatchObject({ ok: true, user: { role: 'ENGINEER' } })
      const boss = await signInWithPassword(tx, { username: 'boss', password: PASSWORD }, CONTEXT, methods(directory, { autoProvision: true, roleGroups }))
      expect(boss).toMatchObject({ ok: true, user: { role: 'ADMIN' } })
      if (boss.ok) {
        const created = await tx.auditLog.findFirst({ where: { entityId: boss.user.id, action: 'CREATE' } })
        expect(created?.metadata).toMatchObject({ roleSource: 'group' })
      }
    })
  })
})

describe('group mapping on an existing account', () => {
  const roleGroups = roleGroupsFrom({ ENGINEER: 'CN=Edit-Engineers,OU=Groups,DC=example,DC=test', VIEWER: 'CN=All-Staff,OU=Groups,DC=example,DC=test' })

  it('moves the role to what the groups say, revokes other sessions, and audits the change to the directory', async () => {
    await withRollback(async (tx) => {
      const account = await directoryAccount(tx, { email: 'k.mansoori@example.test', role: UserRole.VIEWER })
      const directory = new FakeDirectory().add('k.mansoori', person({ groups: ['cn=edit-engineers,ou=groups,dc=example,dc=test'] }))

      const result = await signInWithPassword(tx, { username: 'k.mansoori', password: PASSWORD }, CONTEXT, methods(directory, { roleGroups }))
      expect(result).toMatchObject({ ok: true, user: { id: account.id, role: 'ENGINEER', sessionVersion: 1 } })

      const row = await tx.user.findUniqueOrThrow({ where: { id: account.id } })
      expect(row.sessionVersion).toBe(1)
      // A token issued before the change now fails the version check the jwt callback applies.
      expect(row.sessionVersion).not.toBe(account.sessionVersion)

      const change = await tx.auditLog.findFirst({ where: { entityId: account.id, action: 'ROLE_CHANGED' } })
      expect(change).toMatchObject({ actorName: 'Corporate directory', previousValue: { role: 'VIEWER' }, newValue: { role: 'ENGINEER' }, metadata: { source: 'group' } })
    })
  })

  it('leaves the local role alone when no configured group matches, and when no groups are configured at all', async () => {
    await withRollback(async (tx) => {
      const account = await directoryAccount(tx, { email: 'k.mansoori@example.test', role: UserRole.ENGINEER })
      const directory = new FakeDirectory().add('k.mansoori', person({ groups: ['cn=domain-admins,cn=users,dc=example,dc=test'] }))

      expect(await signInWithPassword(tx, { username: 'k.mansoori', password: PASSWORD }, CONTEXT, methods(directory, { roleGroups }))).toMatchObject({ ok: true, user: { role: 'ENGINEER', sessionVersion: 0 } })
      expect(await signInWithPassword(tx, { username: 'k.mansoori', password: PASSWORD }, CONTEXT, methods(directory))).toMatchObject({ ok: true, user: { role: 'ENGINEER', sessionVersion: 0 } })
      expect(await tx.auditLog.count({ where: { entityId: account.id, action: 'ROLE_CHANGED' } })).toBe(0)
    })
  })

  it('never demotes the last active administrator, however the groups map, and says so in the audit log', async () => {
    await withRollback(async (tx) => {
      // Inside this rolled-back transaction, make our account the only active administrator.
      await tx.user.updateMany({ where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE }, data: { status: UserStatus.SUSPENDED } })
      const sole = await directoryAccount(tx, { email: 'sole.admin@example.test', role: UserRole.ADMIN })
      const directory = new FakeDirectory().add('sole.admin', person({ username: 'sole.admin', email: 'sole.admin@example.test', id: 'guid-sole', groups: ['cn=all-staff,ou=groups,dc=example,dc=test'] }))

      const result = await signInWithPassword(tx, { username: 'sole.admin', password: PASSWORD }, CONTEXT, methods(directory, { roleGroups }))
      expect(result).toMatchObject({ ok: true, user: { id: sole.id, role: 'ADMIN', sessionVersion: 0 } })

      const kept = await tx.auditLog.findFirst({ where: { entityId: sole.id, action: 'UPDATE', summary: { contains: 'last active administrator' } } })
      expect(kept).not.toBeNull()
      expect(kept?.metadata).toMatchObject({ mappedRole: 'VIEWER', kept: 'ADMIN' })
      expect(await tx.auditLog.count({ where: { entityId: sole.id, action: 'ROLE_CHANGED' } })).toBe(0)

      // With another administrator active, the same sign-in does follow the groups.
      const other = await directoryAccount(tx, { email: 'other.admin@example.test', role: UserRole.ADMIN })
      expect(other.role).toBe('ADMIN')
      const again = await signInWithPassword(tx, { username: 'sole.admin', password: PASSWORD }, CONTEXT, methods(directory, { roleGroups }))
      expect(again).toMatchObject({ ok: true, user: { id: sole.id, role: 'VIEWER', sessionVersion: 1 } })
    })
  })

  it('does not lower a locally granted ADMIN unless an ADMIN group is configured and they are outside every mapped group that outranks their new one', async () => {
    await withRollback(async (tx) => {
      // Only ENGINEER and VIEWER groups are mapped: a local ADMIN in the engineers group is remapped to engineer -
      // that is what configuring groups means - but a local ADMIN in no mapped group keeps their role.
      const untouched = await directoryAccount(tx, { email: 'admin.one@example.test', role: UserRole.ADMIN })
      const directory = new FakeDirectory().add('admin.one', person({ username: 'admin.one', email: 'admin.one@example.test', id: 'guid-a1', groups: [] }))
      expect(await signInWithPassword(tx, { username: 'admin.one', password: PASSWORD }, CONTEXT, methods(directory, { roleGroups }))).toMatchObject({ ok: true, user: { id: untouched.id, role: 'ADMIN' } })
    })
  })
})

describe('the local path is unchanged for local accounts', () => {
  it('still hashes with bcrypt and still locks after repeated failures', async () => {
    await withRollback(async (tx) => {
      const user = await createTestUser(tx, { role: UserRole.ENGINEER })
      const directory = new FakeDirectory()
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(await signInWithPassword(tx, { username: user.email, password: `wrong-${attempt}` }, CONTEXT, methods(directory))).toEqual({ ok: false, reason: 'invalid' })
      }
      const locked = await signInWithPassword(tx, { username: user.email, password: TEST_PASSWORD }, CONTEXT, methods(directory))
      expect(locked).toMatchObject({ ok: false, reason: 'locked' })
      expect(directory.calls).toEqual([])
      expect((await tx.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toMatch(/^\$2[aby]\$12\$/)
      expect(await hashPassword('another-long-password')).toMatch(/^\$2[aby]\$12\$/)
    })
  })
})
