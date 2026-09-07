import { z } from 'zod'

import { formDataToObject } from './assets'

/**
 * Issue schemas: reporting a problem, working it, and closing it.
 *
 * Most issues are not typed in by hand - a return records a missing or damaged
 * item and raises one itself (Phase 9). What is typed in here is the rest of
 * the story: who is looking at it, what was found, and when it was done with.
 * No Prisma import.
 */

export { formDataToObject }

export const ISSUE_TYPES = ['MISSING', 'DAMAGED', 'MALFUNCTION', 'OTHER'] as const
export type IssueTypeValue = (typeof ISSUE_TYPES)[number]
export const ISSUE_TYPE_LABELS: Record<IssueTypeValue, string> = {
  MISSING: 'Missing',
  DAMAGED: 'Damaged',
  MALFUNCTION: 'Not working',
  OTHER: 'Other',
}

export const ISSUE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type IssueSeverityValue = (typeof ISSUE_SEVERITIES)[number]
export const ISSUE_SEVERITY_LABELS: Record<IssueSeverityValue, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
}

export const ISSUE_STATUSES = ['OPEN', 'UNDER_INVESTIGATION', 'RESOLVED', 'CLOSED'] as const
export type IssueStatusValue = (typeof ISSUE_STATUSES)[number]
export const ISSUE_STATUS_LABELS: Record<IssueStatusValue, string> = {
  OPEN: 'Open',
  UNDER_INVESTIGATION: 'Being investigated',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
}

const emptyToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value)
const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max, `Use at most ${max} characters.`).optional())

// -----------------------------------------------------------------------------
// Reporting and editing
// -----------------------------------------------------------------------------

export const createIssueSchema = z.object({
  type: z.enum(ISSUE_TYPES),
  severity: z.enum(ISSUE_SEVERITIES),
  title: z.string().trim().min(4, 'Give the problem a short title.').max(200, 'Use at most 200 characters.'),
  description: z.string().trim().min(4, 'Describe what is wrong.').max(4000, 'Use at most 4000 characters.'),
  /** What it is about; all optional, because a problem may be about the case itself. */
  assetId: optionalText(64),
  kitId: optionalText(64),
  bookingId: optionalText(64),
  accessoryId: optionalText(64),
  assignedToId: optionalText(64),
})
export type CreateIssueInput = z.output<typeof createIssueSchema>

/** What may be corrected while an issue is still open. */
export const updateIssueSchema = z.object({
  type: z.enum(ISSUE_TYPES),
  severity: z.enum(ISSUE_SEVERITIES),
  title: z.string().trim().min(4, 'Give the problem a short title.').max(200),
  description: z.string().trim().min(4, 'Describe what is wrong.').max(4000),
})
export type UpdateIssueInput = z.output<typeof updateIssueSchema>

export const assignIssueSchema = z.object({
  /** Empty means "nobody" - an issue may sit unassigned. */
  assignedToId: optionalText(64),
})
export type AssignIssueInput = z.output<typeof assignIssueSchema>

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

export const investigateIssueSchema = z.object({ note: optionalText(500) })
export type InvestigateIssueInput = z.output<typeof investigateIssueSchema>

export const resolveIssueSchema = z.object({
  resolution: z.string().trim().min(4, 'Say what was done about it.').max(2000, 'Use at most 2000 characters.'),
})
export type ResolveIssueInput = z.output<typeof resolveIssueSchema>

export const closeIssueSchema = z.object({
  /** Required when closing something that was never resolved. */
  resolution: optionalText(2000),
})
export type CloseIssueInput = z.output<typeof closeIssueSchema>

export const reopenIssueSchema = z.object({
  reason: z.string().trim().min(4, 'Say why it is being reopened.').max(500),
})
export type ReopenIssueInput = z.output<typeof reopenIssueSchema>

// -----------------------------------------------------------------------------
// List parameters (URL -> typed query)
// -----------------------------------------------------------------------------

export const ISSUE_FILTERS = ['open', 'all', 'investigating', 'resolved', 'closed', 'critical', 'mine'] as const
export type IssueFilter = (typeof ISSUE_FILTERS)[number]

export const ISSUE_FILTER_LABELS: Record<IssueFilter, string> = {
  open: 'Open',
  investigating: 'Being investigated',
  resolved: 'Resolved',
  closed: 'Closed',
  critical: 'Critical',
  mine: 'Assigned to me',
  all: 'All',
}

export const ISSUE_SORT_KEYS = ['reportedAt', 'issueNumber', 'severity', 'status'] as const
export type IssueSortKey = (typeof ISSUE_SORT_KEYS)[number]

export const ISSUE_DEFAULT_PAGE_SIZE = 25

const listParamsSchema = z.object({
  q: optionalText(100),
  filter: z.enum(ISSUE_FILTERS).catch('open'),
  sort: z.enum(ISSUE_SORT_KEYS).catch('reportedAt'),
  dir: z.enum(['asc', 'desc']).catch('desc'),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(5).max(100).catch(ISSUE_DEFAULT_PAGE_SIZE),
})

export type IssueListParams = z.output<typeof listParamsSchema>

type RawParams = Record<string, string | string[] | undefined>

export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function parseIssueListParams(raw: RawParams): IssueListParams {
  const picked = Object.fromEntries(['q', 'filter', 'sort', 'dir', 'page', 'pageSize'].map((key) => [key, first(raw[key])]))
  const parsed = listParamsSchema.safeParse(picked)
  if (parsed.success) return parsed.data
  return { filter: 'open', sort: 'reportedAt', dir: 'desc', page: 1, pageSize: ISSUE_DEFAULT_PAGE_SIZE }
}
