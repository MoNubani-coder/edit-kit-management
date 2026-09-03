import { randomUUID } from 'node:crypto'

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, UserRole, UserStatus } from '@prisma/client'

import { hashPassword } from '@/server/auth/password'
import type { Actor } from '@/server/auth/session'
import type { Db } from '@/server/db/prisma'

/**
 * Database helpers for the integration suites.
 *
 * Tests run against the local development database (the same one `npm run
 * db:seed` fills). Every row they create carries a `test-` prefix and an
 * `@example.test` address, and is removed in `afterAll`. Suites that only need
 * to *read* the result of a write use `withRollback`, which leaves no trace at
 * all - including in the append-only audit log.
 */

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not set.')

export const testDb = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

/** Long enough to satisfy the password policy; only ever used for test rows. */
export const TEST_PASSWORD = 'correct-horse-battery-staple-2026'

export function uniqueEmail(tag: string): string {
  return `test-${tag}-${randomUUID().slice(0, 8)}@example.test`
}

export interface TestUserOptions {
  role: UserRole
  status?: UserStatus
  password?: string | null
  /** Creates an EditorProfile linked to the user. */
  withEditorProfile?: boolean
  tag?: string
}

export interface TestUser {
  id: string
  email: string
  name: string
  role: UserRole
  password: string | null
  editorProfileId: string | null
}

export async function createTestUser(db: Db, options: TestUserOptions): Promise<TestUser> {
  const email = uniqueEmail(options.tag ?? options.role.toLowerCase())
  const password = options.password === undefined ? TEST_PASSWORD : options.password
  const name = `Test ${options.role} ${email.split('@')[0].slice(-8)}`

  const user = await db.user.create({
    data: {
      email,
      name,
      role: options.role,
      status: options.status ?? UserStatus.ACTIVE,
      passwordHash: password ? await hashPassword(password) : null,
    },
    select: { id: true },
  })

  let editorProfileId: string | null = null
  if (options.withEditorProfile) {
    const profile = await db.editorProfile.create({
      data: { userId: user.id, fullName: name, email, isExternal: false },
      select: { id: true },
    })
    editorProfileId = profile.id
  }

  return { id: user.id, email, name, role: options.role, password, editorProfileId }
}

/** Removes test users and everything that points at them. */
export async function deleteTestUsers(db: Db, users: readonly TestUser[]): Promise<void> {
  const userIds = users.map((user) => user.id)
  const profileIds = users.flatMap((user) => (user.editorProfileId ? [user.editorProfileId] : []))

  await db.booking.deleteMany({
    where: { OR: [{ createdById: { in: userIds } }, { editorId: { in: profileIds } }] },
  })
  await db.editorProfile.deleteMany({ where: { OR: [{ id: { in: profileIds } }, { userId: { in: userIds } }] } })
  await db.user.deleteMany({ where: { id: { in: userIds } } })
}

export function actorFor(user: TestUser, overrides: Partial<Actor> = {}): Actor {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    editorProfileId: user.editorProfileId,
    engineerProfileId: null,
    ...overrides,
  }
}

class Rollback extends Error {}

/**
 * Runs `fn` inside a transaction that is always rolled back. Everything the
 * code under test writes - users, counters, audit rows - disappears.
 */
export async function withRollback(fn: (tx: Db) => Promise<void>): Promise<void> {
  try {
    await testDb.$transaction(
      async (tx) => {
        await fn(tx)
        throw new Rollback()
      },
      { maxWait: 10_000, timeout: 60_000 },
    )
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
}
