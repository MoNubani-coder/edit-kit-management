import 'dotenv/config'

/**
 * Global test setup. Loads `.env` so `src/lib/env.ts` validates and the
 * integration suites can reach the local development database. Vitest sets
 * NODE_ENV=test, which env.ts accepts.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env before running the tests.')
}
