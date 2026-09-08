import { ISSUE_DEFAULT_PAGE_SIZE, type IssueListParams } from '@/lib/validation/issues'

/**
 * Every list state is a URL. Defaults are omitted so the common case stays
 * short, and unspecified keys keep their current value.
 */
export function issuesHref(params: IssueListParams, overrides: Partial<IssueListParams> = {}): string {
  // Changing the question restarts at the first page; only paging keeps the page.
  const resetPage = Object.keys(overrides).some((key) => key !== 'page')
  const merged = { ...params, ...overrides, page: resetPage ? 1 : overrides.page ?? params.page }
  const query = new URLSearchParams()
  if (merged.q) query.set('q', merged.q)
  if (merged.filter !== 'open') query.set('filter', merged.filter)
  if (merged.sort !== 'reportedAt') query.set('sort', merged.sort)
  if (merged.dir !== 'desc') query.set('dir', merged.dir)
  if (merged.page > 1) query.set('page', String(merged.page))
  if (merged.pageSize !== ISSUE_DEFAULT_PAGE_SIZE) query.set('pageSize', String(merged.pageSize))
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
