import 'server-only'

import { can, canAny } from '@/server/auth/permissions'
import type { Actor } from '@/server/auth/session'

import { REPORT_DEFINITIONS } from './definitions'
import type { ReportDefinition } from './types'

/**
 * The catalogue.
 *
 * `report.read` opens the reports area; a report may additionally require the
 * permission for the data it reads, so a reader who cannot see issues does not
 * get an issues report by going straight to its URL. Availability is decided
 * here and enforced again in the service before a query runs.
 */

export function findReport(id: string): ReportDefinition | null {
  return REPORT_DEFINITIONS.find((report) => report.id === id) ?? null
}

/** Whether this actor may run this report at all. */
export function mayRunReport(actor: Actor, report: ReportDefinition): boolean {
  if (!can(actor, 'report.read')) return false
  if (report.alsoNeeds.length === 0) return true
  // Every extra permission is required, not any-of: an editor-history report
  // needs both the editors and the bookings behind it.
  return report.alsoNeeds.every((permission) => can(actor, permission))
}

export interface ReportSummary {
  id: string
  title: string
  description: string
  group: ReportDefinition['group']
}

export function reportsFor(actor: Actor): ReportSummary[] {
  return REPORT_DEFINITIONS.filter((report) => mayRunReport(actor, report)).map(({ id, title, description, group }) => ({ id, title, description, group }))
}

/** The catalogue grouped for the landing page, empty groups dropped. */
export function groupedReportsFor(actor: Actor): Array<{ group: ReportDefinition['group']; reports: ReportSummary[] }> {
  const available = reportsFor(actor)
  const groups: ReportDefinition['group'][] = ['Operations', 'History', 'Equipment']
  return groups.map((group) => ({ group, reports: available.filter((report) => report.group === group) })).filter((entry) => entry.reports.length > 0)
}

/** True when the actor can reach the reports area at all. */
export function canOpenReports(actor: Actor): boolean {
  return canAny(actor, ['report.read'])
}

export { REPORT_DEFINITIONS }
