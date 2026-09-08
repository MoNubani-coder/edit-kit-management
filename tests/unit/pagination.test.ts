import { describe, expect, it } from 'vitest'

import { clampPage, DEFAULT_PAGE_SIZE, PAGE_SIZE_MAX, PAGE_SIZE_MAX_DENSE, PAGE_SIZE_MIN, pageCountFor, pageSchema, pageSizeSchema } from '@/lib/pagination'
import { parseAuditListParams } from '@/lib/validation/audit'
import { parseBookingListParams } from '@/lib/validation/bookings'
import { parseUserListParams } from '@/lib/validation/admin'

/**
 * One pagination rule for every list.
 *
 * The page and page size come out of the query string, so they are as
 * attacker-controlled as any other URL: a page of `-4`, a size of `100000`, a
 * page past the end of the result. None of those may produce an empty table
 * with a nonsense range, and none may turn into an unbounded query.
 */

describe('the page size', () => {
  const schema = pageSizeSchema()

  it('defaults when absent, empty or unreadable', () => {
    expect(schema.parse(undefined)).toBe(DEFAULT_PAGE_SIZE)
    expect(schema.parse('')).toBe(DEFAULT_PAGE_SIZE)
    expect(schema.parse('not a number')).toBe(DEFAULT_PAGE_SIZE)
  })

  it('clamps to the nearest bound rather than falling back to the default', () => {
    expect(schema.parse('1')).toBe(PAGE_SIZE_MIN)
    expect(schema.parse('-40')).toBe(PAGE_SIZE_MIN)
    expect(schema.parse('100000')).toBe(PAGE_SIZE_MAX)
    expect(schema.parse('37')).toBe(37)
    expect(schema.parse('25.9')).toBe(25)
  })

  it('lets a dense read-only table go further, but no further than its own ceiling', () => {
    const dense = pageSizeSchema(50, PAGE_SIZE_MAX_DENSE)
    expect(dense.parse(undefined)).toBe(50)
    expect(dense.parse('200')).toBe(PAGE_SIZE_MAX_DENSE)
    expect(dense.parse('5000')).toBe(PAGE_SIZE_MAX_DENSE)
  })
})

describe('the page number', () => {
  it('is at least one, whatever the URL says', () => {
    expect(pageSchema.parse(undefined)).toBe(1)
    expect(pageSchema.parse('0')).toBe(1)
    expect(pageSchema.parse('-3')).toBe(1)
    expect(pageSchema.parse('nonsense')).toBe(1)
    expect(pageSchema.parse('4')).toBe(4)
  })

  it('lands on the last page that exists, never past it', () => {
    expect(clampPage(1, 3)).toBe(1)
    expect(clampPage(3, 3)).toBe(3)
    expect(clampPage(99, 3)).toBe(3)
    // An empty result still has a first page for the empty state to sit on.
    expect(clampPage(4, 0)).toBe(1)
  })

  it('counts pages the way the footer reads them', () => {
    expect(pageCountFor(0, 25)).toBe(1)
    expect(pageCountFor(25, 25)).toBe(1)
    expect(pageCountFor(26, 25)).toBe(2)
    expect(pageCountFor(51, 25)).toBe(3)
  })
})

describe('every list parser follows the same rule', () => {
  it('clamps the size and floors the page, on entity lists and dense ones alike', () => {
    expect(parseBookingListParams({ page: '-2', pageSize: '99999' })).toMatchObject({ page: 1, pageSize: PAGE_SIZE_MAX })
    expect(parseUserListParams({ page: '0', pageSize: '2' })).toMatchObject({ page: 1, pageSize: PAGE_SIZE_MIN })
    expect(parseAuditListParams({ page: 'x', pageSize: '5000' })).toMatchObject({ page: 1, pageSize: PAGE_SIZE_MAX_DENSE })
  })
})
