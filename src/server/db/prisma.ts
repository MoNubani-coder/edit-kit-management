import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

import { env, isProduction } from '@/lib/env'

/**
 * Prisma client singleton.
 *
 * Prisma 7 no longer reads the connection URL from schema.prisma - the client is
 * constructed with a driver adapter instead. `prisma.config.ts` supplies the URL
 * separately for the CLI (migrate / studio / seed).
 *
 * The `globalThis` cache exists because Next.js dev mode re-evaluates modules on
 * every edit. Without it each save opens a fresh connection pool and Postgres
 * runs out of connections within a few minutes of working.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    // A handover completion holds a transaction across ~8 tables. A small pool
    // with a hard timeout surfaces contention as an error rather than as a
    // request that hangs until the browser gives up.
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  })

  return new PrismaClient({
    adapter,
    log: isProduction ? ['warn', 'error'] : ['warn', 'error'],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (!isProduction) {
  globalForPrisma.prisma = prisma
}

/**
 * The transaction client type.
 *
 * Services take one of these rather than importing `prisma` directly, so the
 * caller owns the transaction boundary. Completing a handover writes to roughly
 * eight tables and must be atomic; a service that reaches for the global client
 * cannot take part in that transaction.
 */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>

/** Accepts either the root client or an open transaction. */
export type Db = PrismaClient | PrismaTransactionClient
