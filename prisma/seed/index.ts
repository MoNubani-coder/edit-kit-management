import 'dotenv/config'

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

import { seedUsers } from './01-users'
import { seedCatalogue, seedSettings } from './02-catalogue'
import { seedAssets } from './03-assets'
import { seedChecklists } from './04-checklists'
import { seedKits } from './05-kits'
import { seedMaintenance } from './06-maintenance'

/**
 * Seed orchestrator.
 *
 * Every step is idempotent (upsert or find-then-create), so `npm run db:seed`
 * can be run repeatedly against an existing database without duplicating rows.
 *
 * Order matters: assets need categories and accessory types; kits need assets,
 * software and a checklist template.
 *
 * The client is built here rather than imported from src/server/db/prisma.ts:
 * that module validates the full application environment (AUTH_SECRET etc.),
 * which a database seed has no business requiring.
 */

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.')
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
})

function assertNotProduction() {
  if (process.env.NODE_ENV !== 'production') return

  if (process.env.SEED_ALLOW_PRODUCTION === 'true') {
    console.warn('\n  WARNING: seeding a production database (SEED_ALLOW_PRODUCTION=true).\n')
    return
  }

  throw new Error(
    'Refusing to seed with NODE_ENV=production. Set SEED_ALLOW_PRODUCTION=true if this is really what you want.',
  )
}

async function main() {
  assertNotProduction()

  console.log('Seeding Edit Kit Management System...\n')

  const credentials = await seedUsers(prisma)
  console.log(`  users .............. ${credentials.length} accounts (ADMIN, ENGINEER, EDITOR, VIEWER) + 2 external editor profiles`)

  const catalogue = await seedCatalogue(prisma)
  console.log(
    `  catalogue .......... ${catalogue.categories} categories, ${catalogue.accessoryTypes} accessory types, ${catalogue.software} applications`,
  )

  const settings = await seedSettings(prisma)
  console.log(`  settings ........... ${settings} entries`)

  const assets = await seedAssets(prisma)
  console.log(`  assets ............. ${assets.assetsCreated} created (${assets.assetsTotal} total) with accessories`)

  const checklist = await seedChecklists(prisma)
  console.log(`  checklists ......... 1 template, ${checklist.items} items`)

  const kit = await seedKits(prisma, checklist.templateId)
  console.log(`  kits ............... 1 kit (MBP-02) with ${kit.assets} assets and ${kit.software} applications`)

  const maintenance = await seedMaintenance(prisma)
  console.log(`  maintenance ........ ${maintenance.created} created (${maintenance.total} total)`)

  // Credentials are printed once, here, and never stored anywhere readable.
  const generated = credentials.filter((credential) => credential.generated)
  const existing = credentials.filter((credential) => credential.existing)

  console.log('\nSign-in accounts:')
  for (const credential of credentials) {
    const note = credential.existing ? '(already existed - password unchanged)' : ''
    console.log(`  ${credential.role.padEnd(9)} ${credential.email} ${note}`)
  }

  if (generated.length > 0) {
    console.log('\n  The following passwords were generated randomly and are shown ONCE.')
    console.log('  Copy them now, or set SEED_*_PASSWORD in .env and re-run.\n')
    for (const credential of generated) {
      console.log(`  ${credential.role.padEnd(9)} ${credential.password}`)
    }
  }

  if (existing.length === credentials.length) {
    console.log(
      '\n  All accounts already existed. To reset passwords, set SEED_*_PASSWORD in .env',
    )
    console.log('  and run `npm run db:reset` (drops and recreates the database).')
  }

  console.log('\nSeed complete.\n')
}

main()
  .catch((error) => {
    console.error('\nSeed failed:\n', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
