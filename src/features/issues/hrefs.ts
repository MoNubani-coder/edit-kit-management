import type { IssueListParams } from '@/lib/validation/issues'

/**
 * Every list state is a URL. Defaults are omitted so the common case stays
 * short, and unspecified keys keep their current value.
 */
export function issuesHref(params: IssueListParams, overrides: Partial<IssueListParams> = {}): string {
  const merged = { ...params, ...overrides }
  const query = new URLSearchParams()
  if (merged.q) query.set('q', merged.q)
  if (merged.filter !== 'open') query.set('filter', merged.filter)
  if (merged.sort !== 'reportedAt') query.set('sort', merged.sort)
  if (merged.dir !== 'desc') query.set('dir', merged.dir)
  if (merged.page > 1) query.set('page', String(merged.page))
  if (merged.pageSize !== 25) query.set('pageSize', String(merged.pageSize))
  const search = query.toString()
  return search ? `/issues?${search}` : '/issues'
}

export function issueHref(id: string): string {
  return `/issues/${id}`
}

/** Report a problem, optionally pre-pointed at what it is about. */
export function reportIssueHref(target: { assetId?: string; kitId?: string; bookingId?: string } = {}): string {
  const query = new URLSearchParams()
  if (target.assetId) query.set('assetId', target.assetId)
  if (target.kitId) query.set('kitId', target.kitId)
  if (target.bookingId) query.set('bookingId', target.bookingId)
  const search = query.toString()
  return search ? `/issues/new?${search}` : '/issues/new'
}
