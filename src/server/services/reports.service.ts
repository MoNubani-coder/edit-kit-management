import 'server-only'

import { can } from '@/server/auth/permissions'
import { type Actor, requirePermission } from '@/server/auth/session'
import type { Db } from '@/server/db/prisma'
import { parseReportQuery, type RawParams, type ReportQuery, toReportParams } from '@/server/reports/filters'
import { toCsv, type CsvFile } from '@/server/reports/renderers/csv'
import { findReport, groupedReportsFor, mayRunReport, type ReportSummary } from '@/server/reports/registry'
import type { ReportDefinition, ReportResult, ReportScope } from '@/server/reports/types'
import { env } from '@/lib/env'
import { prisma } from '@/server/db/prisma'
import { ForbiddenError } from '@/server/auth/errors'

/**
 * Running a report.
 *
 * Two checks before any query: `report.read` to be in the reports area at all,
 * and the report's own extra permissions for the data it reads. Both run here,
 * on the server, for the page and for the CSV download alike - a report URL is
 * a public endpoint like any other (AD-7).
 *
 * Scope is the third piece. A caller who holds `booking.read` sees every
 * booking; one who only holds `booking.readOwn` - an internal editor - gets
 * every booking-shaped report narrowed to their own editor profile rather than
 * a refusal, so "my bookings" is a report they can actually run.
 */

export interface ReportPage {
  actor: Actor
  report: ReportDefinition
  query: ReportQuery
  result: ReportResult
  /** Everything this actor may open, for the catalogue and the switcher. */
  catalogue: Array<{ group: ReportDefinition['group']; reports: ReportSummary[] }>
  timeZone: string
  now: Date
  /** True when the rows are narrowed to the actor's own bookings. */
  ownOnly: boolean
}

/** How much of the data this actor may see in a booking-shaped report. */
export function scopeFor(actor: Actor): ReportScope | null {
  if (can(actor, 'booking.read')) return null
  if (can(actor, 'booking.readOwn') && actor.editorProfileId) return { editorProfileId: actor.editorProfileId }
  // No booking visibility at all: the reports that need it are not offered,
  // and an impossible scope keeps any that slipped through empty.
  return { editorProfileId: '__none__' }
}

function authorise(actor: Actor, id: string): ReportDefinition {
  const report = findReport(id)
  if (!report) throw new ForbiddenError('That report does not exist.')
  if (!mayRunReport(actor, report)) throw new ForbiddenError('You do not have permission to run that report.')
  return report
}

export interface RunReportOptions {
  now?: Date
  timeZone?: string
}

/**
 * Runs one report for one actor. Throws `ForbiddenError` for a report they may
 * not run - and for one that does not exist, so probing ids tells a caller
 * nothing about which reports the system has.
 */
export async function runReport(db: Db, actor: Actor, id: string, raw: RawParams, options: RunReportOptions = {}): Promise<{ report: ReportDefinition; query: ReportQuery; result: ReportResult }> {
  const report = authorise(actor, id)
  const query = parseReportQuery(raw, report.filters)
  const params = toReportParams(query, {
    now: options.now ?? new Date(),
    timeZone: options.timeZone ?? env.APP_TIMEZONE,
    scope: scopeFor(actor),
  })
  const result = await report.run(db, params)
  return { report, query, result }
}

/** The page loader: authorises, runs, and hands the catalogue along with it. */
export async function loadReportPage(id: string, raw: RawParams, options: RunReportOptions = {}): Promise<ReportPage> {
  const actor = await requirePermission('report.read')
  const now = options.now ?? new Date()
  const timeZone = options.timeZone ?? env.APP_TIMEZONE
  const { report, query, result } = await runReport(prisma, actor, id, raw, { now, timeZone })

  return {
    actor,
    report,
    query,
    result,
    catalogue: groupedReportsFor(actor),
    timeZone,
    now,
    ownOnly: !can(actor, 'booking.read') && can(actor, 'booking.readOwn'),
  }
}

export interface ReportCatalogue {
  actor: Actor
  catalogue: Array<{ group: ReportDefinition['group']; reports: ReportSummary[] }>
  ownOnly: boolean
}

export async function loadReportCatalogue(): Promise<ReportCatalogue> {
  const actor = await requirePermission('report.read')
  return { actor, catalogue: groupedReportsFor(actor), ownOnly: !can(actor, 'booking.read') && can(actor, 'booking.readOwn') }
}

/** The same report, as a CSV file. Same authorisation, same scope, all rows. */
export async function runReportCsv(db: Db, actor: Actor, id: string, raw: RawParams, options: RunReportOptions = {}): Promise<CsvFile> {
  const now = options.now ?? new Date()
  const timeZone = options.timeZone ?? env.APP_TIMEZONE
  const { report, result } = await runReport(db, actor, id, raw, { now, timeZone })
  return toCsv(result, { reportId: report.id, title: report.title, timeZone, now })
}
