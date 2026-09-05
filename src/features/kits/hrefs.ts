import { KIT_DEFAULT_PAGE_SIZE, type KitListParams, type KitTab } from '@/lib/validation/kits'

/**
 * URL for the kit list with some parameters changed. Defaults are omitted so
 * links stay short; changing anything but the page resets to page 1.
 */
export function kitsHref(params: KitListParams, overrides: Partial<KitListParams> = {}): string {
  const next: KitListParams = { ...params, ...overrides }
  const resetPage = Object.keys(overrides).some((key) => key !== 'page')
  const search = new URLSearchParams()

  if (next.q) search.set('q', next.q)
  if (next.view !== 'all') search.set('view', next.view)
  if (next.sort !== 'kitCode') search.set('sort', next.sort)
  if (next.dir !== 'asc') search.set('dir', next.dir)
  if (next.pageSize !== KIT_DEFAULT_PAGE_SIZE) search.set('pageSize', String(next.pageSize))
  const page = resetPage ? 1 : next.page
  if (page > 1) search.set('page', String(page))

  const encoded = search.toString()
  return encoded ? `/kits?${encoded}` : '/kits'
}

/** URL for one kit workspace tab, with optional extra query parameters. */
export function kitHref(id: string, tab: KitTab = 'overview', extra: Record<string, string | undefined> = {}): string {
  const search = new URLSearchParams()
  if (tab !== 'overview') search.set('tab', tab)
  for (const [key, value] of Object.entries(extra)) if (value) search.set(key, value)
  const encoded = search.toString()
  return encoded ? `/kits/${id}?${encoded}` : `/kits/${id}`
}
