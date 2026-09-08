import { z } from 'zod'

/**
 * One pagination rule for every list.
 *
 * Every paginated table in the application parses its page and page size
 * through these two helpers, so the behaviour is the same wherever a person
 * lands: an out-of-range page size is clamped to the nearest bound rather than
 * silently replaced by the default, and an out-of-range page number lands on
 * the last page rather than on an empty one with a nonsense range.
 *
 * Entity lists default to 25 rows; dense read-only tables (the audit log and
 * the reports) default to 50 and allow 200. The floor and the behaviour are
 * shared; only the ceiling differs by kind.
 */

export const PAGE_SIZE_MIN = 5
export const PAGE_SIZE_MAX = 100
export const PAGE_SIZE_MAX_DENSE = 200
export const DEFAULT_PAGE_SIZE = 25
export const DEFAULT_PAGE_SIZE_DENSE = 50

/**
 * A page-size field for a URL parser: coerced from the query string, clamped
 * into range, and defaulting when absent or unreadable.
 */
export function pageSizeSchema(defaultSize: number = DEFAULT_PAGE_SIZE, max: number = PAGE_SIZE_MAX) {
  return z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === '') return defaultSize
      const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
      if (!Number.isFinite(parsed)) return defaultSize
      return Math.min(max, Math.max(PAGE_SIZE_MIN, Math.trunc(parsed)))
    },
    z.number().int().min(PAGE_SIZE_MIN).max(max),
  )
}

/** A page number for a URL parser: at least 1, defaulting to 1. */
export const pageSchema = z.coerce.number().int().min(1).catch(1)

/** The page that actually exists for this result: never past the last one, never below the first. */
export function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(1, page), Math.max(1, pageCount))
}

/** How many pages `total` rows make at this size; always at least one, so an empty list still has a page. */
export function pageCountFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}
