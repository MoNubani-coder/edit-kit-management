import { NumberScope } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import type { Db } from '@/server/db/prisma'
import { nextNumber, peekNextNumber } from '@/server/services/numbering.service'

/**
 * Numbering, as a unit.
 *
 * `nextNumber` is one atomic upsert, so what is worth testing without a
 * database is everything around it: which period a scope counts in, how the
 * serial is padded, and that the value the database returns is formatted into
 * the reference people quote in emails. The atomic increment itself is proved
 * against real PostgreSQL in `tests/integration/constraints.test.ts`.
 *
 * The stub client records the parameters the tagged template passes, so the
 * assertions can check the scope and period actually sent to the statement
 * rather than trusting the formatted string alone.
 */

interface Recorded {
  scope: string
  period: string
}

function stubDb(current: number, recorded: Recorded[] = []): { db: Db; recorded: Recorded[] } {
  const db = {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      recorded.push({ scope: String(values[0]), period: String(values[1]) })
      // The real statement is an INSERT ... ON CONFLICT DO UPDATE ... RETURNING.
      expect(strings.join('')).toContain('ON CONFLICT')
      expect(strings.join('')).toContain('RETURNING')
      return [{ current }]
    },
  } as unknown as Db

  return { db, recorded }
}

function stubPeek(current: number | null): Db {
  return {
    numberSequence: {
      async findUnique() {
        return current === null ? null : { current }
      },
    },
  } as unknown as Db
}

const JANUARY_2026 = new Date('2026-01-01T00:00:00.000Z')
const DECEMBER_2026 = new Date('2026-12-31T23:59:59.000Z')
const JANUARY_2027 = new Date('2027-01-01T00:00:00.000Z')

describe('nextNumber - formatting', () => {
  it('formats a yearly booking reference as BK-YYYY-NNNNNN', async () => {
    const { db } = stubDb(42)
    await expect(nextNumber(db, NumberScope.BOOKING, JANUARY_2026)).resolves.toBe('BK-2026-000042')
  })

  it('formats a yearly issue reference as ISS-YYYY-NNNNNN', async () => {
    const { db } = stubDb(7)
    await expect(nextNumber(db, NumberScope.ISSUE, JANUARY_2026)).resolves.toBe('ISS-2026-000007')
  })

  it('formats a yearly maintenance reference as MNT-YYYY-NNNNNN', async () => {
    const { db } = stubDb(3)
    await expect(nextNumber(db, NumberScope.MAINTENANCE, JANUARY_2026)).resolves.toBe('MNT-2026-000003')
  })

  it('formats a yearly inspection reference as INS-YYYY-NNNNNN', async () => {
    const { db } = stubDb(1)
    await expect(nextNumber(db, NumberScope.INSPECTION, JANUARY_2026)).resolves.toBe('INS-2026-000001')
  })

  it('leaves the year out of a global asset reference', async () => {
    const { db } = stubDb(15)
    await expect(nextNumber(db, NumberScope.ASSET, JANUARY_2026)).resolves.toBe('AST-000015')
  })

  it('pads a kit reference to four digits, not six', async () => {
    const { db } = stubDb(2)
    await expect(nextNumber(db, NumberScope.KIT, JANUARY_2026)).resolves.toBe('KIT-0002')
  })

  it('does not truncate a value wider than the padding', async () => {
    const { db } = stubDb(1_234_567)
    await expect(nextNumber(db, NumberScope.ASSET, JANUARY_2026)).resolves.toBe('AST-1234567')
  })
})

describe('nextNumber - the period a scope counts in', () => {
  it('counts a yearly scope against the calendar year', async () => {
    const { db, recorded } = stubDb(1)
    await nextNumber(db, NumberScope.BOOKING, JANUARY_2026)
    expect(recorded[0]).toEqual({ scope: 'BOOKING', period: '2026' })
  })

  it('counts a global scope against a single continuous period', async () => {
    const { db, recorded } = stubDb(1)
    await nextNumber(db, NumberScope.ASSET, JANUARY_2026)
    expect(recorded[0]).toEqual({ scope: 'ASSET', period: 'GLOBAL' })
  })

  it('starts a new yearly period at the turn of the year', async () => {
    const recorded: Recorded[] = []
    await nextNumber(stubDb(600, recorded).db, NumberScope.BOOKING, DECEMBER_2026)
    await nextNumber(stubDb(1, recorded).db, NumberScope.BOOKING, JANUARY_2027)
    expect(recorded.map((entry) => entry.period)).toEqual(['2026', '2027'])
  })

  it('keeps a global scope on the same period across the turn of the year', async () => {
    const recorded: Recorded[] = []
    await nextNumber(stubDb(15, recorded).db, NumberScope.ASSET, DECEMBER_2026)
    await nextNumber(stubDb(16, recorded).db, NumberScope.ASSET, JANUARY_2027)
    expect(recorded.map((entry) => entry.period)).toEqual(['GLOBAL', 'GLOBAL'])
  })

  it('reads the year in UTC, so a late-evening local booking cannot land in the wrong year', async () => {
    const { recorded } = stubDb(1)
    // 23:30 on 31 December in Dubai is already 19:30 UTC the same day.
    await nextNumber(stubDb(1, recorded).db, NumberScope.BOOKING, new Date('2026-12-31T19:30:00.000Z'))
    expect(recorded[0]?.period).toBe('2026')
  })

  it('allocates every scope the schema defines', async () => {
    for (const scope of Object.values(NumberScope)) {
      const { db } = stubDb(1)
      await expect(nextNumber(db, scope, JANUARY_2026)).resolves.toMatch(/^[A-Z]{2,3}-/)
    }
  })
})

describe('nextNumber - failure', () => {
  it('refuses to hand back a reference when the statement returns nothing', async () => {
    const db = { async $queryRaw() { return [] } } as unknown as Db
    await expect(nextNumber(db, NumberScope.BOOKING, JANUARY_2026)).rejects.toThrow(/Failed to allocate a BOOKING number/)
  })

  it('refuses to hand back a reference when the counter is not a number', async () => {
    const db = { async $queryRaw() { return [{ current: null }] } } as unknown as Db
    await expect(nextNumber(db, NumberScope.ASSET, JANUARY_2026)).rejects.toThrow(/Failed to allocate an? ASSET number/)
  })
})

describe('peekNextNumber', () => {
  it('shows the reference the next allocation would take', async () => {
    await expect(peekNextNumber(stubPeek(41), NumberScope.BOOKING, JANUARY_2026)).resolves.toBe('BK-2026-000042')
  })

  it('shows the first reference when the scope has never been used', async () => {
    await expect(peekNextNumber(stubPeek(null), NumberScope.BOOKING, JANUARY_2026)).resolves.toBe('BK-2026-000001')
    await expect(peekNextNumber(stubPeek(null), NumberScope.ASSET, JANUARY_2026)).resolves.toBe('AST-000001')
    await expect(peekNextNumber(stubPeek(null), NumberScope.KIT, JANUARY_2026)).resolves.toBe('KIT-0001')
  })

  it('does not consume anything', async () => {
    const db = stubPeek(41)
    await peekNextNumber(db, NumberScope.BOOKING, JANUARY_2026)
    await expect(peekNextNumber(db, NumberScope.BOOKING, JANUARY_2026)).resolves.toBe('BK-2026-000042')
  })
})
