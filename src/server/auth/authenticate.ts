import { UserRole } from '@prisma/client'

import { env } from '@/lib/env'
import type { Db } from '@/server/db/prisma'

import { type AuthenticatedUser, type RequestContext, verifyCredentials } from './credentials'
import { type DirectoryAccountPolicy, type DirectorySignInResult, roleGroupsFrom, signInWithDirectory } from './ldap/authenticate'
import { type Directory, directorySettingsFrom, LdapDirectory } from './ldap/directory'
import { isPasswordHash } from './password'

/**
 * One front door, two ways through it.
 *
 * A sign-in name is either a local account's email or a corporate username.
 * The rule that tells them apart is deliberately simple and never depends on
 * anything the browser says: if the name is the email of a local account that
 * *has a password*, the password is checked here and goes nowhere else; any
 * other name goes to the corporate directory. Local accounts are the
 * emergency administrators and the seeded development users; directory
 * accounts have no local password and cannot take the local path at all.
 *
 * Each method can be switched off in configuration. With the directory off
 * (the default until it is commissioned) every name takes the local path and
 * nothing here behaves differently from before.
 */

export type SignInResult =
  | { ok: true; user: AuthenticatedUser; method: 'local' | 'ldap' }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'disabled' }
  | { ok: false; reason: 'locked'; retryAfterMinutes: number }
  | { ok: false; reason: 'not_provisioned' }
  | { ok: false; reason: 'unavailable' }
  | { ok: false; reason: 'misconfigured' }

export interface SignInMethods {
  localLoginEnabled: boolean
  directory: { client: Directory; policy: DirectoryAccountPolicy } | null
}

let defaultMethods: SignInMethods | undefined

/** The methods the running configuration allows, built once. */
export function configuredSignInMethods(): SignInMethods {
  if (defaultMethods) return defaultMethods
  defaultMethods = {
    localLoginEnabled: env.AUTH_LOCAL_LOGIN_ENABLED,
    directory: env.AUTH_LDAP_ENABLED
      ? {
          client: new LdapDirectory(directorySettingsFrom(env)),
          policy: {
            autoProvision: env.LDAP_AUTO_PROVISION,
            defaultRole: env.LDAP_DEFAULT_ROLE,
            roleGroups: roleGroupsFrom({
              [UserRole.ADMIN]: env.LDAP_ROLE_GROUPS_ADMIN,
              [UserRole.ENGINEER]: env.LDAP_ROLE_GROUPS_ENGINEER,
              [UserRole.EDITOR]: env.LDAP_ROLE_GROUPS_EDITOR,
              [UserRole.VIEWER]: env.LDAP_ROLE_GROUPS_VIEWER,
            }),
          },
        }
      : null,
  }
  return defaultMethods
}

/** Whether `username` is the email of an account that holds a local password. */
export async function hasLocalPassword(db: Db, username: string): Promise<boolean> {
  if (!username.includes('@')) return false
  const user = await db.user.findUnique({ where: { email: username }, select: { passwordHash: true, deletedAt: true } })
  return Boolean(user && !user.deletedAt && isPasswordHash(user.passwordHash))
}

export async function signInWithPassword(
  db: Db,
  input: { username: string; password: string },
  context: RequestContext = {},
  methods: SignInMethods = configuredSignInMethods(),
  now: Date = new Date(),
): Promise<SignInResult> {
  const username = input.username.trim().toLowerCase()

  const local = methods.localLoginEnabled && (methods.directory === null || (await hasLocalPassword(db, username)))
  if (local) {
    const result = await verifyCredentials(db, { email: username, password: input.password }, context, now)
    return result.ok ? { ok: true, user: result.user, method: 'local' } : result
  }

  if (methods.directory) {
    const result: DirectorySignInResult = await signInWithDirectory(db, methods.directory.client, methods.directory.policy, { username, password: input.password }, context, now)
    return result.ok ? { ok: true, user: result.user, method: 'ldap' } : result
  }

  // Local sign-in is off and this is not a directory deployment: env.ts refuses
  // that combination at startup, so this is unreachable in practice.
  return { ok: false, reason: 'invalid' }
}
