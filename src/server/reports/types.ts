import 'server-only'

import type { Permission } from '@/server/auth/permissions'
import type { Db } from '@/server/db/prisma'

/**
 * The report query layer (AD-5).
 *
 * Every report is a function returning `{ columns, rows }`. The HTML table, the
 * CSV writer and any future Excel writer are renderers over that one shape, so
 * adding an export format is one renderer rather than eleven report rewrites.
 *
 * Rows are plain values only - strings, numbers, dates, booleans, null. No
 * Prisma objects, no nested records, and nothing a renderer would have to know
 * the shape of. That is also what keeps a report from leaking a field nobody
 * asked for: a column has to be declared to appear.
 */

export type CellValue = string | number | boolean | Date | null

export type ColumnKind = 'text' | 'code' | 'number' | 'date' | 'datetime' | 'status' | 'severity' | 'boolean'

export interface ColumnDef {
  key: string
  label: string
  kind: ColumnKind
  /** Right-aligned in the table and unquoted in CSV. */
  numeric?: boolean
  /** Hidden below `lg`, for detail a narrow screen can do without. */
  secondary?: boolean
  /** Turns the cell into a link to this row's record, e.g. `/bookings`. */
  linkTo?: 'booking' | 'kit' | 'asset' | 'issue' | 'editor'
}

export interface ReportRow {
  /** The record this row is about, for the optional link. Never rendered. */
  id?: string
  [key: string]: CellValue | undefined
}

export interface ReportResult {
  columns: ColumnDef[]
  rows: ReportRow[]
  total: number
  page: number
  pageSize: number
  pageCount: number
  /** One line under the title: what this page of the report is showing. */
  summary: string
}

/** Which filter controls a report offers. Parsing is shared (filters.ts). */
export type FilterKey = 'search' | 'from' | 'to' | 'status' | 'kitId' | 'editorId' | 'severity'

export interface ReportParams {
  search?: string
  /** Inclusive start of the window, in the business time zone. */
  from?: Date
  /** Exclusive end of the window. */
  to?: Date
  status?: string
  kitId?: string
  editorId?: string
  severity?: string
  page: number
  pageSize: number
  /** Everything a report renders is relative to one instant. */
  now: Date
  timeZone: string
  /** Own-booking scoping for a report a reader may only partly see. */
  scope: ReportScope | null
}

/**
 * How much of the data a caller may see. `null` means everything (a reader
 * holding `booking.read`); an editor profile id narrows every booking-shaped
 * report to that editor's own rows.
 */
export interface ReportScope {
  editorProfileId: string
}

export interface ReportDefinition {
  id: string
  title: string
  /** One sentence: what question this report answers. */
  description: string
  /** Grouped on the catalogue page. */
  group: 'Operations' | 'History' | 'Equipment'
  /** Held in addition to `report.read`; empty means `report.read` alone. */
  alsoNeeds: readonly Permission[]
  filters: readonly FilterKey[]
  /** Status values this report's status filter offers, if any. */
  statusOptions?: readonly { value: string; label: string }[]
  run: (db: Db, params: ReportParams) => Promise<ReportResult>
}

/** Helpers shared by the definitions. */
export function paginate(page: number, pageSize: number, total: number) {
  return { skip: (page - 1) * pageSize, take: pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) }
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
