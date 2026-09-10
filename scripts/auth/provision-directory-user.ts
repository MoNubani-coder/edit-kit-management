import 'dotenv/config'

import { PrismaPg } from '@prisma/adapter-pg'
import { AuditAction, PrismaClient, UserRole, UserStatus } from '@prisma/client'

/**
 * Create the local account for a person who signs in through the corporate
 * directory, from the command line.
 *
 *   npm run auth:provision-directory-user -- <corporate-email> --name "Full Name" --role ENGINEER [--staff-id ADM-1234]
 *
 * This is the administrator's half of the default provisioning policy
 * (LDAP_AUTO_PROVISION=false): the account exists here first, with the role an
 * administrator chose and no local password; the person's first successful
 * directory sign-in links it to their directory identity by email, and from
 * then on by the directory's stable id. Nothing is invented about the
 * directory: the email must be the one the directory holds for them.
 *
 * ADMIN is accepted here because a person is typing it, on purpose, with a
 * database connection string in hand - the same trust the seed and the reset
 * script already carry. It is still audited.
 */

function usage(): never {
  console.error('Usage: npm run auth:provision-directory-user -- <corporate-email> --name "Full Name" --role ADMIN|ENGINEER|EDITOR|VIEWER [--staff-id <id>]')
  process.exit(2)
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) usage()
  return value
}

async function main() {
  const args = process.argv.slice(2)
  const emailArg = args.find((arg) => !arg.startsWith('--') && !args[args.indexOf(arg) - 1]?.startsWith('--'))
  const name = option(args, '--name')?.trim()
  const roleArg = option(args, '--role')?.trim().toUpperCase()
  const staffId = option(args, '--staff-id')?.trim() || null
  if (!emailArg || !name || !roleArg) usage()

  const email = emailArg.trim().toLowerCase()
  if (!email.includes('@')) throw new Error('The email must be the address the directory holds for this person.')
  if (!(Object.values(UserRole) as string[]).includes(roleArg)) usage()
  const role = roleArg as UserRole

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set.')

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  try {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, deletedAt: true } })
    if (existing) throw new Error(`An account already exists for ${email}${existing.deletedAt ? ' (deleted; restore it instead)' : ''}.`)
    if (staffId && (await prisma.user.findUnique({ where: { staffId }, select: { id: true } }))) {
      throw new Error(`Staff ID ${staffId} is already held by another account.`)
    }

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email, name, role, status: UserStatus.ACTIVE, staffId, passwordHash: null },
        select: { id: true, email: true, name: true, role: true },
      })
      await tx.auditLog.create({
        data: {
          action: AuditAction.CREATE,
          entityType: 'User',
          entityId: created.id,
          actorName: 'cli:provision-directory-user',
          summary: `${created.email} created for corporate directory sign-in as ${role.toLowerCase()}`,
          newValue: { email: created.email, name: created.name, role, status: UserStatus.ACTIVE, signIn: 'directory' },
        },
      })
      return created
    })

    console.log(`\nCreated ${user.email} (${user.name}) as ${user.role}. No local password: they sign in with their corporate credentials, and the first sign-in links the account.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('\nProvisioning failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
