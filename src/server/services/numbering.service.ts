import { NumberScope } from '@prisma/client'

import type { Db } from '@/server/db/prisma'

/**
 * Human-readable reference numbers (BK-2026-000001, AST-000001, ISS-2026-000001).
 *
 * Why not a Postgres sequence? Sequences deliberately do not roll back - a
 * failed insert burns the number and leaves a permanent gap. These references
 * get quoted in emails and equipment disputes, so gaps invite the question
 * "what happened to BK-2026-000042?".
 *
 * Instead a counter row is incremented with a single atomic
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, executed *inside the caller's
 * transaction*. If the booking insert fails, the increment rolls back with it.
 *
 * Trade-off: concurrent allocations within one scope serialise on the counter
 * row. At this system's volume (hundreds of bookings a year) that is free.
 */

/** Sequences reset each January; `GLOBAL` ones run continuously. */
type PeriodStrategy = 'YEARLY' | 'GLOBAL'

interface ScopeConfig {
  prefix: string
  period: PeriodStrategy
  padding: number
}

const SCOPE_CONFIG: Record<NumberScope, ScopeConfig> = {
  [NumberScope.BOOKING]: { prefix: 'BK', period: 'YEARLY', padding: 6 },
  [NumberScope.ISSUE]: { prefix: 'ISS', period: 'YEARLY', padding: 6 },
  [NumberScope.ASSET]: { prefix: 'AST', period: 'GLOBAL', padding: 6 },
  [NumberScope.KIT]: { prefix: 'KIT', period: 'GLOBAL', padding: 4 },
  [NumberScope.INSPECTION]: { prefix: 'INS', period: 'YEARLY', padding: 6 },
  [NumberScope.MAINTENANCE]: { prefix: 'MNT', period: 'YEARLY', padding: 6 },
}

const GLOBAL_PERIOD = 'GLOBAL'

function resolvePeriod(config: ScopeConfig, now: Date): string {
  return config.period === 'GLOBAL' ? GLOBAL_PERIOD : String(now.getUTCFullYear())
}

function format(config: ScopeConfig, period: string, value: number): string {
  const serial = String(value).padStart(config.padding, '0')

  return config.period === 'GLOBAL'
    ? `${config.prefix}-${serial}`
    : `${config.prefix}-${period}-${serial}`
}

/**
 * Allocates the next reference for `scope`.
 *
 * MUST be called with a transaction client that is also writing the entity being
 * numbered - otherwise the rollback guarantee above does not hold.
 *
 * @example
 * await prisma.$transaction(async (tx) => {
 *   const bookingNumber = await nextNumber(tx, NumberScope.BOOKING)
 *   return tx.booking.create({ data: { bookingNumber, ...input } })
 * })
 */
export async function nextNumber(
  db: Db,
  scope: NumberScope,
  now: Date = new Date(),
): Promise<string> {
  const config = SCOPE_CONFIG[scope]
  const period = resolvePeriod(config, now)

  // Single statement: creates the counter on first use, increments it otherwise.
  // `RETURNING` gives us the post-increment value without a second read, so
  // there is no window for another transaction to take the same number.
  const rows = await db.$queryRaw<Array<{ current: number }>>`
    INSERT INTO "number_sequences" ("id", "scope", "period", "current", "updatedAt")
    VALUES (gen_random_uuid()::text, ${scope}::"NumberScope", ${period}, 1, now())
    ON CONFLICT ("scope", "period")
      DO UPDATE SET "current" = "number_sequences"."current" + 1,
                    "updatedAt" = now()
    RETURNING "current"
  `

  const current = rows[0]?.current

  if (typeof current !== 'number') {
    throw new Error(`Failed to allocate a ${scope} number for period ${period}`)
  }

  return format(config, period, current)
}

/**
 * Reads the next number without consuming it - for previewing "this will be
 * BK-2026-000042" in a form. Never use the result as the actual reference: two
 * users previewing at once would both see the same value.
 */
export async function peekNextNumber(
  db: Db,
  scope: NumberScope,
  now: Date = new Date(),
): Promise<string> {
  const config = SCOPE_CONFIG[scope]
  const period = resolvePeriod(config, now)

  const sequence = await db.numberSequence.findUnique({
    where: { scope_period: { scope, period } },
    select: { current: true },
  })

  return format(config, period, (sequence?.current ?? 0) + 1)
}
