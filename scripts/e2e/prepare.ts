/**
 * Builds the end-to-end database from nothing.
 *
 * The journey the E2E suite drives writes real bookings, inspections and
 * signatures, so it must never touch the development database. This script
 * creates a database of its own, applies the same migrations, seeds it with
 * passwords the specs know, and leaves the development data untouched.
 *
 *   npm run e2e:prepare   # create or rebuild the E2E database
 *   npm run e2e:drop      # drop it
 *
 * Playwright runs this before the suite (`globalSetup`), so a bare
 * `npm run test:e2e` is enough.
 */

import { execFileSync } from 'node:child_process'

import 'dotenv/config'
import { Client } from 'pg'

const E2E_DATABASE = process.env.E2E_DATABASE_NAME ?? 'ekms_e2e'

/** The E2E accounts. Deliberately fixed, deliberately only ever on this database. */
export const E2E_PASSWORD = 'e2e-only-Passw0rd!2026'
export const E2E_USERS = {
  admin: { email: 'e2e-admin@example.test', password: E2E_PASSWORD },
  engineer: { email: 'e2e-engineer@example.test', password: E2E_PASSWORD },
  editor: { email: 'e2e-editor@example.test', password: E2E_PASSWORD },
  viewer: { email: 'e2e-viewer@example.test', password: E2E_PASSWORD },
} as const

/** The development URL with the database name swapped for the E2E one. */
export function e2eDatabaseUrl(): string {
  const source = process.env.DATABASE_URL
  if (!source) throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.')
  const url = new URL(source)
  url.pathname = `/${E2E_DATABASE}`
  return url.toString()
}

function adminUrl(): string {
  const url = new URL(e2eDatabaseUrl())
  url.pathname = '/postgres'
  url.search = ''
  return url.toString()
}

async function withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: adminUrl() })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

export async function dropDatabase(): Promise<void> {
  await withAdmin(async (client) => {
    // Anything still connected would block the drop.
    await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [E2E_DATABASE])
    await client.query(`DROP DATABASE IF EXISTS "${E2E_DATABASE}"`)
  })
}

async function createDatabase(): Promise<void> {
  await withAdmin(async (client) => {
    await client.query(`CREATE DATABASE "${E2E_DATABASE}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`)
  })
}

function run(command: string, args: readonly string[], env: Record<string, string>): void {
  execFileSync(command, [...args], { stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' })
}

export default async function prepare(): Promise<void> {
  const databaseUrl = e2eDatabaseUrl()
  const guard = new URL(databaseUrl).pathname.replace('/', '')
  if (guard !== E2E_DATABASE) throw new Error(`Refusing to prepare "${guard}": the E2E database must be ${E2E_DATABASE}.`)

  console.log(`\n  Rebuilding the end-to-end database "${E2E_DATABASE}"...`)
  await dropDatabase()
  await createDatabase()

  const env: Record<string, string> = {
    DATABASE_URL: databaseUrl,
    SEED_ADMIN_EMAIL: E2E_USERS.admin.email,
    SEED_ADMIN_PASSWORD: E2E_USERS.admin.password,
    SEED_ENGINEER_EMAIL: E2E_USERS.engineer.email,
    SEED_ENGINEER_PASSWORD: E2E_USERS.engineer.password,
    SEED_EDITOR_EMAIL: E2E_USERS.editor.email,
    SEED_EDITOR_PASSWORD: E2E_USERS.editor.password,
    SEED_VIEWER_EMAIL: E2E_USERS.viewer.email,
    SEED_VIEWER_PASSWORD: E2E_USERS.viewer.password,
  }

  run('npx', ['prisma', 'migrate', 'deploy'], env)
  run('npx', ['prisma', 'db', 'seed'], env)

  console.log(`  Ready. Four accounts seeded on ${E2E_DATABASE}.\n`)
}
