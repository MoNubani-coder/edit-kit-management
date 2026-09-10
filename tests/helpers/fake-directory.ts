import type { Directory, DirectoryAuthResult, DirectoryIdentity } from '@/server/auth/ldap/directory'

/**
 * A corporate directory made of a map.
 *
 * The integration suites need a directory that answers exactly the way the
 * real one would - right password, wrong password, no such person, server
 * down - without a server. Every call is recorded, so a test can prove the
 * directory was never asked (a local account must never send its password
 * there) and that what it was asked never contained the password.
 */

export interface FakePerson {
  password: string
  identity: DirectoryIdentity
}

export class FakeDirectory implements Directory {
  readonly calls: Array<{ username: string }> = []
  /** When set, every call answers with this instead of looking anybody up. */
  outage: 'unavailable' | 'misconfigured' | null = null

  constructor(private readonly people: Map<string, FakePerson> = new Map()) {}

  add(username: string, person: FakePerson): this {
    this.people.set(username.toLowerCase(), person)
    return this
  }

  async authenticate(username: string, password: string): Promise<DirectoryAuthResult> {
    this.calls.push({ username })
    if (this.outage) return { ok: false, reason: this.outage }
    const person = this.people.get(username.toLowerCase())
    if (!person || person.password !== password || password.length === 0) return { ok: false, reason: 'invalid' }
    return { ok: true, identity: { ...person.identity, groups: [...person.identity.groups] } }
  }
}

/** A directory person with sensible defaults; override what the test is about. */
export function person(overrides: Partial<DirectoryIdentity> & { password?: string } = {}): FakePerson {
  const { password = 'Corporate-Passw0rd!', ...identity } = overrides
  const username = identity.username ?? 'k.mansoori'
  return {
    password,
    identity: {
      id: identity.id ?? `guid-${username}`,
      username,
      dn: identity.dn ?? `CN=${username},OU=Staff,DC=example,DC=test`,
      displayName: identity.displayName === undefined ? 'Khalid Al Mansoori' : identity.displayName,
      email: identity.email === undefined ? `${username}@example.test` : identity.email,
      staffId: identity.staffId === undefined ? null : identity.staffId,
      groups: identity.groups ?? [],
    },
  }
}
