import 'server-only'

import { z } from 'zod'

import { pageSizeSchema } from '@/lib/pagination'

import { businessDayRange, zonedLocalToDate } from '@/lib/datetime'

import type { FilterKey, ReportParams, ReportScope } from './types'

/**
 * Report filters, parsed from the URL once and shared by every definition.
 *
 * Dates arrive as `YYYY-MM-DD` from a date input and are read in the business
 * time zone, so "from 10 September" means the whole of that local day rather
 * than an instant in UTC. The window is half-open, `[from, to)`, matching the
 * booking rule so the two never disagree at a boundary.
 */

export const REPORT_DEFAULT_PAGE_SIZE = 50
export const REPORT_MAX_PAGE_SIZE = 200

const DAY = /^\d{4}-\d{2}-\d{2}$/

const schema = z.object({
  search: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().trim().max(100).optional()),
  from: z.preprocess((value) => (typeof value === 'string' && DAY.test(value) ? value : undefined), z.string().optional()),
  to: z.preprocess((value) => (typeof value === 'string' && DAY.test(value) ? value : undefined), z.string().optional()),
  status: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().trim().max(40).optional()),
  kitId: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().trim().max(64).optional()),
  editorId: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().trim().max(64).optional()),
  severity: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().trim().max(40).optional()),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: pageSizeSchema(REPORT_DEFAULT_PAGE_SIZE, REPORT_MAX_PAGE_SIZE),
})

export type RawParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** The raw strings, kept for re-rendering the form and building links. */
export interface ReportQuery {
  search?: string
  from?: string
  to?: string
  status?: string
  kitId?: string
  editorId?: string
  severity?: string
  page: number
  pageSize: number
}

export function parseReportQuery(raw: RawParams, allowed: readonly FilterKey[]): ReportQuery {
  const picked = Object.fromEntries(['search', 'from', 'to', 'status', 'kitId', 'editorId', 'severity', 'page', 'pageSize'].map((key) => [key, first(raw[key])]))
  const parsed = schema.safeParse(picked)
  const values = parsed.success ? parsed.data : { page: 1, pageSize: REPORT_DEFAULT_PAGE_SIZE }
  const permitted = new Set<string>(allowed)

  // A filter a report does not offer is dropped rather than half-applied.
  return {
    search: permitted.has('search') ? values.search : undefined,
    from: permitted.has('from') ? values.from : undefined,
    to: permitted.has('to') ? values.to : undefined,
    status: permitted.has('status') ? values.status : undefined,
    kitId: permitted.has('kitId') ? values.kitId : undefined,
    editorId: permitted.has('editorId') ? values.editorId : undefined,
    severity: permitted.has('severity') ? values.severity : undefined,
    page: values.page,
    pageSize: values.pageSize,
  }
}

/**
 * The typed parameters a definition receives. Local days become instants here,
 * once, so no report has to think about time zones.
 */
export function toReportParams(query: ReportQuery, options: { now: Date; timeZone: string; scope: ReportScope | null }): ReportParams {
  // A date input gives a local day; midnight local is where it starts.
  const fromInstant = query.from ? zonedLocalToDate(`${query.from}T00:00`, options.timeZone) : null
  // `to` is inclusive to the person typing it and exclusive to the query, so
  // the whole of that local day is included.
  const toDay = query.to ? zonedLocalToDate(`${query.to}T00:00`, options.timeZone) : null
  const toInstant = toDay ? businessDayRange(toDay, options.timeZone).end : null

  return {
    search: query.search,
    from: fromInstant ?? undefined,
    to: toInstant ?? undefined,
    status: query.status,
    kitId: query.kitId,
    editorId: query.editorId,
    severity: query.severity,
    page: query.page,
    pageSize: query.pageSize,
    now: options.now,
    timeZone: options.timeZone,
    scope: options.scope,
  }
}

/** The query as a URL, so every report state can be linked and exported. */
export function reportHref(reportId: string, query: ReportQuery, overrides: Partial<ReportQuery> = {}, base = '/reports'): string {
  const merged = { ...query, ...overrides }
  const search = new URLSearchParams()
  if (merged.search) search.set('search', merged.search)
  if (merged.from) search.set('from', merged.from)
  if (merged.to) search.set('to', merged.to)
  if (merged.status) search.set('status', merged.status)
  if (merged.kitId) search.set('kitId', merged.kitId)
  if (merged.editorId) search.set('editorId', merged.editorId)
  if (merged.severity) search.set('severity', merged.severity)
  if (merged.page > 1) search.set('page', String(merged.page))
  if (merged.pageSize !== REPORT_DEFAULT_PAGE_SIZE) search.set('pageSize', String(merged.pageSize))
  const query_ = search.toString()
  return query_ ? `${base}/${reportId}?${query_}` : `${base}/${reportId}`
}
