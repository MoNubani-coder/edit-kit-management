import 'dotenv/config'

import { randomBytes } from 'node:crypto'

import { PrismaPg } from '@prisma/adapter-pg'
import { AuditAction, PrismaClient } from '@prisma/client'

import { hashPassword, MIN_PASSWORD_LENGTH } from '../../src/server/auth/password'

/**
 * Reset a local account's password from the command line.
 *
 *   npm run auth:reset-password -- <email> [new-password]
 *
 * With no password given, a random one is generated and printed ONCE. The
 * account's lockout counters are cleared and its `sessionVersion` is bumped, so
 * every existing session for that user ends immediately (AD-2). Status is left
 * untouched: a DISABLED account stays disabled.
 *
 * This is the development-time recovery path (the seed never re-prints a
 * password) and the break-glass path for the first administrator in a new
 * environment. It refuses to run with NODE_ENV=production unless
 * RESET_PASSWORD_ALLOW_PRODUCTION=true is set explicitly.
 */

function usage(): never {
  console.error('Usage: npm run auth:reset-password -- <email> [new-password]')
  process.exit(2)
}

async function main() {
  const [emailArg, passwordArg] = process.argv.slice(2)
  if (!emailArg) usage()

  if (process.env.NODE_ENV === 'production' && process.env.RESET_PASSWORD_ALLOW_PRODUCTION !== 'true') {
    throw new Error(
      'Refusing to reset a password with NODE_ENV=production. Set RESET_PASSWORD_ALLOW_PRODUCTION=true if this is intended.',
    )
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set.')

  const email = emailArg.trim().toLowerCase()
  const generated = !passwordArg
  const password = passwordArg ?? randomBytes(18).toString('base64url')

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, status: true, deletedAt: true },
    })

    if (!user || user.deletedAt) {
      throw new Error(`No account found for ${email}.`)
    }

    const passwordHash = await hashPassword(password)

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
          sessionVersion: { increment: 1 },
        },
      })

      await tx.auditLog.create({
        data: {
          action: AuditAction.PASSWORD_CHANGED,
          entityType: 'User',
          entityId: user.id,
          actorName: 'cli:reset-password',
          summary: `Password reset for ${user.email} from the command line; all sessions revoked`,
          metadata: { generated },
        },
      })
    })

    console.log(`\nPassword reset for ${user.email} (status: ${user.status}). All sessions for this user have been signed out.`)
    if (generated) {
      console.log('\n  The new password is shown ONCE. Copy it now:\n')
      console.log(`  ${password}\n`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('\nReset failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
